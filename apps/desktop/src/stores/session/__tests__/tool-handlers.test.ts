import { describe, expect, it } from "vite-plus/test";
import { assistantMsg, setupHandlers, userMsg } from "./handler-helpers.ts";

describe("tool handlers", () => {
  it("tool_execution_start adds tool_call part and sets phase", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({
      args: { path: "/foo" },
      toolCallId: "tc1",
      toolName: "read",
      type: "tool_execution_start",
    });
    const parts = session.store.turns[0]!.summary!.parts;
    expect(parts.at(-1)).toMatchObject({
      type: "tool_call",
      toolName: "read",
      status: "running",
    });
    expect(session.store.streaming.phase).toBe("tool_running");
    expect(session.store.streaming.currentToolName).toBe("read");
  });

  it("tool_execution_end completes the tool_call with result", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({
      args: {},
      toolCallId: "tc1",
      toolName: "read",
      type: "tool_execution_start",
    });
    dispatch({
      isError: false,
      result: { content: [{ type: "text", text: "file contents" }] },
      toolCallId: "tc1",
      toolName: "read",
      type: "tool_execution_end",
    });
    const part = session.store.turns[0]!.summary!.parts.find((p) => p.type === "tool_call");
    expect(part).toMatchObject({
      type: "tool_call",
      status: "done",
      result: "file contents",
    });
    expect(session.store.streaming.currentToolName).toBeNull();
  });

  it("tool_execution_end with isError marks status error", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({
      args: {},
      toolCallId: "tc1",
      toolName: "bash",
      type: "tool_execution_start",
    });
    dispatch({
      isError: true,
      result: "command failed",
      toolCallId: "tc1",
      toolName: "bash",
      type: "tool_execution_end",
    });
    const part = session.store.turns[0]!.summary!.parts.find((p) => p.type === "tool_call");
    expect(part).toMatchObject({ type: "tool_call", status: "error" });
  });

  it("propose_session tool sets proposedSession", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({ message: userMsg("hi"), type: "message_start" });
    dispatch({ message: assistantMsg(), type: "message_start" });
    dispatch({
      args: { title: "My Session", message: "Let's build X" },
      toolCallId: "tc1",
      toolName: "propose_session",
      type: "tool_execution_start",
    });
    expect(session.store.proposedSession).toMatchObject({
      title: "My Session",
      message: "Let's build X",
    });
  });
});
