import type { AgentHarnessEvent } from "@sakti-code/agent";
import { describe, expect, it } from "vitest";
import { dispatchEvent } from "../event-reducer.ts";
import { createSessionStore } from "../session-store.ts";
import { createTokenBatcher } from "../token-batcher.ts";

function setup() {
  const session = createSessionStore("s1");
  const batcher = createTokenBatcher((msgId, text) => {
    session.actions.appendToken(msgId, text);
  });
  return { session, batcher };
}

describe("event reducer", () => {
  it("agent_start sets phase to thinking", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, {
      type: "agent_start",
    } as AgentHarnessEvent);

    expect(session.store.streaming.phase).toBe("thinking");
  });

  it("message_start for assistant creates a streaming message", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    } as AgentHarnessEvent);

    expect(session.store.messageOrder).toHaveLength(1);
    const msgId = session.store.messageOrder[0]!;
    expect(session.store.messages[msgId]!.role).toBe("assistant");
    expect(session.store.messages[msgId]!.isStreaming).toBe(true);
    expect(session.store.streaming.currentMessageId).toBe(msgId);
    expect(session.store.streaming.phase).toBe("writing");
  });

  it("message_start for user is skipped (optimistic insert)", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: { role: "user", content: "hello", timestamp: Date.now() },
    } as AgentHarnessEvent);

    expect(session.store.messageOrder).toHaveLength(0);
  });

  it("message_update with text_delta batches the delta", async () => {
    const { session, batcher } = setup();

    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    } as AgentHarnessEvent);
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(session.actions, batcher, {
      type: "message_update",
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Hello",
        partial: {
          role: "assistant",
          content: [],
          api: "openai-completions",
          provider: "openai",
          model: "gpt-4",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
    } as AgentHarnessEvent);

    await Promise.resolve();

    expect(session.store.messages[msgId]!.content).toBe("Hello");
  });

  it("tool_execution_start adds a tool call part", () => {
    const { session, batcher } = setup();

    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    } as AgentHarnessEvent);
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(session.actions, batcher, {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls" },
    } as AgentHarnessEvent);

    expect(session.store.messages[msgId]!.parts).toHaveLength(1);
    expect(session.store.messages[msgId]!.parts[0]).toMatchObject({
      type: "tool_call",
      toolName: "bash",
      status: "running",
    });
    expect(session.store.streaming.phase).toBe("tool_running");
  });

  it("tool_execution_end completes the tool call", () => {
    const { session, batcher } = setup();

    dispatchEvent(session.actions, batcher, {
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    } as AgentHarnessEvent);
    const msgId = session.store.streaming.currentMessageId!;

    dispatchEvent(session.actions, batcher, {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls" },
    } as AgentHarnessEvent);

    dispatchEvent(session.actions, batcher, {
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "file1\nfile2" }] },
      isError: false,
    } as AgentHarnessEvent);

    const part = session.store.messages[msgId]!.parts[0];
    expect(part).toMatchObject({ type: "tool_call", status: "done" });
  });

  it("agent_end sets phase to idle", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, {
      type: "agent_start",
    } as AgentHarnessEvent);
    dispatchEvent(session.actions, batcher, {
      type: "agent_end",
      messages: [],
    } as AgentHarnessEvent);

    expect(session.store.streaming.phase).toBe("idle");
  });
});
