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

/** StreamFn that records req.system + req.systemMessages per call. */
function capturingStreamFn(
  results: Array<{
    content: AssistantMessage["content"];
    finishReason: AssistantMessage["stopReason"];
  }>,
): { fn: StreamFn; systems: string[]; systemMessages: (string[] | undefined)[] } {
  const systems: string[] = [];
  const systemMessages: (string[] | undefined)[] = [];
  let i = 0;
  const fn: StreamFn = (req) => {
    systems.push(req.system ?? "");
    systemMessages.push(req.systemMessages as string[] | undefined);
    const spec = results[i] ?? results[results.length - 1]!;
    i++;
    return Promise.resolve(streamResult(spec.content, spec.finishReason));
  };
  return { fn, systems, systemMessages };
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

/** Fake engine; buildContextSystemMessages returns scripted chunks in order. */
function fakeEngine(observationsSequence: string[]) {
  let obsIdx = 0;
  const record = { id: "r1", activeObservations: "stub" };
  const engine = {
    getOrCreateRecord: vi.fn(async () => record),
    maybeObserve: vi.fn(async (r: unknown) => r),
    maybeReflect: vi.fn(async (r: unknown) => r),
    buildContextSystemMessages: vi.fn(() => {
      const v = observationsSequence[Math.min(obsIdx, observationsSequence.length - 1)];
      obsIdx++;
      return v !== undefined ? [v] : undefined;
    }),
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
  it("first model call's systemMessages contains <observations> from the existing record; systemPrompt stays immutable", async () => {
    const engine = fakeEngine(["<observations>* 🔴 prior memory\n</observations>"]);
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemory: { engine },
    };
    const context: AgentContext = { systemPrompt: BASE, messages: [], tools: [] };
    const { fn, systems, systemMessages } = capturingStreamFn([
      { content: [{ type: "text", text: "answer" }], finishReason: "stop" },
    ]);

    await drain(agentLoop([userMsg("hi")], context, config, undefined, fn));

    expect(systems.length).toBeGreaterThanOrEqual(1);
    // Base systemPrompt is immutable — observations NOT concatenated into it.
    expect(systems[0]).toBe(BASE);
    expect(systems[0]).not.toContain("<observations>");
    // Observations travel as separate system content blocks.
    expect(systemMessages[0]).toBeDefined();
    expect(systemMessages[0]!.join("\n")).toContain("<observations>");
    expect(systemMessages[0]!.join("\n")).toContain("prior memory");
  });

  it("after turn 1, maybeObserve ran and turn-2 systemMessages reflects updated observations", async () => {
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
    // Turn 1: tool call (loops), turn 2: plain text (stops).
    const { fn, systems, systemMessages } = capturingStreamFn([
      {
        content: [{ type: "toolCall", id: "t1", name: "noop", arguments: { value: "x" } }],
        finishReason: "toolUse",
      },
      { content: [{ type: "text", text: "done" }], finishReason: "stop" },
    ]);

    await drain(agentLoop([userMsg("hi")], context, config, undefined, fn));

    expect(engine.maybeObserve).toHaveBeenCalled();
    expect(systems.length).toBe(2);
    // Base systemPrompt immutable across both turns.
    expect(systems[0]).toBe(BASE);
    expect(systems[1]).toBe(BASE);
    // Observations evolve across turns via systemMessages.
    expect(systemMessages[0]!.join("\n")).toContain("INITIAL");
    expect(systemMessages[1]!.join("\n")).toContain("UPDATED");
  });

  it("without observationalMemory config, the loop is unchanged (no engine calls, prompt == base)", async () => {
    const engine = fakeEngine(["<observations>SHOULD NOT APPEAR\n</observations>"]);
    // engine is intentionally NOT wired into config.
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
    };
    const context: AgentContext = { systemPrompt: BASE, messages: [], tools: [] };
    const { fn, systems, systemMessages } = capturingStreamFn([
      { content: [{ type: "text", text: "answer" }], finishReason: "stop" },
    ]);

    await drain(agentLoop([userMsg("hi")], context, config, undefined, fn));

    expect(engine.getOrCreateRecord).not.toHaveBeenCalled();
    expect(engine.maybeObserve).not.toHaveBeenCalled();
    expect(systems[0]).toBe(BASE);
    expect(systems[0]).not.toContain("<observations>");
    expect(systemMessages[0]).toBeUndefined();
  });
});
