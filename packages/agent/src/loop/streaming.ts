import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai";
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  AnyModel,
} from "../types.ts";
import type { ToolCallInfo } from "./events.ts";
import { evt } from "./events.ts";

export type StreamResult =
  | { ok: true; finalAssistant: AgentMessage | null; toolCalls: ToolCallInfo[] }
  | { ok: false; finalAssistant: AgentMessage | null };

export function toPiMessages(messages: AgentMessage[]) {
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai Message type varies by role; this is a type-coercion boundary
  return messages.map((msg): any => {
    if (msg.role === "user") {
      return { role: "user", content: msg.content, timestamp: msg.timestamp };
    }
    if (msg.role === "assistant") {
      return {
        role: "assistant",
        content: msg.content,
        usage: msg.usage,
        stopReason: msg.stopReason ?? "stop",
        api: msg.api ?? "openai-completions",
        provider: msg.provider ?? "openai",
        model: msg.model ?? "unknown",
        ...(msg.responseModel ? { responseModel: msg.responseModel } : {}),
        ...(msg.responseId ? { responseId: msg.responseId } : {}),
        timestamp: msg.timestamp,
      };
    }
    return {
      role: "toolResult",
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      content: msg.content,
      isError: msg.isError,
      timestamp: msg.timestamp,
    };
  });
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof Error && "statusCode" in err) {
    const code = (err as { statusCode: number }).statusCode;
    return code === 429 || (code >= 500 && code < 600);
  }
  return false;
}

function retryErrorMessage(err: unknown, maxRetries: number): string {
  if (isRetryable(err)) {
    return `Max retries (${maxRetries}) exceeded`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Stream error";
}

function mapPiAssistantMessage(piMsg: {
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai content/usage types are complex generics; mapping at boundary
  content: any;
  // biome-ignore lint/suspicious/noExplicitAny: pi-ai content/usage types are complex generics; mapping at boundary
  usage: any;
  timestamp: number;
  stopReason?: unknown;
  errorMessage?: unknown;
  api?: string;
  provider?: string;
  model?: string;
  responseModel?: string;
  responseId?: string;
  diagnostics?: unknown[];
}): Extract<AgentMessage, { role: "assistant" }> {
  return {
    role: "assistant",
    content: piMsg.content,
    usage: piMsg.usage,
    timestamp: piMsg.timestamp,
    ...(piMsg.stopReason == null
      ? {}
      : { stopReason: piMsg.stopReason as string }),
    ...(piMsg.errorMessage == null
      ? {}
      : { errorMessage: piMsg.errorMessage as string }),
    ...(piMsg.api ? { api: piMsg.api } : {}),
    ...(piMsg.provider ? { provider: piMsg.provider } : {}),
    ...(piMsg.model ? { model: piMsg.model } : {}),
    ...(piMsg.responseModel ? { responseModel: piMsg.responseModel } : {}),
    ...(piMsg.responseId ? { responseId: piMsg.responseId } : {}),
    ...(piMsg.diagnostics ? { diagnostics: piMsg.diagnostics } : {}),
  };
}

async function* consumeStream(
  stream: AsyncIterable<AssistantMessageEvent>,
  signal: AbortSignal | undefined,
  toolCalls: ToolCallInfo[]
): AsyncGenerator<
  AgentEvent,
  { status: "done" | "error" | "aborted"; finalAssistant: AgentMessage | null }
> {
  let finalAssistant: AgentMessage | null = null;

  for await (const event of stream) {
    if (signal?.aborted) {
      return { status: "aborted", finalAssistant: null };
    }
    switch (event.type) {
      case "text_delta":
        yield evt("message_update", {
          update: { type: "text_delta", delta: event.delta },
        });
        break;
      case "thinking_delta":
        yield evt("message_update", {
          update: { type: "thinking_delta", delta: event.delta },
        });
        break;
      case "toolcall_start":
        yield evt("message_update", {
          update: { type: "toolcall_start", contentIndex: event.contentIndex },
        });
        break;
      case "toolcall_delta":
        yield evt("message_update", {
          update: {
            type: "toolcall_delta",
            contentIndex: event.contentIndex,
            delta: event.delta,
          },
        });
        break;
      case "toolcall_end":
        if (event.toolCall) {
          toolCalls.push({
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
          });
        }
        yield evt("message_update", {
          update: {
            type: "toolcall_end",
            contentIndex: event.contentIndex,
            toolCall: event.toolCall,
          },
        });
        break;
      case "done":
        if (event.message) {
          finalAssistant = mapPiAssistantMessage(event.message);
        }
        break;
      case "error":
        if (event.error) {
          finalAssistant = mapPiAssistantMessage(event.error);
        }
        yield evt("error", {
          message: event.error?.errorMessage ?? "LLM error",
        });
        return { status: "error", finalAssistant };
    }
  }

  return { status: "done", finalAssistant };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one extra && in stream options
export async function* streamLLMResponse(
  model: AnyModel,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal: AbortSignal | undefined,
  maxRetries: number,
  baseDelay: number,
  sessionId: string,
  thinkingLevel?: string
): AsyncGenerator<AgentEvent, StreamResult> {
  const toolCalls: ToolCallInfo[] = [];
  let finalAssistant: AgentMessage | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      break;
    }
    try {
      const stream = streamSimple(
        model,
        {
          messages: toPiMessages(messages),
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
        {
          ...(signal ? { signal } : {}),
          ...(model.reasoning && thinkingLevel && thinkingLevel !== "off"
            ? {
                reasoning:
                  thinkingLevel as import("@earendil-works/pi-ai").ThinkingLevel,
              }
            : {}),
        }
      );
      const streamResult = yield* consumeStream(stream, signal, toolCalls);
      if (streamResult.status === "error") {
        yield evt("agent_end", { sessionId });
        return { ok: false, finalAssistant: streamResult.finalAssistant };
      }
      finalAssistant = streamResult.finalAssistant;
      if (streamResult.status === "aborted") {
        break;
      }
      break; // success
    } catch (err) {
      if (signal?.aborted) {
        break;
      }
      if (isRetryable(err) && attempt < maxRetries) {
        const delay = baseDelay * 2 ** attempt;
        yield evt("retry", {
          attempt: attempt + 1,
          maxRetries,
          delayMs: delay,
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      const msg = retryErrorMessage(err, maxRetries);
      yield evt("error", { message: msg });
      yield evt("agent_end", { sessionId });
      return { ok: false, finalAssistant: null };
    }
  }

  return { ok: true, finalAssistant, toolCalls };
}
