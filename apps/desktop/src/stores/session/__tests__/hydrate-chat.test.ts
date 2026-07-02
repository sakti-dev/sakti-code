import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { type ChatTurnDTO, hydrateChatSummaries, hydrateIntermediates } from "../hydrate-chat.ts";

function userMsg(id: string, text: string): Record<string, unknown> {
  return {
    id,
    type: "message",
    message: { role: "user", content: text, timestamp: 1000 } as unknown as AgentMessage,
  };
}

function assistantMsg(id: string, text: string): Record<string, unknown> {
  return {
    id,
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: 2000,
    } as unknown as AgentMessage,
  };
}

function assistantToolCall(id: string, callId: string, name: string): Record<string, unknown> {
  return {
    id,
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: callId, name, arguments: {} }],
      timestamp: 1500,
    } as unknown as AgentMessage,
  };
}

function toolResult(id: string, callId: string, text: string): Record<string, unknown> {
  return {
    id,
    type: "message",
    message: {
      role: "toolResult",
      toolCallId: callId,
      content: [{ type: "text", text }],
      timestamp: 1600,
    } as unknown as AgentMessage,
  };
}

describe("hydrateChatSummaries", () => {
  it("produces user + summary messages and turn metadata", () => {
    const turns: ChatTurnDTO[] = [
      {
        endedAt: 2000,
        id: "t1",
        intermediateIds: ["im1", "im2"],
        sequence: 0,
        startedAt: 1000,
        summaryMessage: assistantMsg("s1", "final answer"),
        userMessage: userMsg("u1", "hello"),
      },
    ];

    const { messages, turns: turnMeta } = hydrateChatSummaries(turns);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.id).toBe("u1");
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.id).toBe("s1");
    expect(messages[1]!.role).toBe("assistant");

    expect(turnMeta).toHaveLength(1);
    expect(turnMeta[0]).toMatchObject({
      id: "t1",
      intermediatesLoaded: false,
      intermediateIds: ["im1", "im2"],
      summaryMessageId: "s1",
      userMessageId: "u1",
      startedAt: 1000,
      endedAt: 2000,
    });
  });

  it("handles a turn with no summary (null)", () => {
    const turns: ChatTurnDTO[] = [
      {
        endedAt: null,
        id: "t2",
        intermediateIds: [],
        sequence: 0,
        startedAt: 1000,
        summaryMessage: null,
        userMessage: userMsg("u2", "no reply yet"),
      },
    ];

    const { messages, turns: turnMeta } = hydrateChatSummaries(turns);
    expect(messages).toHaveLength(1);
    expect(turnMeta[0]!.summaryMessageId).toBeNull();
  });
});

describe("hydrateIntermediates", () => {
  it("converts intermediate entries, merging tool results", () => {
    const entries = [assistantToolCall("a1", "c1", "bash"), toolResult("tr1", "c1", "done")];
    const result = hydrateIntermediates(entries);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a1");
    const toolPart = result[0]!.parts.find((p) => p.type === "tool_call");
    expect(toolPart?.type).toBe("tool_call");
    if (toolPart?.type === "tool_call") {
      expect(toolPart.status).toBe("done");
      expect(toolPart.result).toBe("done");
    }
  });

  it("skips user messages (shipped via /chat)", () => {
    const entries = [userMsg("u1", "hello"), assistantMsg("a1", "step")];
    const result = hydrateIntermediates(entries);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a1");
  });

  it("returns empty for an empty list", () => {
    expect(hydrateIntermediates([])).toEqual([]);
  });
});
