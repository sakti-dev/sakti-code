import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { type ChatTurnDTO, hydrateChatTurns, hydrateIntermediates } from "../hydrate-chat.ts";

function makeMsg(role: string, text: string, id: string): Record<string, unknown> {
  return {
    id,
    type: "message",
    message: {
      content: text,
      role,
      timestamp: Date.now(),
    } as AgentMessage,
  };
}

describe("hydrateIntermediates", () => {
  it("converts assistant entries and merges tool results", () => {
    const entries = [
      makeMsg("assistant", "thinking...", "a1"),
      {
        id: "tr1",
        type: "message",
        message: {
          role: "toolResult",
          content: "result text",
          toolCallId: "tc1",
        } as unknown as AgentMessage,
      },
    ];
    const result = hydrateIntermediates(entries);
    expect(result).toHaveLength(1);
    expect(result[0]!.parts.some((p) => p.type === "tool_call")).toBe(false);
  });
});

describe("hydrateChatTurns", () => {
  it("maps ChatTurnDTO[] to Turn[]", () => {
    const turns: ChatTurnDTO[] = [
      {
        endedAt: 2000,
        id: "t1",
        intermediateIds: ["m1", "m2"],
        sequence: 0,
        startedAt: 1000,
        summaryMessage: makeMsg("assistant", "answer", "s1"),
        userMessage: makeMsg("user", "hello", "u1"),
      },
    ];
    const result = hydrateChatTurns(turns);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("t1");
    expect(result[0]!.userMessage?.content).toBe("hello");
    expect(result[0]!.summary).not.toBeNull();
    expect(result[0]!.summary!.id).toBe("s1");
    expect(result[0]!.intermediateCount).toBe(2);
    expect(result[0]!.intermediatesLoaded).toBe(false);
    expect(result[0]!.working).toBe(false);
    expect(result[0]!.turnId).toBe("t1");
  });

  it("handles missing userMessage", () => {
    const turns: ChatTurnDTO[] = [
      {
        endedAt: null,
        id: "t1",
        intermediateIds: [],
        sequence: 0,
        startedAt: 1000,
        summaryMessage: makeMsg("assistant", "hi", "s1"),
        userMessage: null,
      },
    ];
    const result = hydrateChatTurns(turns);
    expect(result[0]!.userMessage).toBeNull();
  });
});
