import { describe, expect, it } from "vitest";
import { createSessionStore } from "../session-store.ts";
import type { UIMessage } from "../types.ts";

function makeMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    parts: [],
    isStreaming: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("session store", () => {
  it("addMessage inserts into messages map and order", () => {
    const session = createSessionStore("s1");

    const msg = makeMessage({ id: "m1", content: "hello" });
    session.actions.addMessage(msg);

    expect(session.store.messages.m1).toBeDefined();
    expect(session.store.messages.m1!.content).toBe("hello");
    expect(session.store.messageOrder).toEqual(["m1"]);
  });

  it("appendToken updates message content via path", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1", content: "Hel" }));

    session.actions.appendToken("m1", "lo");
    expect(session.store.messages.m1!.content).toBe("Hello");

    session.actions.appendToken("m1", " World");
    expect(session.store.messages.m1!.content).toBe("Hello World");
  });

  it("setPhase updates streaming state", () => {
    const session = createSessionStore("s1");

    session.actions.setPhase("thinking");
    expect(session.store.streaming.phase).toBe("thinking");

    session.actions.setPhase("writing");
    expect(session.store.streaming.phase).toBe("writing");
  });

  it("setCurrentMessage tracks the active streaming message", () => {
    const session = createSessionStore("s1");

    session.actions.setCurrentMessage("m1");
    expect(session.store.streaming.currentMessageId).toBe("m1");

    session.actions.clearCurrentMessage();
    expect(session.store.streaming.currentMessageId).toBeNull();
  });

  it("addToolCall adds a tool_call part and sets current tool", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1", role: "assistant" }));

    session.actions.addToolCall("m1", "tc1", "bash", { command: "ls" });

    expect(session.store.messages.m1!.parts).toHaveLength(1);
    expect(session.store.messages.m1!.parts[0]).toEqual({
      type: "tool_call",
      toolCallId: "tc1",
      toolName: "bash",
      input: { command: "ls" },
      status: "running",
    });
    expect(session.store.streaming.currentToolName).toBe("bash");
  });

  it("completeToolCall marks the part done with result", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.addToolCall("m1", "tc1", "bash", { command: "ls" });

    session.actions.completeToolCall("m1", "tc1", "file1\nfile2");

    const part = session.store.messages.m1!.parts[0];
    expect(part).toMatchObject({
      type: "tool_call",
      status: "done",
      result: "file1\nfile2",
    });
    expect(session.store.streaming.currentToolName).toBeNull();
  });

  it("setError sets error on message and phase to error", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.setCurrentMessage("m1");

    session.actions.setError("m1", "Something broke");

    expect(session.store.messages.m1!.error).toBe("Something broke");
    expect(session.store.streaming.phase).toBe("error");
  });

  it("loadMessages replaces entire message set", () => {
    const session = createSessionStore("s1");
    const msgs = [
      makeMessage({ id: "m1", content: "first" }),
      makeMessage({ id: "m2", content: "second" }),
    ];

    session.actions.loadMessages(msgs);

    expect(Object.keys(session.store.messages)).toHaveLength(2);
    expect(session.store.messageOrder).toEqual(["m1", "m2"]);
  });

  it("reset clears everything back to idle", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.setPhase("writing");

    session.actions.reset();

    expect(Object.keys(session.store.messages)).toHaveLength(0);
    expect(session.store.messageOrder).toEqual([]);
    expect(session.store.streaming.phase).toBe("idle");
  });
});
