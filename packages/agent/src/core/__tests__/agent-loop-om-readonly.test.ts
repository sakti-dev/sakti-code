import type { Model, StreamRequest, Usage } from "@sakti-code/llm";
import { describe, expect, it } from "vite-plus/test";
import { agentLoop } from "../../core/agent-loop";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  StreamFn,
} from "../../types";

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

const OBS_BLOCK =
  "The following observations block contains your memory of past conversations with this user.\n\n<observations>\n* User prefers TypeScript\n</observations>";

const OWN_BLOCK = "<observations>\n* Mission thread context note\n</observations>";

const OWN_BASE = "[own-om-base]";

function makeOwnOm() {
  return {
    engine: {
      getOrCreateRecord: async () => ({}),
      maybeObserve: async (r: unknown) => r,
      maybeReflect: async (r: unknown) => r,
      buildContextSystemMessage: () => OWN_BLOCK,
    },
    getBaseSystemPrompt: () => OWN_BASE,
  };
}

describe("agent loop read-only OM injection", () => {
  it("injects <observations> on first turn when readOnly callback returns a block", async () => {
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };

    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };

    let capturedSystem: string | undefined;
    const streamFn: StreamFn = (req: StreamRequest) => {
      capturedSystem = req.system as string | undefined;
      return Promise.resolve({
        fullStream: (async function* () {
          yield { type: "text-delta", id: "t1", text: "Hi!" };
        })(),
        result: Promise.resolve({ finishReason: "stop", usage: createUsage() }),
      });
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemoryReadOnly: {
        getObservationsBlock: async () => OBS_BLOCK,
      },
    };

    const events: AgentEvent[] = [];
    const stream = agentLoop([userPrompt], context, config, undefined, streamFn);
    for await (const event of stream) {
      events.push(event);
    }
    await stream.result();

    expect(capturedSystem).toContain("You are helpful.");
    expect(capturedSystem).toContain("<observations>");
    expect(capturedSystem).toContain("User prefers TypeScript");
  });

  it("does not inject when readOnly callback returns undefined", async () => {
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };

    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };

    let capturedSystem: string | undefined;
    const streamFn: StreamFn = (req: StreamRequest) => {
      capturedSystem = req.system as string | undefined;
      return Promise.resolve({
        fullStream: (async function* () {
          yield { type: "text-delta", id: "t1", text: "Hi!" };
        })(),
        result: Promise.resolve({ finishReason: "stop", usage: createUsage() }),
      });
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemoryReadOnly: {
        getObservationsBlock: async () => undefined,
      },
    };

    const events: AgentEvent[] = [];
    const stream = agentLoop([userPrompt], context, config, undefined, streamFn);
    for await (const event of stream) {
      events.push(event);
    }
    await stream.result();

    expect(capturedSystem).toBe("You are helpful.");
    expect(capturedSystem).not.toContain("<observations>");
  });

  it("injects BOTH own-OM and read-only blocks when both are configured", async () => {
    const context: AgentContext = {
      systemPrompt: "You are helpful.",
      messages: [],
      tools: [],
    };

    const userPrompt: AgentMessage = { role: "user", content: "Hello", timestamp: Date.now() };

    let capturedSystem: string | undefined;
    const streamFn: StreamFn = (req: StreamRequest) => {
      capturedSystem = req.system as string | undefined;
      return Promise.resolve({
        fullStream: (async function* () {
          yield { type: "text-delta", id: "t1", text: "Hi!" };
        })(),
        result: Promise.resolve({ finishReason: "stop", usage: createUsage() }),
      });
    };

    const config: AgentLoopConfig = {
      model: createModel(),
      convertToLlm: identityConverter,
      observationalMemory: makeOwnOm(),
      observationalMemoryReadOnly: {
        getObservationsBlock: async () => OBS_BLOCK,
      },
    };

    const events: AgentEvent[] = [];
    const stream = agentLoop([userPrompt], context, config, undefined, streamFn);
    for await (const event of stream) {
      events.push(event);
    }
    await stream.result();

    // Own-OM block (base + observations) is present…
    expect(capturedSystem).toContain(OWN_BASE);
    expect(capturedSystem).toContain("Mission thread context note");
    // …AND the read-only project block is appended.
    expect(capturedSystem).toContain("User prefers TypeScript");
    // Read-only must come after the own block (appended, not replacing).
    expect(capturedSystem!.indexOf("User prefers TypeScript")).toBeGreaterThan(
      capturedSystem!.indexOf("Mission thread context note"),
    );
  });
});
