import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentMessage, SessionStore } from "../types";
import { MockEventStream } from "./helpers";

// Mock streamSimple before importing loop
vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return {
    ...actual,
    streamSimple: vi.fn() as any,
  };
});

const { streamSimple: _streamSimple } = await import("@earendil-works/pi-ai");
const streamSimple = _streamSimple as any;
const { createAgentLoop } = await import("../loop");

function createMockStore(): SessionStore {
  const messages: Map<string, AgentMessage[]> = new Map();
  return {
    loadMessages: vi.fn(async (id) => messages.get(id) ?? []),
    appendMessage: vi.fn(async (id, msg) => {
      const list = messages.get(id) ?? [];
      list.push(msg);
      messages.set(id, list);
    }),
    replaceMessages: vi.fn(async (id, msgs) => {
      messages.set(id, [...msgs]);
    }),
  };
}

function createTestModel() {
  return {
    id: "test-model",
    name: "Test",
    api: "openai-completions" as const,
    provider: "openai",
    baseUrl: "https://api.openai.com",
    reasoning: false,
    input: ["text"] as ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  };
}

function createTextStream(text: string) {
  const stream = new MockEventStream();
  const now = Date.now();
  stream.push({
    type: "start",
    partial: {
      role: "assistant",
      content: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: now,
    } as any,
  });
  stream.push({ type: "text_start", contentIndex: 0, partial: {} as any });
  stream.push({
    type: "text_delta",
    contentIndex: 0,
    delta: text,
    partial: {} as any,
  });
  stream.push({
    type: "text_end",
    contentIndex: 0,
    content: text,
    partial: {} as any,
  });
  stream.push({
    type: "done",
    reason: "stop",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      usage: {
        input: 10,
        output: text.length,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 10 + text.length,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: now,
    },
  });
  return stream;
}

function createToolCallStream(toolCall: {
  id: string;
  name: string;
  args: Record<string, unknown>;
}) {
  const stream = new MockEventStream();
  const now = Date.now();
  stream.push({
    type: "start",
    partial: {
      role: "assistant",
      content: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: now,
    } as any,
  });
  stream.push({ type: "toolcall_start", contentIndex: 0, partial: {} as any });
  stream.push({
    type: "toolcall_delta",
    contentIndex: 0,
    delta: JSON.stringify(toolCall.args),
    partial: {} as any,
  });
  stream.push({
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: {
      type: "toolCall",
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.args,
    },
  });
  stream.push({
    type: "done",
    reason: "toolUse",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.args,
        },
      ],
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: now,
    },
  });
  return stream;
}

describe("AgentLoop", () => {
  it("simple prompt → LLM text response → yields events, appends messages", async () => {
    const store = createMockStore();
    vi.mocked(streamSimple).mockImplementation(() =>
      createTextStream("Hello!")
    );

    const loop = createAgentLoop({
      sessionId: "s1",
      model: createTestModel(),
      tools: [],
      store,
    });

    const events: AgentEvent[] = [];
    for await (const e of loop.prompt("Say hello")) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "agent_start")).toBe(true);
    expect(events.some((e) => e.type === "turn_start")).toBe(true);
    expect(events.some((e) => e.type === "message_start")).toBe(true);
    expect(
      events.filter((e) => e.type === "message_update").length
    ).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "message_end")).toBe(true);
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    expect(store.appendMessage).toHaveBeenCalledTimes(2); // user + assistant
  });

  it("LLM returns tool call → tool executes → result appended → LLM responds with text", async () => {
    const store = createMockStore();
    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolCallStream({
          id: "tc_1",
          name: "read",
          args: { path: "src/index.ts" },
        });
      }
      return createTextStream("I read the file");
    });

    const readTool = {
      name: "read",
      description: "Read a file",
      parameters: {},
      execute: async () => ({ content: "const x = 1", terminate: false }),
    };

    const loop = createAgentLoop({
      sessionId: "s1",
      model: createTestModel(),
      tools: [readTool],
      store,
    });

    const events: AgentEvent[] = [];
    for await (const e of loop.prompt("Read the file")) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "tool_execution_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_execution_end")).toBe(true);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    // user + assistant(with tool call) + tool result + assistant(text)
    expect(store.appendMessage).toHaveBeenCalledTimes(4);
  });

  it("tool execution error → error result appended → loop continues", async () => {
    const store = createMockStore();
    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolCallStream({
          id: "tc_1",
          name: "bash",
          args: { command: "false" },
        });
      }
      return createTextStream("I see the command failed");
    });

    const bashTool = {
      name: "bash",
      description: "Run command",
      parameters: {},
      execute: async () => {
        throw new Error("Command failed");
      },
    };

    const loop = createAgentLoop({
      sessionId: "s1",
      model: createTestModel(),
      tools: [bashTool],
      store,
    });

    const events: AgentEvent[] = [];
    for await (const e of loop.prompt("Run a command")) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "tool_execution_end")).toBe(true);
    expect(store.appendMessage).toHaveBeenCalledTimes(4);
  });

  it("tool result with terminate → loop stops without sending back to LLM", async () => {
    const store = createMockStore();
    vi.mocked(streamSimple).mockImplementation(() =>
      createToolCallStream({ id: "tc_1", name: "kill", args: {} })
    );

    const killTool = {
      name: "kill",
      description: "Kill",
      parameters: {},
      execute: async () => ({ content: "killed", terminate: true }),
    };

    const loop = createAgentLoop({
      sessionId: "s1",
      model: createTestModel(),
      tools: [killTool],
      store,
    });

    const events: AgentEvent[] = [];
    for await (const e of loop.prompt("Kill it")) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    // user + assistant(tool call) + tool result = 3 (no second LLM call)
    expect(store.appendMessage).toHaveBeenCalledTimes(3);
  });

  it("unknown tool → error result appended → loop continues", async () => {
    const store = createMockStore();
    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolCallStream({
          id: "tc_1",
          name: "nonexistent",
          args: {},
        });
      }
      return createTextStream("ok");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: createTestModel(),
      tools: [],
      store,
    });

    const events: AgentEvent[] = [];
    for await (const e of loop.prompt("Use tool")) {
      events.push(e);
    }

    const toolEnd = events.find((e) => e.type === "tool_execution_end") as any;
    expect(toolEnd).toBeDefined();
    expect(toolEnd.result.isError).toBe(true);
  });

  it("tool onUpdate callback yields tool_execution_update events", async () => {
    const store = createMockStore();
    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return createToolCallStream({
          id: "tc_1",
          name: "bash",
          args: { command: "echo hi" },
        });
      }
      return createTextStream("done");
    });

    const bashTool = {
      name: "bash",
      description: "Run command",
      parameters: {},
      execute: async (
        _id: string,
        _args: any,
        _signal: any,
        onUpdate?: (p: string) => void
      ) => {
        onUpdate?.("line 1\n");
        onUpdate?.("line 2\n");
        return { content: "line 1\nline 2\n", terminate: false };
      },
    };

    const loop = createAgentLoop({
      sessionId: "s1",
      model: createTestModel(),
      tools: [bashTool],
      store,
    });

    const events: AgentEvent[] = [];
    for await (const e of loop.prompt("Run it")) {
      events.push(e);
    }

    const update = events.find(
      (e) => e.type === "tool_execution_update"
    ) as any;
    expect(update).toBeDefined();
    expect(update.accumulated).toBe("line 1\nline 2\n");
  });
});
