import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../types";

describe("AgentEvent discriminated union", () => {
  it("agent_start event", () => {
    const e: AgentEvent = {
      type: "agent_start",
      sessionId: "s1",
      timestamp: 0,
    };
    expect(e.type).toBe("agent_start");
  });

  it("agent_end event", () => {
    const e: AgentEvent = { type: "agent_end", sessionId: "s1", timestamp: 0 };
    expect(e.type).toBe("agent_end");
  });

  it("turn_start and turn_end events", () => {
    const start: AgentEvent = {
      type: "turn_start",
      turnIndex: 0,
      timestamp: 0,
    };
    const end: AgentEvent = {
      type: "turn_end",
      turnIndex: 0,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: 0,
      },
      toolResults: [],
      timestamp: 0,
    };
    expect(start.type).toBe("turn_start");
    expect(end.type).toBe("turn_end");
    if (end.type === "turn_end") {
      expect(end.toolResults).toEqual([]);
      expect(end.message.role).toBe("assistant");
    }
  });

  it("message lifecycle events", () => {
    const ms: AgentEvent = { type: "message_start", timestamp: 0 };
    const me: AgentEvent = { type: "message_end", timestamp: 0 };
    expect(ms.type).toBe("message_start");
    expect(me.type).toBe("message_end");

    const userMsg: AgentEvent = {
      type: "message_start",
      timestamp: 0,
      message: { role: "user", content: "hello", timestamp: 0 },
    };
    expect(userMsg.type).toBe("message_start");
    if (userMsg.type === "message_start" && userMsg.message) {
      expect(userMsg.message.role).toBe("user");
      expect(userMsg.message.content).toBe("hello");
    }
  });

  it("text_delta message update", () => {
    const e: AgentEvent = {
      type: "message_update",
      update: { type: "text_delta", delta: "hello" },
      timestamp: 0,
    };
    if (e.type === "message_update" && e.update.type === "text_delta") {
      expect(e.update.delta).toBe("hello");
    }
  });

  it("thinking_delta message update", () => {
    const e: AgentEvent = {
      type: "message_update",
      update: { type: "thinking_delta", delta: "hmm" },
      timestamp: 0,
    };
    if (e.type === "message_update" && e.update.type === "thinking_delta") {
      expect(e.update.delta).toBe("hmm");
    }
  });

  it("toolcall message updates", () => {
    const start: AgentEvent = {
      type: "message_update",
      update: { type: "toolcall_start", contentIndex: 0 },
      timestamp: 0,
    };
    const delta: AgentEvent = {
      type: "message_update",
      update: { type: "toolcall_delta", contentIndex: 0, delta: '{"path"' },
      timestamp: 0,
    };
    const end: AgentEvent = {
      type: "message_update",
      update: {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "tc_1",
          name: "read",
          arguments: { path: "x" },
        },
      },
      timestamp: 0,
    };
    expect(start.type).toBe("message_update");
    if (
      delta.type === "message_update" &&
      delta.update.type === "toolcall_delta"
    ) {
      expect(delta.update.delta).toBe('{"path"');
    }
    if (end.type === "message_update" && end.update.type === "toolcall_end") {
      expect(end.update.toolCall.name).toBe("read");
    }
  });

  it("tool_execution events", () => {
    const start: AgentEvent = {
      type: "tool_execution_start",
      toolCallId: "tc_1",
      toolName: "read",
      timestamp: 0,
    };
    const update: AgentEvent = {
      type: "tool_execution_update",
      toolCallId: "tc_1",
      toolName: "read",
      accumulated: "partial...",
      timestamp: 0,
    };
    const end: AgentEvent = {
      type: "tool_execution_end",
      toolCallId: "tc_1",
      toolName: "read",
      result: { content: "done", terminate: false },
      timestamp: 0,
    };
    expect(start.type).toBe("tool_execution_start");
    expect(update.type).toBe("tool_execution_update");
    expect(end.type).toBe("tool_execution_end");
    if (end.type === "tool_execution_end") {
      expect(end.toolName).toBe("read");
    }
  });

  it("error event", () => {
    const e: AgentEvent = {
      type: "error",
      message: "LLM failed",
      timestamp: 0,
    };
    expect(e.type).toBe("error");
    if (e.type === "error") {
      expect(e.message).toBe("LLM failed");
    }
  });

  it("compaction events", () => {
    const start: AgentEvent = { type: "compaction_start", timestamp: 0 };
    const end: AgentEvent = {
      type: "compaction_end",
      tokensBefore: 100_000,
      tokensAfter: 30_000,
      timestamp: 0,
    };
    expect(start.type).toBe("compaction_start");
    if (end.type === "compaction_end") {
      expect(end.tokensAfter).toBe(30_000);
    }
  });

  it("retry event", () => {
    const e: AgentEvent = {
      type: "retry",
      attempt: 2,
      maxRetries: 3,
      delayMs: 2000,
      timestamp: 0,
    };
    if (e.type === "retry") {
      expect(e.attempt).toBe(2);
      expect(e.maxRetries).toBe(3);
      expect(e.delayMs).toBe(2000);
    }
  });

  it("isAgentEvent runtime guard covers all types", async () => {
    const { isAgentEvent } = await import("../types");
    const events: AgentEvent[] = [
      { type: "agent_start", sessionId: "s1", timestamp: 0 },
      { type: "agent_end", sessionId: "s1", timestamp: 0 },
      { type: "turn_start", turnIndex: 0, timestamp: 0 },
      { type: "turn_end", turnIndex: 0, timestamp: 0 },
      { type: "message_start", timestamp: 0 },
      { type: "message_end", timestamp: 0 },
      {
        type: "message_update",
        update: { type: "text_delta", delta: "x" },
        timestamp: 0,
      },
      {
        type: "tool_execution_start",
        toolCallId: "tc",
        toolName: "r",
        timestamp: 0,
      },
      {
        type: "tool_execution_update",
        toolCallId: "tc",
        accumulated: "p",
        timestamp: 0,
      },
      {
        type: "tool_execution_end",
        toolCallId: "tc",
        result: { content: "r", terminate: false },
        timestamp: 0,
      },
      { type: "error", message: "err", timestamp: 0 },
      { type: "compaction_start", timestamp: 0 },
      {
        type: "compaction_end",
        tokensBefore: 100,
        tokensAfter: 50,
        timestamp: 0,
      },
      { type: "retry", attempt: 1, maxRetries: 3, delayMs: 1000, timestamp: 0 },
    ];
    for (const e of events) {
      expect(isAgentEvent(e)).toBe(true);
    }
    expect(isAgentEvent(null)).toBe(false);
    expect(isAgentEvent({})).toBe(false);
  });
});
