import { describe, expect, it } from "vite-plus/test";
import type { UIMessage } from "../../types.ts";
import {
  buildChatTurns,
  getAssistantParts,
  getUserText,
} from "../turn-projection.ts";

function makeMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content: "",
    parts: [],
    isStreaming: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

function buildTurns(messages: UIMessage[], streamingPhase = "idle") {
  const order = messages.map((m) => m.id);
  const record: Record<string, UIMessage> = {};
  for (const m of messages) record[m.id] = m;
  return buildChatTurns(order, record, streamingPhase);
}

describe("buildChatTurns", () => {
  it("returns empty array for no messages", () => {
    expect(buildChatTurns([], {}, "idle")).toEqual([]);
  });

  it("groups a user + assistant pair into one turn", () => {
    const user = makeMessage({ role: "user", content: "hello" });
    const assistant = makeMessage({
      role: "assistant",
      content: "hi there",
      parts: [{ type: "text", text: "hi there" }],
    });
    const turns = buildTurns([user, assistant]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.userMessage).toBe(user);
    expect(turns[0]!.assistantMessages).toEqual([assistant]);
    expect(turns[0]!.working).toBe(false);
  });

  it("creates separate turns for each user message", () => {
    const u1 = makeMessage({ role: "user", content: "q1" });
    const a1 = makeMessage({ role: "assistant", content: "a1" });
    const u2 = makeMessage({ role: "user", content: "q2" });
    const a2 = makeMessage({ role: "assistant", content: "a2" });
    const turns = buildTurns([u1, a1, u2, a2]);

    expect(turns).toHaveLength(2);
    expect(getUserText(turns[0]!)).toBe("q1");
    expect(getUserText(turns[1]!)).toBe("q2");
  });

  it("marks last turn as working when streaming", () => {
    const user = makeMessage({ role: "user", content: "hello" });
    const assistant = makeMessage({
      role: "assistant",
      content: "",
      isStreaming: true,
    });
    const turns = buildTurns([user, assistant], "writing");

    expect(turns[0]!.working).toBe(true);
  });

  it("does not mark as working when phase is idle", () => {
    const user = makeMessage({ role: "user", content: "hello" });
    const assistant = makeMessage({
      role: "assistant",
      content: "done",
      isStreaming: false,
    });
    const turns = buildTurns([user, assistant], "idle");

    expect(turns[0]!.working).toBe(false);
  });

  it("captures error from assistant message", () => {
    const user = makeMessage({ role: "user", content: "hello" });
    const assistant = makeMessage({
      role: "assistant",
      content: "",
      error: "rate limited",
    });
    const turns = buildTurns([user, assistant]);

    expect(turns[0]!.error).toBe("rate limited");
  });

  it("groups multiple assistant messages in one turn", () => {
    const user = makeMessage({ role: "user", content: "hello" });
    const a1 = makeMessage({
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool_call",
          toolCallId: "tc1",
          toolName: "read",
          input: {},
          status: "done",
        },
      ],
    });
    const a2 = makeMessage({
      role: "assistant",
      content: "result text",
      parts: [{ type: "text", text: "result text" }],
    });
    const turns = buildTurns([user, a1, a2]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.assistantMessages).toHaveLength(2);
  });

  it("handles assistant message without a preceding user message", () => {
    const assistant = makeMessage({ role: "assistant", content: "orphan" });
    const turns = buildTurns([assistant]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.userMessage).toBeNull();
    expect(turns[0]!.assistantMessages).toEqual([assistant]);
  });
});

describe("getAssistantParts", () => {
  it("flattens parts from all assistant messages", () => {
    const user = makeMessage({ role: "user", content: "hello" });
    const a1 = makeMessage({
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool_call",
          toolCallId: "tc1",
          toolName: "read",
          input: {},
          status: "done",
        },
      ],
    });
    const a2 = makeMessage({
      role: "assistant",
      content: "text",
      parts: [{ type: "text", text: "text" }],
    });
    const turns = buildTurns([user, a1, a2]);

    expect(getAssistantParts(turns[0]!)).toHaveLength(2);
  });
});
