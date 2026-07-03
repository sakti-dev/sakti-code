import { describe, expect, it } from "vite-plus/test";
import { assistantMsg, assistantMsgWithUsage, setupHandlers, userMsg } from "./handler-helpers.ts";

describe("message handlers", () => {
  it("message_start for user creates a new turn", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hello"), type: "message_start" });
    expect(session.store.turns).toHaveLength(1);
    expect(session.store.turns[0]!.userMessage?.content).toBe("hello");
  });

  it("duplicate user message is ignored", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hello"), type: "message_start" });
    dispatch({ message: userMsg("hello"), type: "message_start" });
    expect(session.store.turns).toHaveLength(1);
  });

  it("different user message creates a second turn", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hello"), type: "message_start" });
    dispatch({ message: userMsg("world"), type: "message_start" });
    expect(session.store.turns).toHaveLength(2);
  });

  it("message_start for assistant creates streaming message in current turn", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    expect(session.store.turns[0]!.messages).toHaveLength(1);
    expect(session.store.turns[0]!.messages[0]!.isStreaming).toBe(true);
    expect(session.store.streaming.currentMessageId).not.toBeNull();
    expect(session.store.streaming.phase).toBe("writing");
  });

  it("message_update text appends via batcher (synchronous flush)", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({ delta: { kind: "text", text: "Hel" }, type: "message_update" });
    dispatch({ delta: { kind: "text", text: "lo" }, type: "message_update" });
    const parts = session.store.turns[0]!.messages[0]!.parts;
    expect(parts.at(-1)).toMatchObject({ type: "text", text: "Hello" });
    expect(session.store.turns[0]!.messages[0]!.content).toBe("Hello");
  });

  it("message_update thinking appends thinking token", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({ delta: { kind: "thinking", text: "hmm" }, type: "message_update" });
    dispatch({ delta: { kind: "thinking", text: " more" }, type: "message_update" });
    const parts = session.store.turns[0]!.messages[0]!.parts;
    expect(parts[0]).toMatchObject({ type: "thinking", text: "hmm more" });
  });

  it("message_update before any message_start is ignored", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ delta: { kind: "text", text: "orphan" }, type: "message_update" });
    expect(session.store.turns).toHaveLength(0);
  });

  it("message_end finalizes message and stores usage", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({ delta: { kind: "text", text: "answer" }, type: "message_update" });
    dispatch({ message: assistantMsgWithUsage(), type: "message_end" });

    const msg = session.store.turns[0]!.messages[0]!;
    expect(msg.isStreaming).toBe(false);
    expect(msg.usage).toMatchObject({ input: 100, output: 50, cost: 0.01 });
  });

  it("text after thinking creates a new text part", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({ delta: { kind: "thinking", text: "let me think" }, type: "message_update" });
    dispatch({ delta: { kind: "text", text: "answer" }, type: "message_update" });
    const parts = session.store.turns[0]!.messages[0]!.parts;
    expect(parts[0]).toMatchObject({ type: "thinking", text: "let me think" });
    expect(parts[1]).toMatchObject({ type: "text", text: "answer" });
  });

  it("text after thinking sets endedAt on thinking part", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({ delta: { kind: "thinking", text: "hmm" }, type: "message_update" });
    dispatch({ delta: { kind: "text", text: "answer" }, type: "message_update" });

    const parts = session.store.turns[0]!.messages[0]!.parts;
    expect(parts[0]).toHaveProperty("endedAt");
    expect((parts[0] as { endedAt?: number }).endedAt).toBeTypeOf("number");
  });
});
