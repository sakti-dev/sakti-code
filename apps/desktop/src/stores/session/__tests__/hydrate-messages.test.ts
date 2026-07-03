import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vite-plus/test";
import { hydrateSessionTurns } from "../hydrate-messages.ts";

function makeUser(text: string): AgentMessage {
  return { content: text, role: "user", timestamp: Date.now() } as AgentMessage;
}

function makeAssistant(text: string): AgentMessage {
  return {
    content: text ? [{ type: "text", text }] : [],
    provider: "faux",
    role: "assistant",
    api: "faux",
    model: "faux-1",
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 150,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as AgentMessage;
}

describe("hydrateSessionTurns", () => {
  it("groups messages into turns by user messages", () => {
    const messages: AgentMessage[] = [
      makeUser("hello"),
      makeAssistant("hi there"),
      makeUser("another question"),
      makeAssistant("another answer"),
    ];
    const turns = hydrateSessionTurns(messages);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.userMessage?.content).toBe("hello");
    expect(turns[0]!.messages).toHaveLength(1);
    expect(turns[1]!.userMessage?.content).toBe("another question");
  });

  it("handles assistant messages before any user", () => {
    const turns = hydrateSessionTurns([makeAssistant("orphan")]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.userMessage).toBeNull();
    expect(turns[0]!.messages).toHaveLength(1);
  });

  it("merges tool results into preceding assistant", () => {
    const messages: AgentMessage[] = [
      makeUser("do something"),
      {
        content: [],
        provider: "faux",
        role: "assistant",
        api: "faux",
        model: "faux-1",
        stopReason: "toolUse",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      } as AgentMessage,
      {
        content: "tool result",
        role: "toolResult",
        toolCallId: "tc1",
        timestamp: Date.now(),
      } as unknown as AgentMessage,
    ];
    const turns = hydrateSessionTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.messages).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(hydrateSessionTurns([])).toEqual([]);
  });
});

describe("hydrateSessionTurns — thinking timing", () => {
  it("preserves startedAt/endedAt from thinking content blocks", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "reasoning", startedAt: 1000, endedAt: 2000 },
          { type: "text", text: "answer" },
        ],
        timestamp: 1500,
      },
    ] as AgentMessage[];

    const turns = hydrateSessionTurns(messages);
    const thinking = turns[0]!.messages[0]!.parts.find((p) => p.type === "thinking");
    expect(thinking).toMatchObject({
      type: "thinking",
      text: "reasoning",
      startedAt: 1000,
      endedAt: 2000,
    });
  });
});
