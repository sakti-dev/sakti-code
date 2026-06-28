import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../types";
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
