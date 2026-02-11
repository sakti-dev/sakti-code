import type { ChatMessage } from "@ekacode/desktop/presentation/hooks/use-messages";
import { selectAssistantMessagesForTurn } from "@ekacode/desktop/views/workspace-view/chat-area/session-turn";
import { describe, expect, it } from "vitest";

function msg(input: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role">): ChatMessage {
  return {
    parts: [],
    createdAt: 0,
    sessionId: "s1",
    ...input,
  };
}

describe("SessionTurn turn scoping", () => {
  it("prefers explicit parent linkage", () => {
    const timeline: ChatMessage[] = [
      msg({ id: "u1", role: "user" }),
      msg({ id: "a1", role: "assistant", parentId: "u1" }),
      msg({ id: "u2", role: "user" }),
      msg({ id: "a2", role: "assistant", parentId: "u2" }),
    ];

    const turn1 = selectAssistantMessagesForTurn(timeline, "u1");
    const turn2 = selectAssistantMessagesForTurn(timeline, "u2");

    expect(turn1.map(m => m.id)).toEqual(["a1"]);
    expect(turn2.map(m => m.id)).toEqual(["a2"]);
  });

  it("falls back to windowed assistants between user turns when parentId is missing", () => {
    const timeline: ChatMessage[] = [
      msg({ id: "u1", role: "user" }),
      msg({ id: "a1", role: "assistant" }),
      msg({ id: "a2", role: "assistant" }),
      msg({ id: "u2", role: "user" }),
      msg({ id: "a3", role: "assistant" }),
    ];

    const turn1 = selectAssistantMessagesForTurn(timeline, "u1");
    const turn2 = selectAssistantMessagesForTurn(timeline, "u2");

    expect(turn1.map(m => m.id)).toEqual(["a1", "a2"]);
    expect(turn2.map(m => m.id)).toEqual(["a3"]);
  });
});
