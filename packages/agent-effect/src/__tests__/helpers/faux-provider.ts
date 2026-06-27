import type {
  AssistantMessage,
  Model,
  StreamRequest,
  ToolCall,
} from "@sakti-code/llm";
import type { StreamFn } from "../../types.ts";
import {
  createAssistantMessage,
  createUsage,
  fakeStreamResult,
} from "./stream-mock.ts";

export { createAssistantMessage as fauxAssistantMessage };

export function fauxToolCall(
  name: string,
  args: Record<string, unknown>,
  opts?: { id?: string }
): ToolCall {
  return {
    type: "toolCall",
    id: opts?.id ?? `call-${Date.now()}`,
    name,
    arguments: args,
  };
}

export function fauxAssistantMessageWithContent(
  content: AssistantMessage["content"],
  stopReason?: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "ai-sdk",
    provider: "faux",
    model: "faux",
    usage: createUsage(),
    stopReason: stopReason ?? "stop",
    timestamp: Date.now(),
  };
}

export type FauxResponse = (
  req: StreamRequest,
  callIndex: number
) => AssistantMessage | Promise<AssistantMessage>;

export interface FauxProviderRegistration {
  get callCount(): number;
  getModel: (id?: string) => Model;
  setResponses: (responses: FauxResponse[]) => void;
  streamFn: StreamFn;
}

function createFauxModel(id = "faux-model"): Model {
  return {
    id,
    name: id,
    api: "ai-sdk",
    provider: "faux",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 2048,
  };
}

export function registerFauxStreamProvider(
  modelId?: string
): FauxProviderRegistration {
  let responses: FauxResponse[] = [];
  let callIndex = 0;
  const model = createFauxModel(modelId);

  const streamFn: StreamFn = async (req) => {
    const response = responses[callIndex] ?? responses[responses.length - 1];
    if (!response) {
      throw new Error(`FauxProvider: no response set for call ${callIndex}`);
    }
    const currentIndex = callIndex;
    callIndex++;
    const message = await response(req, currentIndex);
    return fakeStreamResult({
      content: message.content,
      finishReason: message.stopReason,
    });
  };

  return {
    streamFn,
    getModel: (id?: string) => (id ? createFauxModel(id) : model),
    setResponses: (newResponses: FauxResponse[]) => {
      responses = newResponses;
      callIndex = 0;
    },
    get callCount() {
      return callIndex;
    },
  };
}
