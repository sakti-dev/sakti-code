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

    const lastMsgStartIdx = types.lastIndexOf("message_start");
    const lastMsgEndIdx = types.lastIndexOf("message_end");
    const turnStartIdx = types.indexOf("turn_start");
    expect(turnStartIdx).toBeLessThan(lastMsgStartIdx);
    expect(lastMsgStartIdx).toBeLessThan(lastMsgEndIdx);

    const turnEndIdx = types.indexOf("turn_end");
    expect(lastMsgEndIdx).toBeLessThan(turnEndIdx);
    expect(turnEndIdx).toBeLessThan(types.indexOf("agent_end"));
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
      toolExecutionMode: "sequential",
    });
    await collectEvents(loop.prompt("read x"));

    expect(store.appendMessage).toHaveBeenCalledTimes(4); // user + assistant1 + tool + assistant2
  });
});

describe("Agent loop message lifecycle", () => {
  it("wraps the user prompt in message_start/message_end with payload", async () => {
    const store = createMockStore();
    vi.mocked(streamSimple).mockReturnValue(textStream("Hello!"));

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });
    const events = await collectEvents(loop.prompt("hello"));

    const types = events.map((e) => e.type);

    const agentStartIdx = types.indexOf("agent_start");
    const turnStartIdx = types.indexOf("turn_start");

    const promptMsgStarts = events
      .map((e, i) => ({ e, i }))
      .filter(
        (x) =>
          x.e.type === "message_start" &&
          x.e.message?.role === "user" &&
          (x.e.message as any).content === "hello"
      );
    expect(promptMsgStarts.length).toBe(1);
    const promptMsgStartIdx = promptMsgStarts[0]!.i;

    const promptMsgEnds = events
      .map((e, i) => ({ e, i }))
      .filter(
        (x) =>
          x.e.type === "message_end" &&
          x.e.message?.role === "user" &&
          (x.e.message as any).content === "hello"
      );
    expect(promptMsgEnds.length).toBe(1);
    const promptMsgEndIdx = promptMsgEnds[0]!.i;

    expect(promptMsgStartIdx).toBeGreaterThan(agentStartIdx);
    expect(promptMsgEndIdx).toBeLessThan(turnStartIdx);
    expect(promptMsgStartIdx).toBeLessThan(promptMsgEndIdx);
  });

  it("wraps each injected steer in its own message_start/message_end with payload", async () => {
    const store = createMockStore();
    vi.mocked(streamSimple).mockReturnValue(textStream("Hello!"));

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });

    loop.steer("steer one");
    loop.steer("steer two");
    const events = await collectEvents(loop.prompt("hi"));

    const steer1Starts = events.filter(
      (e) =>
        e.type === "message_start" &&
        e.message?.role === "user" &&
        (e.message as any).content === "steer one"
    );
    const steer1Ends = events.filter(
      (e) =>
        e.type === "message_end" &&
        e.message?.role === "user" &&
        (e.message as any).content === "steer one"
    );
    expect(steer1Starts.length).toBe(1);
    expect(steer1Ends.length).toBe(1);

    const steer2Starts = events.filter(
      (e) =>
        e.type === "message_start" &&
        e.message?.role === "user" &&
        (e.message as any).content === "steer two"
    );
    const steer2Ends = events.filter(
      (e) =>
        e.type === "message_end" &&
        e.message?.role === "user" &&
        (e.message as any).content === "steer two"
    );
    expect(steer2Starts.length).toBe(1);
    expect(steer2Ends.length).toBe(1);
  });

  it("wraps each tool-result message in message_start/message_end with payload", async () => {
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

    const toolMsgStarts = events.filter(
      (e) => e.type === "message_start" && e.message?.role === "tool"
    );
    const toolMsgEnds = events.filter(
      (e) => e.type === "message_end" && e.message?.role === "tool"
    );
    expect(toolMsgStarts.length).toBe(1);
    expect(toolMsgEnds.length).toBe(1);

    const types = events.map((e) => e.type);
    const toolExecEndIdx = types.indexOf("tool_execution_end");
    const toolMsgStartIdx = events.findIndex(
      (e) => e.type === "message_start" && e.message?.role === "tool"
    );
    expect(toolExecEndIdx).toBeLessThan(toolMsgStartIdx);
  });

  it("assistant-stream message_start and message_end carry the message payload", async () => {
    const store = createMockStore();
    vi.mocked(streamSimple).mockReturnValue(textStream("Hello!"));

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [],
      store,
    });
    const events = await collectEvents(loop.prompt("hi"));

    const assistantMsgStarts = events.filter(
      (e) => e.type === "message_start" && e.message?.role === "assistant"
    );
    const assistantMsgEnds = events.filter(
      (e) => e.type === "message_end" && e.message?.role === "assistant"
    );
    expect(assistantMsgStarts.length).toBe(1);
    expect(assistantMsgEnds.length).toBe(1);

    const endPayload = assistantMsgEnds[0]!.message!;
    expect(endPayload.role).toBe("assistant");
    expect((endPayload as any).content).toEqual([
      { type: "text", text: "Hello!" },
    ]);
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

function multiToolCallStream(
  tools: { name: string; args: Record<string, unknown>; id: string }[]
) {
  const s = new MockEventStream();
  const now = Date.now();
  const toolCalls = tools.map((t) => ({
    type: "toolCall" as const,
    id: t.id,
    name: t.name,
    arguments: t.args,
  }));
  s.push({
    type: "start",
    partial: { ...basePartial, stopReason: "toolUse", timestamp: now },
  });
  for (let i = 0; i < toolCalls.length; i++) {
    s.push({ type: "toolcall_start", contentIndex: i, partial: {} as any });
    s.push({
      type: "toolcall_delta",
      contentIndex: i,
      delta: JSON.stringify(tools[i].args),
      partial: {} as any,
    });
    s.push({
      type: "toolcall_end",
      contentIndex: i,
      toolCall: toolCalls[i],
      partial: {} as any,
    });
  }
  s.push({
    type: "done",
    reason: "toolUse",
    message: {
      ...basePartial,
      stopReason: "toolUse",
      timestamp: now,
      content: toolCalls,
    },
  });
  return s;
}

describe("Agent loop tool batch termination (AND semantics)", () => {
  it("mixed terminate batch (one true, one false) does NOT terminate", async () => {
    const store = createMockStore();
    const terminateTool: AgentTool = {
      name: "stop",
      description: "Stops",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "stop", terminate: true }),
    };
    const continueTool: AgentTool = {
      name: "go",
      description: "Continues",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "go", terminate: false }),
    };

    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return multiToolCallStream([
          { name: "stop", args: {}, id: "tc_1" },
          { name: "go", args: {}, id: "tc_2" },
        ]);
      }
      return textStream("Continuing after mixed batch");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [terminateTool, continueTool],
      store,
    });
    const events = await collectEvents(loop.prompt("mixed"));

    const turnEnds = events.filter((e) => e.type === "turn_end");
    expect(turnEnds.length).toBe(2);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
  });

  it("all-terminate batch DOES terminate", async () => {
    const store = createMockStore();
    const tool: AgentTool = {
      name: "stop",
      description: "Stops",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "stop", terminate: true }),
    };

    vi.mocked(streamSimple).mockReturnValue(
      multiToolCallStream([
        { name: "stop", args: {}, id: "tc_1" },
        { name: "stop", args: {}, id: "tc_2" },
      ])
    );

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [tool],
      store,
    });
    const events = await collectEvents(loop.prompt("all stop"));

    const turnEnds = events.filter((e) => e.type === "turn_end");
    expect(turnEnds.length).toBe(1);
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
  });

  it("single-tool terminate still terminates (regression)", async () => {
    const store = createMockStore();
    const terminateTool: AgentTool = {
      name: "stop",
      description: "Stops",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "stop", terminate: true }),
    };

    vi.mocked(streamSimple).mockReturnValue(toolCallStream("stop", {}));

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [terminateTool],
      store,
    });
    const events = await collectEvents(loop.prompt("stop"));

    const turnEnds = events.filter((e) => e.type === "turn_end");
    expect(turnEnds.length).toBe(1);
  });
});

describe("Agent loop abort breaks tool batch", () => {
  it("sequential batch: abort after tool 2 skips tool 3", async () => {
    const store = createMockStore();
    let executeCount = 0;
    let abortAfterTwo: (() => void) | undefined;

    const tool: AgentTool = {
      name: "slow",
      description: "Slow tool",
      parameters: { type: "object", properties: {} },
      execute: async (_id, _args, _signal) => {
        executeCount++;
        if (executeCount === 2 && abortAfterTwo) {
          abortAfterTwo();
        }
        return { content: `run ${executeCount}`, terminate: false };
      },
    };

    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return multiToolCallStream([
          { name: "slow", args: {}, id: "tc_1" },
          { name: "slow", args: {}, id: "tc_2" },
          { name: "slow", args: {}, id: "tc_3" },
        ]);
      }
      return textStream("done");
    });

    const abortController = new AbortController();
    abortAfterTwo = () => abortController.abort();

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [tool],
      store,
      toolExecutionMode: "sequential",
    });
    const events = await collectEvents(
      loop.prompt("run", abortController.signal)
    );

    expect(executeCount).toBeLessThan(3);
    const toolResultMsgs = events.filter(
      (e) => e.type === "message_start" && e.message?.role === "tool"
    );
    expect(toolResultMsgs.length).toBeLessThan(3);
    expect(toolResultMsgs.length).toBeGreaterThan(0);
  });
});

describe("Agent loop parallel tool execution", () => {
  it("two tools execute concurrently in parallel mode", async () => {
    const store = createMockStore();
    const startTimes: number[] = [];
    const tool: AgentTool = {
      name: "slow",
      description: "Slow tool",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        return { content: "done", terminate: false };
      },
    };

    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return multiToolCallStream([
          { name: "slow", args: {}, id: "tc_1" },
          { name: "slow", args: {}, id: "tc_2" },
        ]);
      }
      return textStream("all done");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [tool],
      store,
      toolExecutionMode: "parallel",
    });
    await collectEvents(loop.prompt("run"));

    expect(startTimes.length).toBe(2);
    expect(Math.abs(startTimes[0]! - startTimes[1]!)).toBeLessThan(30);
  }, 10_000);

  it("parallel results are finalized in call order regardless of completion order", async () => {
    const store = createMockStore();
    let resolveB: (() => void) | undefined;
    const toolA: AgentTool = {
      name: "fast",
      description: "Fast tool",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { content: "A result", terminate: false };
      },
    };
    const toolB: AgentTool = {
      name: "slow",
      description: "Slow tool",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        await new Promise<void>((r) => {
          resolveB = r;
        });
        return { content: "B result", terminate: false };
      },
    };

    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return multiToolCallStream([
          { name: "fast", args: {}, id: "tc_1" },
          { name: "slow", args: {}, id: "tc_2" },
        ]);
      }
      return textStream("done");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [toolA, toolB],
      store,
      toolExecutionMode: "parallel",
    });

    const promise = collectEvents(loop.prompt("run"));
    await new Promise((r) => setTimeout(r, 30));
    resolveB!();
    const events = await promise;

    const toolMsgs = events.filter(
      (e) => e.type === "message_start" && e.message?.role === "tool"
    );
    expect(toolMsgs.length).toBe(2);
    expect((toolMsgs[0]!.message as any).toolCallId).toBe("tc_1");
    expect((toolMsgs[1]!.message as any).toolCallId).toBe("tc_2");
  });

  it("parallel batch: pre-aborted signal skips tool execution", async () => {
    const store = createMockStore();
    let executeCount = 0;
    const tool: AgentTool = {
      name: "slow",
      description: "Slow tool",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        executeCount++;
        return { content: `run ${executeCount}`, terminate: false };
      },
    };

    const abortController = new AbortController();
    abortController.abort();

    let callCount = 0;
    vi.mocked(streamSimple).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return multiToolCallStream([
          { name: "slow", args: {}, id: "tc_1" },
          { name: "slow", args: {}, id: "tc_2" },
          { name: "slow", args: {}, id: "tc_3" },
        ]);
      }
      return textStream("done");
    });

    const loop = createAgentLoop({
      sessionId: "s1",
      model: testModel,
      tools: [tool],
      store,
      toolExecutionMode: "parallel",
    });
    const events = await collectEvents(
      loop.prompt("run", abortController.signal)
    );

    const toolResultMsgs = events.filter(
      (e) => e.type === "message_start" && e.message?.role === "tool"
    );
    expect(toolResultMsgs.length).toBeLessThan(3);
    expect(executeCount).toBeLessThan(3);
  });
});
