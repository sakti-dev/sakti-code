import type {
  AssistantMessage,
  FinishResult,
  Model,
  StreamResult,
  Usage,
} from "@sakti-code/llm";

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

function createAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "ai-sdk",
    provider: "openai",
    model: "mock",
    usage: createUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export function fakeStreamResult(opts: {
  content?: AssistantMessage["content"];
  error?: Error;
  finishReason?: AssistantMessage["stopReason"];
}): StreamResult {
  const content = opts.content ?? [];
  const parts: Record<string, unknown>[] = [];

  for (const block of content) {
    switch (block.type) {
      case "text":
        parts.push({ type: "text-delta", id: "t1", text: block.text });
        break;
      case "thinking":
        parts.push({ type: "reasoning-delta", id: "r1", text: block.thinking });
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
  if (opts.error) {
    parts.push({ type: "error", error: opts.error });
  }

  const finish: FinishResult = {
    finishReason: opts.error ? "error" : (opts.finishReason ?? "stop"),
    usage: createUsage(),
  };

  return {
    fullStream: (async function* () {
      for (const p of parts) {
        yield p;
      }
    })(),
    result: Promise.resolve(finish),
  };
}

export { createAssistantMessage, createModel, createUsage };
