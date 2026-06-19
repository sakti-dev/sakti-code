import type { AgentConfigInput, AgentEvent, AgentMessage } from "../types.ts";
import { createAgentConfig } from "../types.ts";
import { evt } from "./events.ts";
import { streamLLMResponse } from "./streaming.ts";
import { executeToolCalls } from "./tool-execution.ts";

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
