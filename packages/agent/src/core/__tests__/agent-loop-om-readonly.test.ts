import type { Model, StreamRequest, Usage } from "@sakti-code/llm";
import { describe, expect, it } from "vite-plus/test";
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

const OWN_BLOCK = "<observations>\n* Mission thread context note\n</observations>";

function makeOwnOm() {
  return {
    engine: {
      getOrCreateRecord: async () => ({}),
      maybeObserve: async (r: unknown) => r,
      maybeReflect: async (r: unknown) => r,
      buildContextSystemMessages: () => [OWN_BLOCK],
    },
  };
}

async function runOnce(
  config: AgentLoopConfig,
  context: AgentContext,
  userPrompt: AgentMessage,
): Promise<{ system: string | undefined; systemMessages: string[] | undefined }> {
  let capturedSystem: string | undefined;
  let capturedSystemMessages: string[] | undefined;
  const streamFn: StreamFn = (req: StreamRequest) => {
    capturedSystem = req.system as string | undefined;
    capturedSystemMessages = req.systemMessages as string[] | undefined;
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
  return { system: capturedSystem, systemMessages: capturedSystemMessages };
}

describe("agent loop OM injection — immutable systemPrompt + systemMessages", () => {
  it("read-only: keeps systemPrompt immutable, delivers observations via systemMessages", async () => {
    const context: AgentContext = { systemPrompt: "You are helpful.", messages: [], tools: [] };
    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemoryReadOnly: {
        getObservationsBlocks: async () => [OBS_BLOCK],
      },
    };
    const { system, systemMessages } = await runOnce(config, context, userPrompt);
    // Base systemPrompt is byte-identical to the original — never mutated.
    expect(system).toBe("You are helpful.");
    expect(system).not.toContain("<observations>");
    // Observations travel as a separate system content block.
    expect(systemMessages).toEqual([OBS_BLOCK]);
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
    const { system, systemMessages } = await runOnce(config, context, userPrompt);
    expect(system).toBe("You are helpful.");
    expect(systemMessages).toBeUndefined();
  });

  it("own-OM: keeps systemPrompt immutable, delivers own observations via systemMessages", async () => {
    const context: AgentContext = { systemPrompt: "You are helpful.", messages: [], tools: [] };
    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemory: makeOwnOm(),
    };
    const { system, systemMessages } = await runOnce(config, context, userPrompt);
    expect(system).toBe("You are helpful.");
    expect(system).not.toContain("Mission thread context note");
    expect(systemMessages).toEqual([OWN_BLOCK]);
  });

  it("own-OM + read-only: both compose into systemMessages, systemPrompt stays immutable", async () => {
    const context: AgentContext = { systemPrompt: "You are helpful.", messages: [], tools: [] };
    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };
    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemory: makeOwnOm(),
      observationalMemoryReadOnly: {
        getObservationsBlocks: async () => [OBS_BLOCK],
      },
    };
    const { system, systemMessages } = await runOnce(config, context, userPrompt);
    expect(system).toBe("You are helpful.");
    // Own-OM chunk(s) first, then read-only chunk(s) appended.
    expect(systemMessages).toBeDefined();
    const joined = systemMessages!.join("\n");
    expect(joined).toContain("Mission thread context note");
    expect(joined).toContain("User prefers TypeScript");
    // Read-only appended after own-OM.
    expect(systemMessages!.indexOf(OBS_BLOCK)).toBeGreaterThan(systemMessages!.indexOf(OWN_BLOCK));
  });
});
