import type { AgentMessage } from "@sakti-code/agent";
import { describe, expect, it } from "vitest";
import {
  makeAbortEvent,
  makeAgentEndEvent,
  makeAgentStartEvent,
  makeAssistantMessage,
  makeFullTurnSequence,
  makeMessageEndEvent,
  makeMessageStartEvent,
  makeMessageUpdateTextDeltaEvent,
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

  it("message_start for user is skipped", () => {
    const { session, batcher } = setup();
    const userMsg = {
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    } as AgentMessage;
    dispatchEvent(session.actions, batcher, makeMessageStartEvent(userMsg));
    expect(session.store.messageOrder).toHaveLength(0);
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
    // The streaming text only updates `content` (via batched deltas); `parts`
    // only carries the tool_call because message_start fired with empty content.
    expect(msg.parts).toHaveLength(1);
    expect(msg.parts[0]).toMatchObject({
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
