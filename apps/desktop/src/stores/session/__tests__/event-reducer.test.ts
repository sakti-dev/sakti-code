import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vitest";
import {
  makeAbortEvent,
  makeAgentEndEvent,
  makeAgentStartEvent,
  makeAssistantMessage,
  makeAssistantMessageWithToolCall,
  makeFullTurnSequence,
  makeMessageEndEvent,
  makeMessageStartEvent,
  makeMessageUpdateTextDeltaEvent,
  makeMessageUpdateThinkingDeltaEvent,
  makeToolExecutionEndEvent,
  makeToolExecutionStartEvent,
  makeTurnEndEvent,
  makeTurnStartEvent,
} from "../../__tests__/helpers.ts";
import { dispatchEvent } from "../event-reducer.ts";
import { createSessionStore } from "../session-store.ts";
import { createTokenBatcher } from "../token-batcher.ts";

function setup() {
  const session = createSessionStore();
  const batcher = createTokenBatcher((msgId, text) => {
    session.actions.appendToken(msgId, text);
  });
  return { session, batcher };
}

describe("event reducer — individual events", () => {
  it("agent_start sets phase to thinking", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeAgentStartEvent());
    expect(session.store.streaming.phase).toBe("thinking");
  });

  it("turn_start sets phase to thinking", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeTurnStartEvent());
    expect(session.store.streaming.phase).toBe("thinking");
  });

  it("message_start for assistant creates streaming message", () => {
    const { session, batcher } = setup();
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageStartEvent(makeAssistantMessage(""))
    );

    expect(session.store.messageOrder).toHaveLength(1);
    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId]!.role).toBe("assistant");
    expect(session.store.messages[msgId]!.isStreaming).toBe(true);
    expect(session.store.streaming.currentMessageId).toBe(msgId);
    expect(session.store.streaming.phase).toBe("writing");
  });

  it("message_start for user adds user message from event stream", () => {
    const { session, batcher } = setup();
    const userMsg = {
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    } as AgentMessage;
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(userMsg));
    expect(session.store.messageOrder).toHaveLength(1);
    expect(session.store.messages[session.store.messageOrder[0]!]!.role).toBe(
      "user"
    );
  });

  it("message_start for user skips when sendPrompt already added it", () => {
    const { session, batcher } = setup();
    session.actions.addMessage({
      id: "pre-added",
      role: "user",
      content: "hello world",
      parts: [{ type: "text", text: "hello world" }],
      isStreaming: false,
      timestamp: Date.now(),
    });

    const userMsg = {
      role: "user",
      content: "hello world",
      timestamp: Date.now(),
    } as AgentMessage;
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(userMsg));

    expect(session.store.messageOrder).toHaveLength(1);
  });

  it("message_update text_delta is batched", async () => {
    const { session, batcher } = setup();
    const msg = makeAssistantMessage("");
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(msg));
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(
      session.actions,
      batcher,
      makeMessageUpdateTextDeltaEvent(msg, "Hello")
    );
    await Promise.resolve();

    expect(session.store.messages[msgId]!.content).toBe("Hello");
  });

  it("message_update thinking_delta appends to thinking part", () => {
    const { session, batcher } = setup();
    const msg = makeAssistantMessage("");
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(msg));
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(
      session.actions,
      batcher,
      makeMessageUpdateThinkingDeltaEvent(msg, "Let me think ")
    );
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageUpdateThinkingDeltaEvent(msg, "about this")
    );

    const parts = session.store.messages[msgId]!.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe("thinking");
    expect((parts[0] as { text: string }).text).toBe("Let me think about this");
  });

  it("message_end finalizes message but does NOT clear currentMessageId", () => {
    const { session, batcher } = setup();
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageStartEvent(makeAssistantMessage(""))
    );
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(
      session.actions,
      batcher,
      makeMessageEndEvent(makeAssistantMessage(""))
    );

    expect(session.store.messages[msgId]!.isStreaming).toBe(false);
    expect(session.store.streaming.currentMessageId).toBe(msgId);
  });

  it("tool_execution_start adds tool call part", () => {
    const { session, batcher } = setup();
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageStartEvent(makeAssistantMessage(""))
    );
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionStartEvent("tc1", "bash", { command: "ls" })
    );

    expect(session.store.messages[msgId]!.parts).toHaveLength(1);
    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      type: "tool_call",
      toolName: "bash",
      status: "running",
    });
    expect(session.store.streaming.phase).toBe("tool_running");
  });

  it("tool_execution_end completes tool call", () => {
    const { session, batcher } = setup();
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageStartEvent(makeAssistantMessage(""))
    );
    const msgId = session.store.streaming.currentMessageId!;
    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionStartEvent("tc1", "bash", { command: "ls" })
    );

    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionEndEvent("tc1", "bash", "file1\nfile2")
    );

    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      type: "tool_call",
      status: "done",
      result: "file1\nfile2",
    });
  });

  it("tool_execution_end with isError sets error status", () => {
    const { session, batcher } = setup();
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageStartEvent(makeAssistantMessage(""))
    );
    const msgId = session.store.streaming.currentMessageId!;
    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionStartEvent("tc1", "bash", { command: "ls" })
    );

    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionEndEvent("tc1", "bash", "command not found", true)
    );

    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      type: "tool_call",
      status: "error",
      result: "command not found",
    });
  });

  it("tool_execution_end extracts content text from structured result", () => {
    const { session, batcher } = setup();
    const msg = makeAssistantMessageWithToolCall("", {
      id: "call-1",
      name: "bash",
      args: { command: "echo hello" },
    });
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(msg));
    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionStartEvent("call-1", "bash", { command: "echo hello" })
    );

    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionEndEvent("call-1", "bash", {
        content: [{ type: "text", text: "hello\n" }],
        details: { truncation: false },
      })
    );

    const part =
      session.store.messages[session.store.messageOrder[0]!]!.parts[0]!;
    expect(part.type).toBe("tool_call");
    expect((part as { result?: string }).result).toBe("hello\n");
    expect((part as { details?: unknown }).details).toEqual({
      truncation: false,
    });
  });

  it("tool_execution_end falls back to stringify for primitive result", () => {
    const { session, batcher } = setup();
    const msg = makeAssistantMessageWithToolCall("", {
      id: "call-1",
      name: "bash",
      args: { command: "echo" },
    });
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(msg));
    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionStartEvent("call-1", "bash", { command: "echo" })
    );

    dispatchEvent(
      session.actions,
      batcher,
      makeToolExecutionEndEvent("call-1", "bash", "plain string result")
    );

    const part =
      session.store.messages[session.store.messageOrder[0]!]!.parts[0]!;
    expect((part as { result?: string }).result).toBe("plain string result");
  });

  it("turn_end clears currentMessageId and sets idle", () => {
    const { session, batcher } = setup();
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageStartEvent(makeAssistantMessage(""))
    );
    dispatchEvent(
      session.actions,
      batcher,
      makeTurnEndEvent(makeAssistantMessage("done"))
    );

    expect(session.store.streaming.currentMessageId).toBeNull();
    expect(session.store.streaming.phase).toBe("idle");
  });

  it("agent_end clears state and sets idle", () => {
    const { session, batcher } = setup();
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageStartEvent(makeAssistantMessage(""))
    );
    dispatchEvent(session.actions, batcher, makeAgentEndEvent());

    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
    expect(session.store.streaming.currentToolName).toBeNull();
  });

  it("abort clears state and sets idle", () => {
    const { session, batcher } = setup();
    dispatchEvent(
      session.actions,
      batcher,
      makeMessageStartEvent(makeAssistantMessage(""))
    );
    dispatchEvent(session.actions, batcher, makeAbortEvent());

    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
    expect(session.store.streaming.currentToolName).toBeNull();
  });
});

describe("event reducer — full lifecycle", () => {
  it("text-only turn: start → stream → end → turn_end", async () => {
    const { session, batcher } = setup();
    const events = makeFullTurnSequence({ text: "Hello world" });

    for (const event of events) {
      dispatchEvent(session.actions, batcher, event);
    }
    await Promise.resolve(); // flush batcher

    expect(session.store.messageOrder).toHaveLength(1);
    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId]!.content).toBe("Hello world");
    expect(session.store.messages[msgId]!.isStreaming).toBe(false);
    expect(session.store.streaming.phase).toBe("idle");
    expect(session.store.streaming.currentMessageId).toBeNull();
  });

  it("tool turn: text + one tool call", async () => {
    const { session, batcher } = setup();
    const events = makeFullTurnSequence({
      text: "Let me check",
      tools: [
        {
          toolCallId: "tc1",
          toolName: "bash",
          args: { command: "ls" },
          result: "file1\nfile2",
        },
      ],
    });

    for (const event of events) {
      dispatchEvent(session.actions, batcher, event);
    }
    await Promise.resolve(); // flush batcher

    const msgId = session.store.messageOrder[0]!;
    const msg = session.store.messages[msgId]!;
    expect(msg.content).toBe("Let me check");
    // Both text part and tool_call part are present.
    // (In this synchronous test, tool_call is added first via direct dispatch,
    // then text via batcher microtask flush. In the real app the order would
    // be text-then-tool because WS events arrive asynchronously.)
    expect(msg.parts).toHaveLength(2);
    const textPart = msg.parts.find((p) => p.type === "text");
    const toolPart = msg.parts.find((p) => p.type === "tool_call");
    expect(textPart).toMatchObject({ type: "text", text: "Let me check" });
    expect(toolPart).toMatchObject({
      type: "tool_call",
      toolName: "bash",
      status: "done",
      result: "file1\nfile2",
    });
    expect(session.store.streaming.phase).toBe("idle");
  });

  it("tool turn with error: tool fails", () => {
    const { session, batcher } = setup();
    const events = makeFullTurnSequence({
      text: "",
      tools: [
        {
          toolCallId: "tc1",
          toolName: "bash",
          args: { command: "exit 1" },
          result: "Error: exit code 1",
          isError: true,
        },
      ],
    });

    for (const event of events) {
      dispatchEvent(session.actions, batcher, event);
    }

    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      status: "error",
      result: "Error: exit code 1",
    });
  });

  it("multiple tools in one turn", () => {
    const { session, batcher } = setup();
    const events = makeFullTurnSequence({
      text: "",
      tools: [
        {
          toolCallId: "tc1",
          toolName: "read",
          args: { path: "a.ts" },
          result: "content a",
        },
        {
          toolCallId: "tc2",
          toolName: "read",
          args: { path: "b.ts" },
          result: "content b",
        },
      ],
    });

    for (const event of events) {
      dispatchEvent(session.actions, batcher, event);
    }

    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId]!.parts).toHaveLength(2);
    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      toolCallId: "tc1",
      status: "done",
    });
    expect(session.store.messages[msgId]!.parts[1]).toMatchObject({
      toolCallId: "tc2",
      status: "done",
    });
  });
});
