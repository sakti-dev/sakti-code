import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return {
    ...actual,
    completeSimple: vi.fn(),
  };
});

import { compactMessages, messageToText } from "../compaction";

const { completeSimple } = await import("@earendil-works/pi-ai");

const SUMMARY_RESPONSE = {
  stopReason: "stop",
  content: [
    {
      type: "text",
      text: "## Goal\nFix bug\n\n## Progress\n### Done\n- [x] found it",
    },
  ],
  usage: {
    input: 100,
    output: 50,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 150,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  timestamp: Date.now(),
};

function longConversation(n = 100): import("../types").AgentMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: "user" as const,
    content: `Message ${i}: ${"x".repeat(500)}`,
    timestamp: i,
  }));
}

const testModel = {
  id: "test",
  name: "Test",
  api: "openai-completions" as const,
  provider: "openai",
  input: ["text"] as ["text"],
  contextWindow: 200_000,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  reasoning: false,
  baseUrl: "",
};

describe("compactMessages", () => {
  beforeEach(() => {
    vi.mocked(completeSimple).mockClear();
    vi.mocked(completeSimple).mockResolvedValue(SUMMARY_RESPONSE);
  });

  it("compacts a long conversation into summary + recent", async () => {
    const messages = longConversation(100);

    const result = await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200_000,
      keepRecentTokens: 5000,
    });

    expect(result.tokensBefore).toBeGreaterThan(result.tokensAfter);
    expect(result.messages.length).toBeLessThan(100);
    expect(result.messages[0]?.role).toBe("user");
    expect((result.messages[0] as { content: string }).content).toContain(
      "[Session Summary]"
    );
  });

  it("returns original messages when not enough history", async () => {
    const messages: import("../types").AgentMessage[] = [
      { role: "user", content: "hello", timestamp: 1 },
    ];

    const result = await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200_000,
    });

    expect(result.messages).toBe(messages);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });

  it("preserves recent messages after the summary", async () => {
    const messages = longConversation(50).map((m, i) => ({
      ...m,
      content: `Message ${i}: ${"x".repeat(200)}`,
    }));

    const result = await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200_000,
      keepRecentTokens: 2000,
    });

    // Last few messages should be preserved as-is
    const lastOriginal = messages.at(-1)!;
    const lastCompacted = result.messages.at(-1)!;
    expect((lastCompacted as { content: string }).content).toBe(
      lastOriginal.content
    );
  });

  it("returns original messages when LLM returns error", async () => {
    const messages = longConversation(100);
    vi.mocked(completeSimple).mockResolvedValue({
      ...SUMMARY_RESPONSE,
      stopReason: "error",
    });

    const result = await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200_000,
    });

    expect(result.messages).toBe(messages);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });

  it("returns original messages when LLM is aborted", async () => {
    const messages = longConversation(100);
    vi.mocked(completeSimple).mockResolvedValue({
      ...SUMMARY_RESPONSE,
      stopReason: "aborted",
    });

    const result = await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200_000,
    });

    expect(result.messages).toBe(messages);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });

  it("passes conversation history and structured prompt to completeSimple", async () => {
    const messages = longConversation(100);
    vi.mocked(completeSimple).mockResolvedValue(SUMMARY_RESPONSE);

    await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200_000,
      keepRecentTokens: 3000,
    });

    expect(completeSimple).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(completeSimple).mock.calls[0]!;
    const promptMessages = callArgs[1].messages as Array<{ content: string }>;
    const promptText = promptMessages[0]?.content;
    expect(promptText).toContain("<conversation>");
    expect(promptText).toContain("Message 0:");
    expect(promptText).toContain("## Goal");
    expect(promptText).toContain("## Progress");
    expect(promptText).toContain("## Critical Context");
  });

  it("handles mixed message types (user, assistant, tool)", async () => {
    const messages: import("../types").AgentMessage[] = [
      { role: "user", content: "fix the bug", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "I'll look into it" }],
        timestamp: 2,
      },
      { role: "user", content: "any progress?", timestamp: 3 },
      ...Array.from({ length: 40 }, (_, i) => ({
        role: "user" as const,
        content: `msg ${i}: ${"y".repeat(500)}`,
        timestamp: 4 + i,
      })),
    ];

    const result = await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200_000,
      keepRecentTokens: 3000,
    });

    expect(result.tokensBefore).toBeGreaterThan(result.tokensAfter);
    expect(result.messages.length).toBeLessThan(messages.length);
    // Summary message is first
    expect(result.messages[0]?.role).toBe("user");
    expect((result.messages[0] as { content: string }).content).toContain(
      "[Session Summary]"
    );
  });
  it("advances cut past tool results to avoid orphaning (pi findValidCutPoints)", async () => {
    const history = longConversation(40);
    const usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };

    const messages: import("../types").AgentMessage[] = [
      ...history,
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            name: "read_file",
            id: "tc1",
            arguments: { path: "/foo/bar.ts" },
          },
        ],
        timestamp: 41,
        usage,
      },
      {
        role: "tool",
        content: [{ type: "text", text: "x".repeat(500) }],
        isError: false,
        timestamp: 42,
        toolCallId: "tc1",
        toolName: "read_file",
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Done!" }],
        timestamp: 43,
        usage,
      },
    ];

    // keepRecentTokens=50: trailing assistant (~2 tokens) doesn't exceed budget,
    // but adding tool result (~125 tokens) does → cutIndex lands on tool message
    const result = await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200_000,
      keepRecentTokens: 50,
    });

    // Ship guarantee: no orphaned tool result in the compacted output
    // result.messages[0] is the summary (role: "user"), recentMessages start at [1]
    expect(result.messages[1]?.role).not.toBe("tool");

    // Validate: every tool message in result has a preceding assistant tool-call
    for (let i = 0; i < result.messages.length; i++) {
      const msg = result.messages[i];
      if (msg?.role === "tool") {
        let hasPrecedingToolCall = false;
        for (let j = i - 1; j >= 0; j--) {
          const prev = result.messages[j];
          if (prev?.role === "assistant") {
            const hasToolCall = (prev.content as Array<{ type: string }>).some(
              (b) => b.type === "toolCall"
            );
            if (hasToolCall) {
              hasPrecedingToolCall = true;
              break;
            }
          }
        }
        expect(hasPrecedingToolCall).toBe(true);
      }
    }
  });

  it("keeps all messages when no valid cut point exists (advancement exhausts array)", async () => {
    const history = longConversation(40);
    const usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };

    const messages: import("../types").AgentMessage[] = [
      ...history,
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            name: "bash",
            id: "tc1",
            arguments: { command: "ls" },
          },
        ],
        timestamp: 41,
        usage,
      },
      {
        role: "tool",
        content: [{ type: "text", text: "x".repeat(200) }],
        isError: false,
        timestamp: 42,
        toolCallId: "tc1",
        toolName: "bash",
      },
    ];

    // keepRecentTokens=20: tool result (~50 tokens) immediately exceeds budget →
    // cutIndex lands on tool, advancement pushes past it to messages.length → keep-all
    const result = await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200_000,
      keepRecentTokens: 20,
    });

    expect(result.messages).toBe(messages);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });
});

describe("messageToText", () => {
  it("truncates tool result over 2000 chars with pi marker", () => {
    const longContent = "a".repeat(5000);
    const msg: import("../types").AgentMessage = {
      role: "tool",
      content: [{ type: "text", text: longContent }],
      isError: false,
      timestamp: 1,
      toolCallId: "tc1",
      toolName: "read_file",
    };
    const result = messageToText(msg);
    expect(result).toBe(
      `[Tool result]: ${"a".repeat(2000)}\n\n[... 3000 more characters truncated]`
    );
    expect(result.length).toBeLessThan(5000);
  });

  it("does not truncate tool result at or under 2000 chars", () => {
    const shortContent = "x".repeat(2000);
    const msg: import("../types").AgentMessage = {
      role: "tool",
      content: [{ type: "text", text: shortContent }],
      isError: false,
      timestamp: 1,
      toolCallId: "tc1",
      toolName: "read_file",
    };
    expect(messageToText(msg)).toBe(`[Tool result]: ${shortContent}`);
  });

  it("serializes assistant message with thinking + text + toolcall as three sections", () => {
    const msg: import("../types").AgentMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hmm..." },
        { type: "text", text: "I'll look" },
        {
          type: "toolCall",
          name: "read_file",
          id: "tc1",
          arguments: { path: "/foo.ts" },
        },
      ],
      timestamp: 1,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const result = messageToText(msg);
    expect(result).toContain("[Assistant thinking]: hmm...");
    expect(result).toContain("[Assistant]: I'll look");
    expect(result).toContain(
      '[Assistant tool calls]: read_file(path="/foo.ts")'
    );
  });

  it("serializes text-only assistant as single section", () => {
    const msg: import("../types").AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "just text" }],
      timestamp: 1,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const result = messageToText(msg);
    expect(result).toBe("[Assistant]: just text");
    expect(result).not.toContain("[Assistant thinking]");
    expect(result).not.toContain("[Assistant tool calls]");
  });

  it("serializes user message with bracket label", () => {
    const msg: import("../types").AgentMessage = {
      role: "user",
      content: "hello world",
      timestamp: 1,
    };
    expect(messageToText(msg)).toBe("[User]: hello world");
  });

  it("omits empty user content", () => {
    const msg: import("../types").AgentMessage = {
      role: "user",
      content: "",
      timestamp: 1,
    };
    expect(messageToText(msg)).toBe("");
  });

  it("omits empty tool content", () => {
    const msg: import("../types").AgentMessage = {
      role: "tool",
      content: [{ type: "text", text: "" }],
      isError: false,
      timestamp: 1,
      toolCallId: "tc1",
      toolName: "bash",
    };
    expect(messageToText(msg)).toBe("");
  });

  it("joins multi-section assistant with double newline", () => {
    const msg: import("../types").AgentMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "step1\nstep2" },
        { type: "text", text: "result" },
        {
          type: "toolCall",
          name: "edit",
          id: "tc1",
          arguments: { file: "a.ts", line: 10 },
        },
      ],
      timestamp: 1,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const result = messageToText(msg);
    const sections = result.split("\n\n");
    expect(sections).toHaveLength(3);
    expect(sections[0]).toBe("[Assistant thinking]: step1\nstep2");
    expect(sections[1]).toBe("[Assistant]: result");
    expect(sections[2]).toBe(
      '[Assistant tool calls]: edit(file="a.ts", line=10)'
    );
  });

  it("formats tool call args with JSON.stringify values", () => {
    const msg: import("../types").AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          name: "write",
          id: "tc1",
          arguments: { path: "/tmp/test.ts", content: "hello" },
        },
      ],
      timestamp: 1,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    expect(messageToText(msg)).toBe(
      '[Assistant tool calls]: write(path="/tmp/test.ts", content="hello")'
    );
  });
});
