import type { Model, StreamRequest, Usage } from "@sakti-code/llm";
import { describe, expect, it, vi } from "vite-plus/test";
import { agentLoop } from "../../core/agent-loop";
import type { AgentContext, AgentLoopConfig, AgentMessage, StreamFn } from "../../types";

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

function identityConverter(messages: AgentMessage[]) {
  return messages.filter(
    (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
  );
}

const OBS_BLOCK = "<observations>\n* User prefers TypeScript\n</observations>";

function makeOwnOm() {
  return {
    engine: {
      getOrCreateRecord: vi.fn(async () => ({})),
      maybeObserve: vi.fn(async (r: unknown) => r),
      maybeReflect: vi.fn(async (r: unknown) => r),
    },
  };
}

async function runOnce(
  config: AgentLoopConfig,
  context: AgentContext,
  userPrompt: AgentMessage,
): Promise<{ system: string | undefined; messages: AgentMessage[] }> {
  let capturedSystem: string | undefined;
  let capturedMessages: AgentMessage[] = [];
  const streamFn: StreamFn = (req: StreamRequest) => {
    capturedSystem = req.system as string | undefined;
    capturedMessages = req.messages as unknown as AgentMessage[];
    return Promise.resolve({
      fullStream: (async function* () {
        yield { type: "text-delta", id: "t1", text: "Hi!" };
      })(),
      result: Promise.resolve({ finishReason: "stop", usage: createUsage() }),
    });
  };
  const stream = agentLoop([userPrompt], context, config, undefined, streamFn);
  for await (const event of stream) {
    void event;
  }
  await stream.result();
  return { system: capturedSystem, messages: capturedMessages };
}

describe("agent loop OM injection — immutable systemPrompt + stream messages", () => {
  it("read-only: keeps systemPrompt immutable, delivers observations as stream messages", async () => {
    const context: AgentContext = { systemPrompt: "You are helpful.", messages: [], tools: [] };
    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemoryReadOnly: {
        getObservationsBlocks: async () => [OBS_BLOCK],
      },
    };
    const { system, messages } = await runOnce(config, context, userPrompt);
    expect(system).toBe("You are helpful.");
    expect(system).not.toContain("<observations>");
    // The observation block travels as a stream message (user role).
    const obsMsg = messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "text" && b.text.includes("User prefers TypeScript")),
    );
    expect(obsMsg).toBeDefined();
  });

  it("read-only: no injection when callback returns undefined", async () => {
    const context: AgentContext = { systemPrompt: "You are helpful.", messages: [], tools: [] };
    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemoryReadOnly: {
        getObservationsBlocks: async () => undefined,
      },
    };
    const { system, messages } = await runOnce(config, context, userPrompt);
    expect(system).toBe("You are helpful.");
    const obsMsg = messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "text" && b.text.includes("observations")),
    );
    expect(obsMsg).toBeUndefined();
  });

  it("own-OM: runs maybeObserve/maybeReflect, systemPrompt stays immutable", async () => {
    const context: AgentContext = { systemPrompt: "You are helpful.", messages: [], tools: [] };
    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };
    const om = makeOwnOm();
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemory: om,
    };
    const { system } = await runOnce(config, context, userPrompt);
    expect(om.engine.maybeObserve).toHaveBeenCalled();
    expect(om.engine.maybeReflect).toHaveBeenCalled();
    expect(system).toBe("You are helpful.");
  });

  it("own-OM + read-only: both run; systemPrompt immutable; read-only in stream", async () => {
    const context: AgentContext = { systemPrompt: "You are helpful.", messages: [], tools: [] };
    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };
    const om = makeOwnOm();
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemory: om,
      observationalMemoryReadOnly: {
        getObservationsBlocks: async () => [OBS_BLOCK],
      },
    };
    const { system, messages } = await runOnce(config, context, userPrompt);
    expect(om.engine.maybeObserve).toHaveBeenCalled();
    expect(system).toBe("You are helpful.");
    const obsMsg = messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "text" && b.text.includes("User prefers TypeScript")),
    );
    expect(obsMsg).toBeDefined();
  });
});
