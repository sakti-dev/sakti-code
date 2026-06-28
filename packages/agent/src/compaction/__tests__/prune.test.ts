import { describe, expect, it } from "vitest";
import type { MessageEntry, SessionTreeEntry } from "../../harness-types";
import { getOrThrow } from "../../harness-types";
import type { AgentMessage } from "../../types";
import { DEFAULT_COMPACTION_SETTINGS, prepareCompaction } from "../compaction";
import { DEFAULT_MIN_PRUNE_BYTES, pruneStaleToolResults } from "../prune";

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function toolResultMessage(
  name: string,
  content: string,
  toolCallId = "call-1",
  isError = false
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: name,
    content: [textBlock(content)],
    isError,
    timestamp: 1,
  };
}

function userMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [textBlock(text)],
    timestamp: 1,
  };
}

describe("pruneStaleToolResults", () => {
  const minPruneBytes = DEFAULT_MIN_PRUNE_BYTES;

  it("elides tool results >= minPruneBytes outside the tail", () => {
    const largeContent = "x".repeat(2048);
    const messages: AgentMessage[] = [
      toolResultMessage("read", largeContent),
      userMessage("hello"),
    ];

    const { pruned, stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(1);
    expect(stats.savedChars).toBeGreaterThan(0);
    const prunedMsg = pruned[0] as (typeof messages)[number];
    expect(prunedMsg).toBeDefined();
    expect(prunedMsg.role).toBe("toolResult");
    const content = (prunedMsg as { content: { text: string }[] }).content;
    expect(content[0]!.text).toContain("[elided tool result");
    expect(content[0]!.text).toContain("read");
    expect(content[0]!.text).toContain("2048 bytes dropped");
  });

  it("does NOT prune tool results inside the tail", () => {
    const largeContent = "x".repeat(2048);
    const messages: AgentMessage[] = [
      userMessage("old"),
      toolResultMessage("read", largeContent),
    ];

    const { pruned, stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(0);
    expect(pruned).toBe(messages);
  });

  it("does NOT prune small tool results", () => {
    const messages: AgentMessage[] = [toolResultMessage("read", "small")];

    const { stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(0);
  });

  it("does NOT prune error tool results", () => {
    const largeContent = "x".repeat(2048);
    const messages: AgentMessage[] = [
      toolResultMessage("bash", largeContent, "call-1", true),
    ];

    const { stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(0);
  });

  it("is idempotent — does not re-prune already-elided results", () => {
    const alreadyElided =
      "[elided tool result — read, 2048 bytes dropped to save context]";
    const messages: AgentMessage[] = [toolResultMessage("read", alreadyElided)];

    const { stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(0);
  });

  it("handles string content (not just structured blocks)", () => {
    const largeContent = "y".repeat(2048);
    const messages: AgentMessage[] = [
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        content: largeContent,
        isError: false,
        timestamp: 1,
      } as unknown as AgentMessage,
    ];

    const { stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });

    expect(stats.results).toBe(1);
  });

  it("returns the input reference unchanged when nothing is pruned", () => {
    const messages: AgentMessage[] = [userMessage("hi")];
    const { pruned, stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 1,
      minPruneBytes,
    });
    expect(stats.results).toBe(0);
    expect(pruned).toBe(messages);
  });

  it("returns empty input unchanged", () => {
    const messages: AgentMessage[] = [];
    const { pruned, stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 0,
      minPruneBytes,
    });
    expect(stats.results).toBe(0);
    expect(pruned).toBe(messages);
  });

  it("prunes multiple large tool results in the stale range", () => {
    const big = "z".repeat(2048);
    const messages: AgentMessage[] = [
      toolResultMessage("read", big, "c1"),
      toolResultMessage("bash", big, "c2"),
      userMessage("tail"),
    ];

    const { stats } = pruneStaleToolResults(messages, {
      tailStartIndex: 2,
      minPruneBytes,
    });

    expect(stats.results).toBe(2);
    expect(stats.savedChars).toBeGreaterThan(0);
  });
});

describe("prepareCompaction integration", () => {
  function msgEntry(
    message: AgentMessage,
    parentId: string | null = null,
    id = `e-${Math.random().toString(36).slice(2)}`
  ): MessageEntry {
    return {
      type: "message",
      id,
      parentId,
      timestamp: new Date().toISOString(),
      message,
    };
  }

  function asstWithToolCall(toolCallId: string): AgentMessage {
    return {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: toolCallId,
          name: "read",
          arguments: { path: "stale.ts" },
        },
      ],
      api: "openai",
      provider: "p",
      model: "m",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 1,
    };
  }

  it("prepareCompaction prunes large stale tool results from messagesToSummarize", () => {
    const largeContent = "x".repeat(2048);
    // Build a branch where the summarized history holds a big read tool result
    // and the kept tail holds a small one. Use keepRecentTokens=1 so the cut
    // point lands right before the final assistant message.
    const u1 = msgEntry(userMessage("first turn"));
    const a1 = msgEntry(asstWithToolCall("c1"), u1.id);
    const tr1 = msgEntry(toolResultMessage("read", largeContent, "c1"), a1.id);
    const u2 = msgEntry(userMessage("second turn"), tr1.id);
    const a2 = msgEntry(
      {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        api: "openai",
        provider: "p",
        model: "m",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 2,
      },
      u2.id
    );

    const entries: SessionTreeEntry[] = [u1, a1, tr1, u2, a2];
    const preparation = getOrThrow(
      prepareCompaction(entries, {
        ...DEFAULT_COMPACTION_SETTINGS,
        keepRecentTokens: 1,
      })
    );

    expect(preparation).toBeDefined();
    const toSummarize = preparation?.messagesToSummarize ?? [];
    // The toolResult message must be present and pruned.
    const prunedToolResult = toSummarize.find((m) => m.role === "toolResult");
    expect(prunedToolResult).toBeDefined();
    const content = (
      prunedToolResult as unknown as { content: { text: string }[] }
    ).content;
    expect(content[0]!.text).toContain("[elided tool result");
    expect(content[0]!.text).toContain("read");
    expect(content[0]!.text).toContain("2048 bytes dropped");
  });

  it("prepareCompaction keeps small tool results in messagesToSummarize verbatim", () => {
    const u1 = msgEntry(userMessage("first turn"));
    const a1 = msgEntry(asstWithToolCall("c1"), u1.id);
    const tr1 = msgEntry(
      toolResultMessage("read", "small output", "c1"),
      a1.id
    );
    const u2 = msgEntry(userMessage("second turn"), tr1.id);
    const a2 = msgEntry(
      {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        api: "openai",
        provider: "p",
        model: "m",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 2,
      },
      u2.id
    );

    const entries: SessionTreeEntry[] = [u1, a1, tr1, u2, a2];
    const preparation = getOrThrow(
      prepareCompaction(entries, {
        ...DEFAULT_COMPACTION_SETTINGS,
        keepRecentTokens: 1,
      })
    );

    const toSummarize = preparation?.messagesToSummarize ?? [];
    const toolResult = toSummarize.find((m) => m.role === "toolResult");
    expect(toolResult).toBeDefined();
    const content = (toolResult as unknown as { content: { text: string }[] })
      .content;
    expect(content[0]!.text).toBe("small output");
  });
});
