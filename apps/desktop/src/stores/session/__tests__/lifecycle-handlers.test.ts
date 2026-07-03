import { describe, expect, it } from "vite-plus/test";
import { setupHandlers, userMsg } from "./handler-helpers.ts";

describe("lifecycle handlers", () => {
  it("agent_start sets phase to thinking", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ type: "agent_start" });
    expect(session.store.streaming.phase).toBe("thinking");
  });

  it("turn_start sets phase to thinking", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ type: "turn_start" });
    expect(session.store.streaming.phase).toBe("thinking");
  });

  it("turn_end sets phase idle + clears currentMessage but does NOT finalize turn", () => {
    const { session, dispatch } = setupHandlers();
    session.actions.startTurn({
      content: "hi",
      id: "u1",
      isStreaming: false,
      parts: [{ type: "text", text: "hi" }],
      role: "user",
      timestamp: Date.now(),
    });
    session.actions.setCurrentMessage("fake-msg");
    dispatch({
      message: { role: "assistant", content: "", timestamp: Date.now() } as never,
      toolResults: [],
      type: "turn_end",
    });
    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
    // turn_end fires per agent-loop iteration — turn should stay active
    expect(session.store.turns[0]!.working).toBe(true);
    expect(session.store.turns[0]!.endedAt).toBeNull();
  });

  it("agent_end finalizes the current turn", () => {
    const { session, dispatch } = setupHandlers();
    session.actions.startTurn({
      content: "hi",
      id: "u1",
      isStreaming: false,
      parts: [{ type: "text", text: "hi" }],
      role: "user",
      timestamp: Date.now(),
    });
    dispatch({ messages: [], type: "agent_end" });
    expect(session.store.turns[0]!.endedAt).not.toBeNull();
    expect(session.store.turns[0]!.working).toBe(false);
    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
    expect(session.store.streaming.currentToolName).toBeNull();
    expect(session.store.retry).toBeNull();
  });

  it("agent_end is safe when no turn exists", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ messages: [], type: "agent_end" });
    expect(session.store.turns).toHaveLength(0);
    expect(session.store.streaming.phase).toBe("idle");
  });

  it("abort finalizes the current turn", () => {
    const { session, dispatch } = setupHandlers();
    session.actions.startTurn({
      content: "hi",
      id: "u1",
      isStreaming: false,
      parts: [{ type: "text", text: "hi" }],
      role: "user",
      timestamp: Date.now(),
    });
    dispatch({ clearedFollowUp: [], clearedSteer: [], type: "abort" });
    expect(session.store.turns[0]!.endedAt).not.toBeNull();
    expect(session.store.turns[0]!.working).toBe(false);
    expect(session.store.streaming.phase).toBe("idle");
  });

  it("multiple turn_end + single agent_end only finalizes once", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ type: "message_start", message: userMsg("hi") });
    // Simulate 3 agent-loop iterations
    for (let i = 0; i < 3; i++) {
      dispatch({ type: "turn_start" });
      dispatch({
        message: { role: "assistant", content: "", timestamp: Date.now() } as never,
        toolResults: [],
        type: "turn_end",
      });
    }
    // Turn still active before agent_end
    expect(session.store.turns[0]!.working).toBe(true);
    dispatch({ messages: [], type: "agent_end" });
    expect(session.store.turns[0]!.working).toBe(false);
    expect(session.store.turns[0]!.endedAt).not.toBeNull();
  });
});
