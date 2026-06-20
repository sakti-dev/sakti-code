import {
  compactMessages,
  estimateContextTokens,
  shouldCompact,
} from "../compaction.ts";
import type { AgentConfigInput, AgentEvent, AgentMessage } from "../types.ts";
import { createAgentConfig } from "../types.ts";
import { evt } from "./events.ts";
import { streamLLMResponse } from "./streaming.ts";
import { executeToolCalls } from "./tool-execution.ts";

const QUEUE_BOUND = 10;

export interface AgentLoop {
  followUp(message: string): void;
  prompt(message: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  steer(message: string): void;
}

export function createAgentLoop(config: AgentConfigInput): AgentLoop {
  const resolved = createAgentConfig(config);
  const { sessionId, model, tools, store } = resolved;
  const maxRetries = resolved.maxRetries;
  const baseDelay = resolved.retryBaseDelayMs;
  const autoRetry = resolved.autoRetry ?? true;

  const steerQueue: string[] = [];
  const followUpQueue: string[] = [];
  let steerAbort = new AbortController();

  function enqueue(queue: string[], msg: string) {
    if (queue.length >= QUEUE_BOUND) {
      return; // silently drop overflow
    }
    queue.push(msg);
  }

  async function injectMessage(
    messages: AgentMessage[],
    text: string
  ): Promise<void> {
    const msg: AgentMessage = {
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    messages.push(msg);
    await store.appendMessage(sessionId, msg);
  }

  /**
   * Drain the steer queue: pop messages and inject as user messages.
   * Returns true if any steers were processed.
   */
  async function drainSteers(messages: AgentMessage[]): Promise<boolean> {
    if (steerQueue.length === 0) {
      return false;
    }
    const mode = resolved.steeringMode ?? "all";
    if (mode === "one-at-a-time") {
      const msg = steerQueue.shift();
      if (msg) {
        await injectMessage(messages, msg);
      }
    } else {
      while (steerQueue.length > 0) {
        const msg = steerQueue.shift();
        if (msg) {
          await injectMessage(messages, msg);
        }
      }
    }
    return true;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: prompt orchestrates LLM streaming, tool execution, steer/follow-up queues, and termination — each is a distinct concern that composes naturally; extracting further would increase indirection without reducing the combined branching the loop must manage
  async function* prompt(
    message: string,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent> {
    const messages: AgentMessage[] = await store.loadMessages(sessionId);
    let turnIndex = 0;
    // Under followUpMode "one-at-a-time" only one follow-up runs per prompt
    // lifecycle; this flag gates both follow-up injection points.
    let followUpDone = false;

    await injectMessage(messages, message);

    yield evt("agent_start", { sessionId });

    while (true) {
      // Process any queued steers before the turn
      await drainSteers(messages);

      // Auto-compaction: if enabled and a summarization key is available,
      // check whether the context is near the window limit before sending
      // to the LLM. Keys off the real provider-reported usage.totalTokens
      // (estimateContextTokens), matching the proven pi agent. A missing key
      // is skipped silently; a failed summarization leaves messages unchanged
      // (compactMessages returns the same array reference on no-op).
      if (resolved.autoCompaction && resolved.apiKey) {
        const contextTokens = estimateContextTokens(messages);
        if (
          shouldCompact(
            contextTokens,
            model.contextWindow,
            resolved.reserveTokens
          )
        ) {
          yield evt("compaction_start", {});
          const result = await compactMessages({
            model,
            apiKey: resolved.apiKey,
            contextWindow: model.contextWindow,
            messages,
            reserveTokens: resolved.reserveTokens,
            keepRecentTokens: resolved.keepRecentTokens,
            ...(signal ? { signal } : {}),
          });
          if (result.messages !== messages) {
            messages.length = 0;
            messages.push(...result.messages);
            await store.replaceMessages(sessionId, result.messages);
          }
          yield evt("compaction_end", {
            tokensBefore: result.tokensBefore,
            tokensAfter: result.tokensAfter,
          });
        }
      }

      yield evt("turn_start", { turnIndex });
      yield evt("message_start");

      // The LLM stream must NOT be aborted by a steer — a steer arriving
      // mid-stream is processed after the stream completes (see drainSteers
      // calls below). Only the caller's abort signal applies to the stream.
      const streamResult = yield* streamLLMResponse(
        model,
        messages,
        tools,
        signal,
        autoRetry ? maxRetries : 0,
        baseDelay,
        sessionId,
        resolved.thinkingLevel
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

        // A steer may have arrived during streaming — process it before
        // checking follow-up / terminating.
        if (await drainSteers(messages)) {
          turnIndex++;
          continue;
        }

        // Before terminating, check follow-up queue
        const followUpMsg = followUpQueue.shift();
        if (followUpMsg && !followUpDone) {
          await injectMessage(messages, followUpMsg);
          if (resolved.followUpMode === "one-at-a-time") {
            followUpDone = true;
          }
          turnIndex++;
          continue;
        }
        break;
      }

      // Reset the steer abort controller before tool execution so a steer
      // arriving mid-execution aborts the running tool via the combined signal.
      steerAbort = new AbortController();
      const toolSignal = combineSignals(signal, steerAbort.signal);

      const toolExec = yield* executeToolCalls(
        streamResult.toolCalls,
        tools,
        toolSignal,
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

      // After tool execution, check for steers that arrived mid-execution
      const hadSteers = await drainSteers(messages);
      if (hadSteers) {
        continue; // process steers in a new turn
      }

      // Check follow-up queue
      const followUpMsg = followUpQueue.shift();
      if (followUpMsg && !followUpDone) {
        await injectMessage(messages, followUpMsg);
        if (resolved.followUpMode === "one-at-a-time") {
          followUpDone = true;
        }
      }
    }

    yield evt("agent_end", { sessionId });
  }

  return {
    prompt,
    steer(message: string) {
      enqueue(steerQueue, message);
      // If a tool is executing, abort it
      if (!steerAbort.signal.aborted) {
        steerAbort.abort();
      }
    },
    followUp(message: string) {
      enqueue(followUpQueue, message);
    },
  };
}

function combineSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const valid = signals.filter((s): s is AbortSignal => s !== undefined);
  if (valid.length === 0) {
    return;
  }
  if (valid.length === 1) {
    return valid[0];
  }

  const controller = new AbortController();
  for (const s of valid) {
    if (s.aborted) {
      controller.abort();
      return controller.signal;
    }
    s.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}
