/**
 * Faux stream provider for harness tests.
 *
 * Replaces pi-ai's `registerFauxProvider` — returns canned responses per call
 * without real API calls. Uses the harness's `streamFn` injection point.
 */
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
} from "../helpers/stream-mock.ts";

export { createAssistantMessage as fauxAssistantMessage };

/** Create a tool call content block for use in fauxAssistantMessage. */
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

/** Create an assistant message with arbitrary content blocks. */
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

/** A response function that receives the request and returns content. */
export type FauxResponse = (
  req: StreamRequest,
  callIndex: number
) => AssistantMessage | Promise<AssistantMessage>;

/** Registration returned by {@link registerFauxStreamProvider}. */
export interface FauxProviderRegistration {
  /** Number of LLM calls made so far. */
  get callCount(): number;
  /** Model associated with this faux provider. */
  getModel: (id?: string) => Model;
  /** Set the sequence of responses (called in order per LLM request). */
  setResponses: (responses: FauxResponse[]) => void;
  /** The stream function to pass to AgentHarness or Agent. */
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

/**
 * Register a faux stream provider for testing.
 *
 * Returns a registration with a `streamFn` to pass to AgentHarness and
 * response functions that return canned AssistantMessages per call.
 */
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
