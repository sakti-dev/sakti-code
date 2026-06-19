import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return {
    ...actual,
    completeSimple: vi.fn().mockResolvedValue({
      stopReason: "stop",
      content: [{ type: "text", text: "## Goal\nFix bug\n\n## Progress\n### Done\n- [x] found it" }],
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: Date.now(),
    }),
  };
});

import { compactMessages, estimateTokens } from "../compaction";

const testModel = {
  id: "test", name: "Test", api: "openai-completions" as const, provider: "openai",
  input: ["text"] as ["text"], contextWindow: 200000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false, baseUrl: "",
};

describe("compactMessages", () => {
  it("compacts a long conversation into summary + recent", async () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}: ${"x".repeat(100)}`,
      timestamp: i,
    }));

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
    const messages = [
      { role: "user" as const, content: "hello", timestamp: 1 },
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
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}: ${"x".repeat(200)}`,
      timestamp: i,
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
});
