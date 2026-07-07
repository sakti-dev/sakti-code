import type { AssistantMessage, Model, Usage } from "@sakti-code/llm";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vite-plus/test";

import { agentLoop } from "../../core/agent-loop.ts";
import type {
  AgentContext,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  StreamFn,
} from "../../types.ts";

// ─── helpers (mirrors core/__tests__/agent-loop.test.ts) ─────────────────────

function createUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createModel(): Model {
  return {
    id: "mock",
    name: "mock",
    api: "ai-sdk",
    provider: "openai",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
  };
}

function userMsg(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function streamResult(
  content: AssistantMessage["content"],
  finishReason: AssistantMessage["stopReason"],
) {
  const parts: Record<string, unknown>[] = [];
  for (const block of content) {
    switch (block.type) {
      case "text":
        parts.push({ type: "text-delta", id: "t1", text: block.text });
        break;
      case "toolCall":
        parts.push({
          type: "tool-call",
          toolCallId: block.id,
          toolName: block.name,
          input: block.arguments,
        });
        break;
    }
  }
  return {
    fullStream: (async function* () {
      for (const p of parts) yield p;
    })(),
    result: Promise.resolve({ finishReason, usage: createUsage() }),
  };
}

/** StreamFn that records req.system per call. */
function capturingStreamFn(
  results: Array<{
    content: AssistantMessage["content"];
    finishReason: AssistantMessage["stopReason"];
  }>,
): { fn: StreamFn; systems: string[] } {
  const systems: string[] = [];
  let i = 0;
  const fn: StreamFn = (req) => {
    systems.push(req.system ?? "");
    const spec = results[i] ?? results[results.length - 1]!;
    i++;
    return Promise.resolve(streamResult(spec.content, spec.finishReason));
  };
  return { fn, systems };
}

function identityConverter(messages: AgentMessage[]) {
  return messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
  );
}

function noopTool(): AgentTool {
  return {
    name: "noop",
    label: "Noop",
    description: "noop",
    parameters: Type.Object({ value: Type.String() }),
    async execute() {
      return { content: [{ type: "text", text: "ok" }], details: { value: "" } };
    },
  };
}

const BASE = "BASE SYSTEM PROMPT";

/** Fake engine; maybeObserve/maybeReflect are spied. Observations are tree
 * entries (tested via the engine tests + context builder), not injected by
 * the loop. This test verifies the loop runs observe/reflect + keeps the
 * systemPrompt immutable. */
function fakeEngine(_observationsSequence: string[]) {
  const record = { id: "r1", activeObservations: "stub" };
  const engine = {
    getOrCreateRecord: vi.fn(async () => record),
    maybeObserve: vi.fn(async (r: unknown) => r),
    maybeReflect: vi.fn(async (r: unknown) => r),
  };
  return engine;
}

async function drain(stream: ReturnType<typeof agentLoop>) {
  for await (const _event of stream) {
    void _event;
  }
  return stream.result();
}

describe("observational-memory loop integration", () => {
  it("first model call: systemPrompt stays immutable; maybeObserve runs", async () => {
    const engine = fakeEngine(["<observations>* 🔴 prior memory\n</observations>"]);
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemory: { engine },
    };
    const context: AgentContext = { systemPrompt: BASE, messages: [], tools: [] };
    const { fn, systems } = capturingStreamFn([
      { content: [{ type: "text", text: "answer" }], finishReason: "stop" },
    ]);

    await drain(agentLoop([userMsg("hi")], context, config, undefined, fn));

    expect(systems.length).toBeGreaterThanOrEqual(1);
    expect(systems[0]).toBe(BASE);
    expect(systems[0]).not.toContain("<observations>");
    expect(engine.maybeObserve).toHaveBeenCalled();
  });

  it("after turn 1, maybeObserve ran again; systemPrompt immutable across turns", async () => {
    const engine = fakeEngine([
      "<observations>INITIAL\n</observations>",
      "<observations>UPDATED\n</observations>",
    ]);
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemory: { engine },
    };
    const context: AgentContext = { systemPrompt: BASE, messages: [], tools: [noopTool()] };
    const { fn, systems } = capturingStreamFn([
      {
        content: [{ type: "toolCall", id: "t1", name: "noop", arguments: { value: "x" } }],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }], finishReason: "stop" },
    ]);

    await drain(agentLoop([userMsg("hi")], context, config, undefined, fn));

    expect(engine.maybeObserve).toHaveBeenCalled();
    expect(systems.length).toBe(2);
    expect(systems[0]).toBe(BASE);
    expect(systems[1]).toBe(BASE);
  });

  it("without observationalMemory config, the loop is unchanged (no engine calls, prompt == base)", async () => {
    const engine = fakeEngine(["<observations>SHOULD NOT APPEAR\n</observations>"]);
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };
    const context: AgentContext = { systemPrompt: BASE, messages: [], tools: [] };
    const { fn, systems } = capturingStreamFn([
      { content: [{ type: "text", text: "answer" }], finishReason: "stop" },
    ]);

    await drain(agentLoop([userMsg("hi")], context, config, undefined, fn));

    expect(engine.getOrCreateRecord).not.toHaveBeenCalled();
    expect(engine.maybeObserve).not.toHaveBeenCalled();
    expect(systems[0]).toBe(BASE);
    expect(systems[0]).not.toContain("<observations>");
  });
});
