import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai";
import type {
  AgentConfigInput,
  AgentEvent,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  AnyModel,
  SessionStore,
} from "./types.ts";
import { createAgentConfig } from "./types.ts";

export { createAgentConfig } from "./types.ts";

function toPiMessages(messages: AgentMessage[]) {
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
        stopReason: "stop",
        api: "openai-completions",
        provider: "openai",
        model: "unknown",
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

function evt(
  type: AgentEvent["type"] & string,
  extra: Record<string, unknown> = {}
): AgentEvent {
  return {
    type: type as AgentEvent["type"],
    timestamp: Date.now(),
    ...extra,
  } as AgentEvent;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error && "statusCode" in err) {
    const code = (err as { statusCode: number }).statusCode;
    return code === 429 || (code >= 500 && code < 600);
  }
  return false;
}

interface ToolCallInfo {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
}

type StreamResult =
  | { ok: true; finalAssistant: AgentMessage | null; toolCalls: ToolCallInfo[] }
  | { ok: false };

async function* streamLLMResponse(
  model: AnyModel,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal: AbortSignal | undefined,
  maxRetries: number,
  baseDelay: number,
  sessionId: string
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
        { ...(signal ? { signal } : {}) }
      );
      const streamResult = yield* consumeStream(stream, signal, toolCalls);
      if (streamResult.status === "error") {
        yield evt("agent_end", { sessionId });
        return { ok: false };
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
      return { ok: false };
    }
  }

  return { ok: true, finalAssistant, toolCalls };
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
          finalAssistant = {
            role: "assistant",
            content: event.message.content,
            usage: event.message.usage,
            timestamp: event.message.timestamp,
          };
        }
        break;
      case "error":
        yield evt("error", {
          message: event.error?.errorMessage ?? "LLM error",
        });
        return { status: "error", finalAssistant: null };
    }
  }

  return { status: "done", finalAssistant };
}

interface ToolExecResult {
  shouldTerminate: boolean;
  toolResultMessages: Extract<AgentMessage, { role: "tool" }>[];
}

async function* executeToolCalls(
  toolCalls: ToolCallInfo[],
  tools: AgentTool[],
  signal: AbortSignal | undefined,
  store: SessionStore,
  sessionId: string,
  messages: AgentMessage[]
): AsyncGenerator<AgentEvent, ToolExecResult> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolResultMessages: Extract<AgentMessage, { role: "tool" }>[] = [];
  let shouldTerminate = false;

  for (const tc of toolCalls) {
    const tool = toolMap.get(tc.name);
    let result: AgentToolResult;

    yield evt("tool_execution_start", { toolCallId: tc.id, toolName: tc.name });

    if (tool) {
      let accumulated = "";
      try {
        result = await tool.execute(tc.id, tc.arguments, signal, (partial) => {
          accumulated += partial;
        });
        yield evt("tool_execution_update", {
          toolCallId: tc.id,
          toolName: tc.name,
          accumulated,
        });
      } catch (err: unknown) {
        result = {
          content: err instanceof Error ? err.message : "Tool execution error",
          terminate: false,
          isError: true,
        };
      }
    } else {
      result = {
        content: `Unknown tool: ${tc.name}`,
        terminate: false,
        isError: true,
      };
    }

    yield evt("tool_execution_end", {
      toolCallId: tc.id,
      toolName: tc.name,
      result,
    });

    const toolMsg: Extract<AgentMessage, { role: "tool" }> = {
      role: "tool",
      toolCallId: tc.id,
      toolName: tc.name,
      content: [{ type: "text", text: result.content }],
      isError: result.isError ?? false,
      timestamp: Date.now(),
    };
    messages.push(toolMsg);
    toolResultMessages.push(toolMsg);
    await store.appendMessage(sessionId, toolMsg);

    if (result.terminate) {
      shouldTerminate = true;
    }
  }

  return { toolResultMessages, shouldTerminate };
}

export interface AgentLoop {
  prompt(message: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

export function createAgentLoop(config: AgentConfigInput): AgentLoop {
  const resolved = createAgentConfig(config);
  const { sessionId, model, tools, store } = resolved;
  const maxRetries = resolved.maxRetries;
  const baseDelay = resolved.retryBaseDelayMs;

  async function* prompt(
    message: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent> {
    const messages: AgentMessage[] = await store.loadMessages(sessionId);
    let turnIndex = 0;

    const userMsg: AgentMessage = {
      role: "user",
      content: message,
      timestamp: Date.now(),
    };
    messages.push(userMsg);
    await store.appendMessage(sessionId, userMsg);

    yield evt("agent_start", { sessionId });

    while (true) {
      yield evt("turn_start", { turnIndex });
      yield evt("message_start");

      const streamResult = yield* streamLLMResponse(
        model,
        messages,
        tools,
        signal,
        maxRetries,
        baseDelay,
        sessionId
      );

      if (!streamResult.ok) {
        return;
      }
      if (signal?.aborted) {
        yield evt("agent_end", { sessionId });
        return;
      }

      yield evt("message_end");

      if (!streamResult.finalAssistant) {
        yield evt("error", {
          message: "Stream ended without assistant message",
        });
        yield evt("agent_end", { sessionId });
        return;
      }

      messages.push(streamResult.finalAssistant);
      await store.appendMessage(sessionId, streamResult.finalAssistant);

      if (streamResult.toolCalls.length === 0) {
        yield evt("turn_end", {
          turnIndex,
          message: streamResult.finalAssistant,
          toolResults: [],
        });
        break;
      }

      const toolExec = yield* executeToolCalls(
        streamResult.toolCalls,
        tools,
        signal,
        store,
        sessionId,
        messages
      );

      yield evt("turn_end", {
        turnIndex,
        message: streamResult.finalAssistant,
        toolResults: toolExec.toolResultMessages,
      });
      turnIndex++;

      if (toolExec.shouldTerminate || signal?.aborted) {
        break;
      }
    }

    yield evt("agent_end", { sessionId });
  }

  return { prompt };
}
