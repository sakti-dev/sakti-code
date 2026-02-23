import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

describe("Observer runtime integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createObserverAgent should use mode-specific system prompt", async () => {
    generateTextMock.mockResolvedValue({
      text: "<observations>ok</observations>",
      usage: { totalTokens: 10 },
    });

    const { createObserverAgent } = await import("@/memory/observation/orchestration");
    const model = { provider: "mock" } as unknown;
    const observer = createObserverAgent(model as never, "explore");

    await observer("", [{ id: "msg-1", role: "user", content: "Inspect project" }]);

    const call = generateTextMock.mock.calls[0]?.[0] as { system?: string };
    expect(call?.system ?? "").toContain("codebase researcher");
  });

  it("callObserverAgent should preserve token usage from totalTokens", async () => {
    generateTextMock.mockResolvedValue({
      text: "<observations>ok</observations>",
      usage: { totalTokens: 123 },
    });

    const { callObserverAgent } = await import("@/memory/observation/observer");
    const result = await callObserverAgent(
      { existingObservations: "", messages: [{ id: "m1", role: "user", content: "hi" }] },
      { provider: "mock" } as never
    );

    expect(result.tokenCount).toBe(123);
  });
});
