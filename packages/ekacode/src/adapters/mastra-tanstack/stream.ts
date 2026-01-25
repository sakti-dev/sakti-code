/**
 * Stream transformation utilities for AI SDK → TanStack AI format
 */

import type { LanguageModelV1StreamPart } from "@ai-sdk/provider";
import type { StreamChunk } from "@tanstack/ai";

/**
 * Accumulator for buffering tool call arguments during streaming
 *
 * Tool calls are streamed in multiple chunks. This class accumulates
 * the partial arguments and yields the complete tool call when finished.
 */
export class ToolCallAccumulator {
  private pendingCalls = new Map<
    string,
    {
      toolName: string;
      args: string;
      index: number;
    }
  >();
  private nextIndex = 0;

  /**
   * Accumulate a tool call delta chunk
   *
   * @param chunk - AI SDK tool-call-delta stream part
   * @returns Complete tool call with { toolCallId, toolName, args } or null
   */
  accumulate(chunk: LanguageModelV1StreamPart & { type: "tool-call-delta" }): {
    toolCallId: string;
    toolName: string;
    args: string;
  } | null {
    const { toolCallId, toolName, argsTextDelta } = chunk;

    // Get or create pending state for this tool call
    let pending = this.pendingCalls.get(toolCallId);

    if (!pending) {
      // New tool call - assign an index
      pending = {
        toolName: toolName || "",
        args: "",
        index: this.nextIndex++,
      };
      this.pendingCalls.set(toolCallId, pending);
    }

    // Append new argument text
    if (argsTextDelta) {
      pending.args += argsTextDelta;
    }

    // Check if we have a complete tool call
    // A complete tool call has valid JSON arguments
    if (isCompleteJSON(pending.args)) {
      this.pendingCalls.delete(toolCallId);
      return {
        toolCallId,
        toolName: pending.toolName,
        args: pending.args,
      };
    }

    return null;
  }

  /**
   * Reset the accumulator state
   */
  reset(): void {
    this.pendingCalls.clear();
    this.nextIndex = 0;
  }
}

/**
 * Check if a string is valid JSON
 */
export function isCompleteJSON(str: string): boolean {
  if (!str || str.length < 2) return false;

  try {
    const parsed = JSON.parse(str);
    // Must be an object or array (not just a primitive)
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

/**
 * Map AI SDK usage to TanStack format
 *
 * @param usage - AI SDK usage object
 * @returns TanStack usage object with total tokens
 */
export function mapUsage(usage: { promptTokens?: number; completionTokens?: number }): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

/**
 * Map AI SDK finish reason to TanStack format
 *
 * @param finishReason - AI SDK finish reason string
 * @returns TanStack finish reason enum value
 */
export function mapFinishReason(
  finishReason: string | undefined | null
): "stop" | "length" | "content_filter" | "tool_calls" | null {
  switch (finishReason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content-filter":
      return "content_filter";
    case "tool-calls":
      return "tool_calls";
    default:
      return "stop";
  }
}

/**
 * Transform AI SDK stream to TanStack stream chunks
 *
 * @param stream - AI SDK readable stream
 * @param model - Model identifier
 * @returns Async iterable of TanStack stream chunks
 */
export async function* transformMastraStreamToTanStack(
  stream: ReadableStream<LanguageModelV1StreamPart>,
  model: string
): AsyncIterable<StreamChunk> {
  const timestamp = Date.now();
  let responseId: string | null = null;

  let accumulatedContent = "";
  let accumulatedThinking = "";

  // Tool call accumulation
  const toolCalls = new Map<string, { toolName: string; args: string; index: number }>();
  let nextToolIndex = 0;

  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      const chunk = value;
      responseId = responseId || generateId("mastra");

      switch (chunk.type) {
        case "text-delta": {
          accumulatedContent += chunk.textDelta;
          yield {
            type: "content",
            id: responseId,
            model,
            timestamp,
            delta: chunk.textDelta,
            content: accumulatedContent,
            role: "assistant",
          };
          break;
        }

        case "tool-call-delta": {
          const { toolCallId, toolName, argsTextDelta } = chunk;

          if (!toolCalls.has(toolCallId)) {
            toolCalls.set(toolCallId, {
              toolName: toolName || "",
              args: "",
              index: nextToolIndex++,
            });
          }

          const call = toolCalls.get(toolCallId)!;
          if (argsTextDelta) {
            call.args += argsTextDelta;
          }

          // Check if we have a complete tool call
          if (isCompleteJSON(call.args)) {
            toolCalls.delete(toolCallId);
            yield {
              type: "tool_call",
              id: responseId,
              model,
              timestamp,
              toolCall: {
                id: toolCallId,
                type: "function",
                function: {
                  name: call.toolName,
                  arguments: call.args,
                },
              },
              index: call.index,
            };
          }
          break;
        }

        case "reasoning": {
          accumulatedThinking += chunk.textDelta;
          yield {
            type: "thinking",
            id: responseId,
            model,
            timestamp,
            delta: chunk.textDelta,
            content: accumulatedThinking,
          };
          break;
        }

        case "finish": {
          yield {
            type: "done",
            id: responseId,
            model,
            timestamp,
            finishReason: mapFinishReason(chunk.finishReason),
            usage: chunk.usage ? mapUsage(chunk.usage) : undefined,
          };
          break;
        }

        case "error": {
          const errorMsg = chunk.error;
          yield {
            type: "error",
            id: responseId,
            model,
            timestamp,
            error: {
              message: typeof errorMsg === "string" ? errorMsg : String(errorMsg),
              code: (errorMsg as { code?: string })?.code,
            },
          };
          break;
        }

        default:
          // Ignore unknown chunk types (reasoning-signature, redacted-reasoning, source, response-metadata, etc.)
          break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Generate a unique ID for stream chunks
 */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
