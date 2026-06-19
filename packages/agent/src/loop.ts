import { streamSimple } from "@earendil-works/pi-ai";
import { createAgentConfig } from "./types.ts";
import type {
  AgentConfigInput,
  AgentEvent,
  AgentMessage,
  AgentToolResult,
} from "./types.ts";

export { createAgentConfig } from "./types.ts";

function toPiMessages(messages: AgentMessage[]) {
  return messages.map((msg): any => {
    if (msg.role === "user") return { role: "user", content: msg.content, timestamp: msg.timestamp };
    if (msg.role === "assistant") return { role: "assistant", content: msg.content, usage: msg.usage, stopReason: "stop", api: "openai-completions", provider: "openai", model: "unknown", timestamp: msg.timestamp };
    return { role: "toolResult", toolCallId: msg.toolCallId, toolName: msg.toolName, content: msg.content, isError: msg.isError, timestamp: msg.timestamp };
  });
}

function evt(type: AgentEvent["type"] & string, extra: Record<string, unknown> = {}): AgentEvent {
  return { type: type as AgentEvent["type"], timestamp: Date.now(), ...extra } as AgentEvent;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const e = err as any;
    return e.statusCode === 429 || (e.statusCode >= 500 && e.statusCode < 600);
  }
  return false;
}

export interface AgentLoop {
  prompt(message: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

export function createAgentLoop(config: AgentConfigInput): AgentLoop {
  const resolved = createAgentConfig(config);
  const { sessionId, model, tools, store } = resolved;
  const maxRetries = resolved.maxRetries;
  const baseDelay = resolved.retryBaseDelayMs;

  async function* prompt(message: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const messages: AgentMessage[] = await store.loadMessages(sessionId);
    let turnIndex = 0;

    const userMsg: AgentMessage = { role: "user", content: message, timestamp: Date.now() };
    messages.push(userMsg);
    await store.appendMessage(sessionId, userMsg);

    yield evt("agent_start", { sessionId });

    while (true) {
      yield evt("turn_start", { turnIndex });

      const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
      let finalAssistant: AgentMessage | null = null;

      yield evt("message_start");

      // ── Stream with retry ──
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) break;
        try {
          const stream = streamSimple(model, {
            messages: toPiMessages(messages),
            tools: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
          }, { signal: signal as AbortSignal });

          for await (const event of stream) {
            if (signal?.aborted) break;
            switch (event.type) {
              case "text_delta":
                yield evt("message_update", { update: { type: "text_delta", delta: event.delta } });
                break;
              case "thinking_delta":
                yield evt("message_update", { update: { type: "thinking_delta", delta: event.delta } });
                break;
              case "toolcall_start":
                yield evt("message_update", { update: { type: "toolcall_start", contentIndex: event.contentIndex } });
                break;
              case "toolcall_delta":
                yield evt("message_update", { update: { type: "toolcall_delta", contentIndex: event.contentIndex, delta: event.delta } });
                break;
              case "toolcall_end":
                toolCalls.push({ id: event.toolCall.id, name: event.toolCall.name, arguments: event.toolCall.arguments });
                yield evt("message_update", { update: { type: "toolcall_end", contentIndex: event.contentIndex, toolCall: event.toolCall } });
                break;
              case "done":
                finalAssistant = { role: "assistant", content: event.message.content, usage: event.message.usage, timestamp: event.message.timestamp };
                break;
              case "error":
                yield evt("error", { message: event.error.errorMessage ?? "LLM error" });
                yield evt("agent_end", { sessionId });
                return;
            }
          }

          // Success — break retry loop
          break;
        } catch (err) {
          if (signal?.aborted) break;
          if (isRetryable(err) && attempt < maxRetries) {
            const delay = baseDelay * Math.pow(2, attempt);
            yield evt("retry", { attempt: attempt + 1, maxRetries, delayMs: delay });
            await new Promise((r) => setTimeout(r, delay));
          } else if (isRetryable(err)) {
            yield evt("error", { message: `Max retries (${maxRetries}) exceeded` });
            yield evt("agent_end", { sessionId });
            return;
          } else {
            yield evt("error", { message: err instanceof Error ? err.message : "Stream error" });
            yield evt("agent_end", { sessionId });
            return;
          }
        }
      }

      if (signal?.aborted) {
        yield evt("agent_end", { sessionId });
        return;
      }

      yield evt("message_end");

      if (!finalAssistant) {
        yield evt("error", { message: "Stream ended without assistant message" });
        yield evt("agent_end", { sessionId });
        return;
      }

      messages.push(finalAssistant);
      await store.appendMessage(sessionId, finalAssistant);

      if (toolCalls.length === 0) {
        yield evt("turn_end", { turnIndex, message: finalAssistant, toolResults: [] });
        break;
      }

      // ── Execute tools ──
      const toolMap = new Map(tools.map((t) => [t.name, t]));
      const toolResultMessages: Extract<AgentMessage, { role: "tool" }>[] = [];

      for (const tc of toolCalls) {
        const tool = toolMap.get(tc.name);
        let result: AgentToolResult;

        yield evt("tool_execution_start", { toolCallId: tc.id, toolName: tc.name });

        if (!tool) {
          result = { content: `Unknown tool: ${tc.name}`, terminate: false, isError: true };
        } else {
          let accumulated = "";
          try {
            result = await tool.execute(tc.id, tc.arguments, signal, (partial) => { accumulated += partial; });
            yield evt("tool_execution_update", { toolCallId: tc.id, toolName: tc.name, accumulated });
          } catch (err: any) {
            result = { content: err.message ?? "Tool execution error", terminate: false, isError: true };
          }
        }

        yield evt("tool_execution_end", { toolCallId: tc.id, toolName: tc.name, result });

        const toolMsg: Extract<AgentMessage, { role: "tool" }> = { role: "tool", toolCallId: tc.id, toolName: tc.name, content: [{ type: "text", text: result.content }], isError: result.isError ?? false, timestamp: Date.now() };
        messages.push(toolMsg);
        toolResultMessages.push(toolMsg);
        await store.appendMessage(sessionId, messages[messages.length - 1]!);
      }

      yield evt("turn_end", { turnIndex, message: finalAssistant, toolResults: toolResultMessages });
      turnIndex++;

      if (signal?.aborted) break;
    }

    yield evt("agent_end", { sessionId });
  }

  return { prompt };
}
