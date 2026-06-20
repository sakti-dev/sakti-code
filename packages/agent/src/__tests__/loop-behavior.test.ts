import { describe, expect, it, vi } from "vitest";
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  SessionStore,
} from "../types";

vi.mock("@earendil-works/pi-ai", () => ({
  streamSimple: vi.fn(),
}));

const { streamSimple: _streamSimple } = await import("@earendil-works/pi-ai");
const streamSimple = _streamSimple as any;
const { createAgentLoop } = await import("../loop");

class MockEventStream<T> implements AsyncIterable<T> {
  private readonly events: T[] = [];
  push(event: T) {
    this.events.push(event);
  }
  async *[Symbol.asyncIterator]() {
    for (const e of this.events) {
      yield e;
    }
  }
}

function createMockStore(): SessionStore {
  const messages = new Map<string, AgentMessage[]>();
  return {
    loadMessages: vi.fn(async (id: string) => messages.get(id) ?? []),
    appendMessage: vi.fn(async (id: string, msg: AgentMessage) => {
      const list = messages.get(id) ?? [];
      list.push(msg);
      messages.set(id, list);
    }),
    replaceMessages: vi.fn(async (id: string, msgs: AgentMessage[]) => {
      messages.set(id, [...msgs]);
    }),
  };
}

const testModel = {
  id: "test",
  name: "Test",
  api: "openai-completions" as const,
  provider: "openai",
  baseUrl: "",
  reasoning: false,
  input: ["text"] as ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
};

const basePartial: any = {
  role: "assistant",
  content: [],
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  api: "openai-completions",
  provider: "openai",
  model: "test",
};

function textStream(text: string) {
  const s = new MockEventStream();
  const now = Date.now();
  s.push({
    type: "start",
    partial: { ...basePartial, stopReason: "stop", timestamp: now },
  });
  s.push({ type: "text_start", contentIndex: 0, partial: {} as any });
  s.push({
    type: "text_delta",
    contentIndex: 0,
    delta: text,
    partial: {} as any,
  });
  s.push({
    type: "text_end",
    contentIndex: 0,
    content: text,
    partial: {} as any,
  });
  s.push({
    type: "done",
    reason: "stop",
    message: {
      ...basePartial,
      content: [{ type: "text", text }],
      stopReason: "stop",
      timestamp: now,
    },
  });
  return s;
}

function toolCallStream(
  toolName: string,
  args: Record<string, unknown>,
  id = "tc_1"
) {
  const s = new MockEventStream();
  const now = Date.now();
  s.push({
    type: "start",
    partial: { ...basePartial, stopReason: "toolUse", timestamp: now },
  });
  s.push({ type: "toolcall_start", contentIndex: 0, partial: {} as any });
  s.push({
    type: "toolcall_delta",
    contentIndex: 0,
    delta: JSON.stringify(args),
    partial: {} as any,
  });
  s.push({
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: { type: "toolCall", id, name: toolName, arguments: args },
    partial: {} as any,
  });
  s.push({
    type: "done",
    reason: "toolUse",
    message: {
      ...basePartial,
      stopReason: "toolUse",
      timestamp: now,
      content: [{ type: "toolCall", id, name: toolName, arguments: args }],
    },
  });
  return s;
}

async function collectEvents(
  gen: AsyncIterable<AgentEvent>
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

describe("Agent loop event ordering", () => {
  it("emits events in correct order for a simple text turn", async () => {
    const store = createMockStore();
    vi.mocked(streamSimple).mockReturnValue(textStream("Hello!"));

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });
    const events = await collectEvents(loop.prompt("hi"));

    const types = events.map((e) => e.type);
    expect(types.indexOf("agent_start")).toBeLessThan(
      types.indexOf("turn_start")
    );
    expect(types.indexOf("turn_start")).toBeLessThan(
      types.indexOf("message_start")
    );
    expect(types.indexOf("message_start")).toBeLessThan(
      types.indexOf("message_end")
    );
    expect(types.indexOf("message_end")).toBeLessThan(
      types.indexOf("turn_end")
    );
    expect(types.indexOf("turn_end")).toBeLessThan(types.indexOf("agent_end"));
  });

  it("turn_end carries the final assistant message", async () => {
    const store = createMockStore();
    vi.mocked(streamSimple).mockReturnValue(textStream("Done!"));

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });
    const events = await collectEvents(loop.prompt("hi"));

    const turnEnd = events.find(
      (e): e is Extract<AgentEvent, { type: "turn_end" }> =>
        e.type === "turn_end"
    );
    expect(turnEnd).toBeDefined();
    expect(turnEnd?.message.role).toBe("assistant");
    expect(turnEnd?.toolResults).toEqual([]);
  });
});

describe("Agent loop tool execution", () => {
  it("executes tool and emits tool_execution events in order", async () => {
    const store = createMockStore();
    const echoTool: AgentTool = {
      name: "echo",
      description: "Echoes input",
      parameters: {
        type: "object",
        properties: { msg: { type: "string" } },
        required: ["msg"],
      },
      execute: async () => ({ content: "echoed", terminate: false }),
    };

    // First call: tool use; second call: text response
    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return toolCallStream("echo", { msg: "hello" });
      }
      return textStream("All done!");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [echoTool],
      store,
    });
    const events = await collectEvents(loop.prompt("use echo"));

    const types = events.map((e) => e.type);
    // Tool execution events should be between two message_end events
    const firstMessageEnd = types.indexOf("message_end");
    const toolStart = types.indexOf("tool_execution_start");
    const toolEnd = types.indexOf("tool_execution_end");
    expect(toolStart).toBeGreaterThan(firstMessageEnd);
    expect(toolEnd).toBeGreaterThan(toolStart);

    // Tool execution_end carries toolName and result
    const execEnd = events.find(
      (e): e is Extract<AgentEvent, { type: "tool_execution_end" }> =>
        e.type === "tool_execution_end"
    );
    expect(execEnd?.toolName).toBe("echo");
    expect(execEnd?.result.content).toBe("echoed");

    // Should have two turns (tool call turn + final text turn)
    const turnEnds = events.filter((e) => e.type === "turn_end");
    expect(turnEnds.length).toBe(2);
  });

  it("tool with terminate=true stops the loop", async () => {
    const store = createMockStore();
    const terminateTool: AgentTool = {
      name: "stop",
      description: "Stops the agent",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "stopping", terminate: true }),
    };

    vi.mocked(streamSimple).mockReturnValue(toolCallStream("stop", {}));

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [terminateTool],
      store,
    });
    const events = await collectEvents(loop.prompt("stop"));

    // Agent should end after tool terminates
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    // Should NOT have a second turn
    const turnEnds = events.filter((e) => e.type === "turn_end");
    expect(turnEnds.length).toBe(1);
  });

  it("persists messages to store (user, assistant, tool result)", async () => {
    const store = createMockStore();
    const readTool: AgentTool = {
      name: "read",
      description: "Read",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute: async () => ({ content: "file contents", terminate: false }),
    };

    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return toolCallStream("read", { path: "x" });
      }
      return textStream("Done reading");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [readTool],
      store,
    });
    await collectEvents(loop.prompt("read x"));

    expect(store.appendMessage).toHaveBeenCalledTimes(4); // user + assistant1 + tool + assistant2
  });
});

describe("Agent loop error/aborted turn persistence (pi agent-loop.ts:196)", () => {
  it("persists the error assistant message on stream error", async () => {
    const store = createMockStore();
    const s = new MockEventStream();
    const now = Date.now();
    const errorPiMessage: any = {
      role: "assistant",
      content: [{ type: "text", text: "billing exceeded" }],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      errorMessage: "billing exceeded",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: now,
    };
    s.push({ type: "start", partial: errorPiMessage });
    s.push({ type: "error", reason: "error", error: errorPiMessage });

    vi.mocked(streamSimple).mockReturnValue(s);
    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });
    const events = await collectEvents(loop.prompt("hi"));

    // (a) error event is emitted live
    expect(events.some((e) => e.type === "error")).toBe(true);
    // (b) the error assistant message is persisted
    const storedMessages = store.loadMessages as any;
    const allMsgs = (await storedMessages("s1")) as AgentMessage[];
    const errorMsg = allMsgs.find(
      (m: AgentMessage) => m.role === "assistant"
    ) as any;
    expect(errorMsg).toBeDefined();
    expect(errorMsg.stopReason).toBe("error");
    expect(errorMsg.errorMessage).toBe("billing exceeded");
  });

  it("persists the aborted assistant message on caller abort", async () => {
    const store = createMockStore();
    const s = new MockEventStream();
    const now = Date.now();
    const abortedPiMessage: any = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "aborted",
      errorMessage: "aborted",
      api: "openai-completions",
      provider: "openai",
      model: "test",
      timestamp: now,
    };
    // pi-ai pushes the error event when it detects the abort, so the
    // error event carries the aborted message BEFORE our code checks the signal.
    s.push({ type: "start", partial: abortedPiMessage });
    s.push({ type: "error", reason: "aborted", error: abortedPiMessage });

    vi.mocked(streamSimple).mockReturnValue(s);
    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });
    // Don't actually abort — just simulate a stream that terminates
    // with stopReason:aborted (the way pi-ai does when it detects the signal)
    await collectEvents(loop.prompt("hi"));

    const storedMessages = store.loadMessages as any;
    const allMsgs = (await storedMessages("s1")) as AgentMessage[];
    const abortedMsg = allMsgs.find(
      (m: AgentMessage) => m.role === "assistant"
    ) as any;
    expect(abortedMsg).toBeDefined();
    expect(abortedMsg.stopReason).toBe("aborted");
  });
});
