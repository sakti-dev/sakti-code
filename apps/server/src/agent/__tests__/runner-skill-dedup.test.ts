import { describe, expect, it } from "vite-plus/test";

describe("skill injection deduplication", () => {
  it("a skill-read toolCallId in session history means already injected", () => {
    const entries = [
      {
        id: "e1",
        parentId: null,
        timestamp: new Date().toISOString(),
        type: "message" as const,
        message: {
          role: "assistant" as const,
          api: "synthetic",
          model: "synthetic",
          provider: "synthetic",
          stopReason: "toolUse" as const,
          timestamp: Date.now(),
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 0,
            output: 0,
            totalTokens: 0,
          },
          content: [
            {
              type: "toolCall" as const,
              id: "skill-read:sakti-build",
              name: "read",
              arguments: { filePath: "/skills/sakti-build/SKILL.md" },
            },
          ],
        },
      },
    ];
    const skillCallId = "skill-read:sakti-build";
    const found = entries.some(
      (e) =>
        e.type === "message" &&
        e.message.role === "assistant" &&
        e.message.content.some((b) => b.type === "toolCall" && b.id === skillCallId),
    );
    expect(found).toBe(true);
  });

  it("no matching toolCallId means not yet injected", () => {
    const entries: Array<{
      type: string;
      message: { role: string; content: Array<{ type: string; id?: string }> };
    }> = [
      {
        type: "message",
        message: { role: "user", content: [{ type: "text" }] },
      },
    ];
    const skillCallId = "skill-read:sakti-build";
    const found = entries.some(
      (e) =>
        e.type === "message" &&
        e.message.role === "assistant" &&
        e.message.content.some((b) => b.type === "toolCall" && b.id === skillCallId),
    );
    expect(found).toBe(false);
  });

  it("empty session means not yet injected", () => {
    const entries: unknown[] = [];
    const found = entries.some(
      (e) =>
        e !== null &&
        typeof e === "object" &&
        "type" in e &&
        (e as { type: string }).type === "message",
    );
    expect(found).toBe(false);
  });
});
