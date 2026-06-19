import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return {
    ...actual,
    completeSimple: vi.fn(),
  };
});

import { compactMessages, estimateTokens } from "../compaction";

const { completeSimple } = await import("@earendil-works/pi-ai");

const SUMMARY_RESPONSE = {
  stopReason: "stop",
  content: [{ type: "text", text: "## Goal\nFix bug\n\n## Progress\n### Done\n- [x] found it" }],
  usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  timestamp: Date.now(),
};

function longConversation(n = 100): import("../types").AgentMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: "user" as const,
    content: `Message ${i}: ${"x".repeat(100)}`,
    timestamp: i,
  }));
}

const testModel = {
  id: "test", name: "Test", api: "openai-completions" as const, provider: "openai",
  input: ["text"] as ["text"], contextWindow: 200000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false, baseUrl: "",
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
      contextWindow: 200000,
      keepRecentTokens: 5000,
    });

    expect(result.tokensBefore).toBeGreaterThan(result.tokensAfter);
    expect(result.messages.length).toBeLessThan(100);
    expect(result.messages[0]!.role).toBe("user");
    expect((result.messages[0] as { content: string }).content).toContain("[Session Summary]");
  });

  it("returns original messages when not enough history", async () => {
    const messages: import("../types").AgentMessage[] = [
      { role: "user", content: "hello", timestamp: 1 },
    ];

    const result = await compactMessages({
      model: testModel,
      apiKey: "test-key",
      messages,
      contextWindow: 200000,
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
      contextWindow: 200000,
      keepRecentTokens: 2000,
    });

    // Last few messages should be preserved as-is
    const lastOriginal = messages[messages.length - 1]!;
    const lastCompacted = result.messages[result.messages.length - 1]!;
    expect((lastCompacted as { content: string }).content).toBe(lastOriginal.content);
  });

  it("returns original messages when LLM returns error", async () => {
    const messages = longConversation(100);
    vi.mocked(completeSimple).mockResolvedValue({
      ...SUMMARY_RESPONSE,
      stopReason: "error",
    });

    const result = await compactMessages({
      model: testModel, apiKey: "test-key", messages, contextWindow: 200000,
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
      model: testModel, apiKey: "test-key", messages, contextWindow: 200000,
    });

    expect(result.messages).toBe(messages);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });

  it("passes conversation history and structured prompt to completeSimple", async () => {
    const messages = longConversation(100);
    vi.mocked(completeSimple).mockResolvedValue(SUMMARY_RESPONSE);

    await compactMessages({
      model: testModel, apiKey: "test-key", messages, contextWindow: 200000,
    });

    expect(completeSimple).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(completeSimple).mock.calls[0]!;
    const promptMessages = callArgs[1].messages as Array<{ content: string }>;
    const promptText = promptMessages[0]!.content;
    expect(promptText).toContain("<conversation>");
    expect(promptText).toContain("Message 0:");
    expect(promptText).toContain("## Goal");
    expect(promptText).toContain("## Progress");
    expect(promptText).toContain("## Critical Context");
  });

  it("handles mixed message types (user, assistant, tool)", async () => {
    const messages: import("../types").AgentMessage[] = [
      { role: "user", content: "fix the bug", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "I'll look into it" }], timestamp: 2 },
      { role: "user", content: "any progress?", timestamp: 3 },
      ...Array.from({ length: 40 }, (_, i) => ({
        role: "user" as const,
        content: `msg ${i}: ${"y".repeat(200)}`,
        timestamp: 4 + i,
      })),
    ];

    const result = await compactMessages({
      model: testModel, apiKey: "test-key", messages, contextWindow: 200000,
    });

    expect(result.tokensBefore).toBeGreaterThan(result.tokensAfter);
    expect(result.messages.length).toBeLessThan(messages.length);
    // Summary message is first
    expect(result.messages[0]!.role).toBe("user");
    expect((result.messages[0] as { content: string }).content).toContain("[Session Summary]");
  });
});
