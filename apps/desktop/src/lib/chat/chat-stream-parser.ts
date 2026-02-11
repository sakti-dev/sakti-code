/**
 * Chat Stream Parser
 *
 * Parses AI SDK UIMessage stream protocol from chat responses.
 * Handles SSE-style data: frames and raw protocol lines (0:, b:, d:, e:, 8:).
 *
 * Batch 3: Stream Processing - WS2 Protocol Ingestion
 */

import { createLogger } from "../../lib/logger";

const logger = createLogger("desktop:chat-stream-parser");

/**
 * Stream event types from AI SDK and custom ekacode extensions
 */
export interface TextDeltaEvent {
  type: "text-delta";
  id: string;
  delta: string;
}

export interface ToolCallEvent {
  type: "tool-call";
  id: string;
  toolCallId: string;
  toolName: string;
  args?: unknown;
}

export interface ToolResultEvent {
  type: "tool-result";
  id: string;
  toolCallId: string;
  result: unknown;
}

export interface DataPartEvent {
  type: string; // data-state, data-thought, data-action, etc.
  id: string;
  data: unknown;
  transient?: boolean;
}

export interface FinishEvent {
  type: "finish";
  finishReason: string;
}

export interface ErrorEvent {
  type: "error";
  error: string;
}

export type StreamEvent =
  | TextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | DataPartEvent
  | FinishEvent
  | ErrorEvent;

/**
 * Callbacks for stream events
 */
export interface StreamParserCallbacks {
  /** Called when a new message starts (optional) */
  onMessageStart?: (messageId: string) => void;

  /** Called for each text delta */
  onTextDelta?: (messageId: string, delta: string) => void;

  /** Called when a tool call starts */
  onToolCallStart?: (toolCall: { toolCallId: string; toolName: string; args?: unknown }) => void;

  /** Called when tool call args are complete */
  onToolCallEnd?: (toolCallId: string, args: unknown) => void;

  /** Called when a tool result is received */
  onToolResult?: (result: { toolCallId: string; result: unknown }) => void;

  /** Called for data-* events (thoughts, actions, state, etc.) */
  onDataPart?: (type: string, id: string, data: unknown, transient?: boolean) => void;

  /** Called when stream completes successfully */
  onComplete?: (finishReason: string) => void;

  /** Called when an error occurs */
  onError?: (error: Error) => void;
}

/**
 * Parser options
 */
export interface ParseOptions {
  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Parse a stream event from JSON data
 */
function parseStreamEvent(data: unknown): StreamEvent | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const event = data as Record<string, unknown>;
  const type = event.type as string;

  if (!type) {
    return null;
  }

  switch (type) {
    case "text-delta":
      return {
        type: "text-delta",
        id: (event.id as string) || "",
        delta: (event.delta as string) || "",
      };

    case "tool-call":
      return {
        type: "tool-call",
        id: (event.id as string) || "",
        toolCallId: (event.toolCallId as string) || "",
        toolName: (event.toolName as string) || "",
        args: event.args,
      };

    case "tool-result":
      return {
        type: "tool-result",
        id: (event.id as string) || "",
        toolCallId: (event.toolCallId as string) || "",
        result: event.result,
      };

    case "finish":
      return {
        type: "finish",
        finishReason: (event.finishReason as string) || "stop",
      };

    case "error":
      return {
        type: "error",
        error: (event.error as string) || (event.errorText as string) || "Unknown error",
      };

    default:
      // Handle data-* events
      if (type.startsWith("data-")) {
        return {
          type,
          id: (event.id as string) || "",
          data: event.data,
          transient: event.transient as boolean | undefined,
        };
      }
      return null;
  }
}

/**
 * Type guards for stream events
 */
function isTextDeltaEvent(event: StreamEvent): event is TextDeltaEvent {
  return event.type === "text-delta";
}

function isToolCallEvent(event: StreamEvent): event is ToolCallEvent {
  return event.type === "tool-call";
}

function isToolResultEvent(event: StreamEvent): event is ToolResultEvent {
  return event.type === "tool-result";
}

function isFinishEvent(event: StreamEvent): event is FinishEvent {
  return event.type === "finish";
}

function isErrorEvent(event: StreamEvent): event is ErrorEvent {
  return event.type === "error";
}

function isDataPartEvent(event: StreamEvent): event is DataPartEvent {
  return event.type.startsWith("data-");
}

/**
 * Process a parsed stream event and invoke callbacks
 */
function processStreamEvent(
  event: StreamEvent,
  callbacks: StreamParserCallbacks,
  currentMessageId: string | null
): string | null {
  if (isTextDeltaEvent(event)) {
    const messageId = event.id || currentMessageId || "__stream_message__";
    callbacks.onTextDelta?.(messageId, event.delta);
    return messageId;
  }

  if (isToolCallEvent(event)) {
    callbacks.onToolCallStart?.({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
    });
    callbacks.onToolCallEnd?.(event.toolCallId, event.args ?? {});
    return currentMessageId;
  }

  if (isToolResultEvent(event)) {
    callbacks.onToolResult?.({
      toolCallId: event.toolCallId,
      result: event.result,
    });
    return currentMessageId;
  }

  if (isFinishEvent(event)) {
    callbacks.onComplete?.(event.finishReason);
    return currentMessageId;
  }

  if (isErrorEvent(event)) {
    callbacks.onError?.(new Error(event.error));
    return currentMessageId;
  }

  if (isDataPartEvent(event)) {
    callbacks.onDataPart?.(event.type, event.id, event.data, event.transient);
  }

  return currentMessageId;
}

/**
 * Try to parse raw protocol line (0:, b:, d:, e:, 8:)
 * These are AI SDK internal protocol formats
 */
function tryParseRawLine(
  line: string,
  callbacks: StreamParserCallbacks,
  currentMessageId: string | null
): string | null {
  // 0: prefix - text delta (JSON string)
  if (line.startsWith("0:")) {
    const text = line.slice(2);
    const messageId = currentMessageId || "__raw_message__";
    try {
      // Try to parse as JSON string (may be quoted)
      if (text.startsWith('"') && text.endsWith('"')) {
        const parsed = JSON.parse(text);
        callbacks.onTextDelta?.(messageId, parsed);
      } else {
        callbacks.onTextDelta?.(messageId, text);
      }
    } catch {
      callbacks.onTextDelta?.(messageId, text);
    }
    return messageId;
  }

  // b: prefix - binary/data event (JSON object)
  if (line.startsWith("b:")) {
    try {
      const data = JSON.parse(line.slice(2));
      if (data?.type) {
        const event = parseStreamEvent(data);
        if (event) {
          return processStreamEvent(event, callbacks, currentMessageId);
        }
      }
    } catch {
      // Ignore parse errors for raw protocol
    }
    return currentMessageId;
  }

  // d: prefix - done/finish event
  if (line.startsWith("d:")) {
    try {
      const data = JSON.parse(line.slice(2));
      callbacks.onComplete?.(data.finishReason || "stop");
    } catch {
      callbacks.onComplete?.("stop");
    }
    return currentMessageId;
  }

  // e: prefix - error event
  if (line.startsWith("e:")) {
    try {
      const data = JSON.parse(line.slice(2));
      callbacks.onError?.(new Error(data.message || data.error || "Stream error"));
    } catch {
      callbacks.onError?.(new Error("Unknown stream error"));
    }
    return currentMessageId;
  }

  // 8: prefix - data parts array
  if (line.startsWith("8:")) {
    try {
      const parts = JSON.parse(line.slice(2));
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part?.type?.startsWith("data-")) {
            callbacks.onDataPart?.(part.type, part.id || "", part.data, part.transient);
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
    return currentMessageId;
  }

  return currentMessageId;
}

/**
 * Parse a chat stream from a ReadableStream reader
 *
 * @param reader - ReadableStream reader from fetch response
 * @param callbacks - Callbacks for stream events
 * @param options - Parser options (signal, timeout)
 * @returns Promise that resolves when stream completes
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/chat', { ... });
 * const reader = response.body?.getReader();
 * if (reader) {
 *   await parseChatStream(reader, {
 *     onTextDelta: (msgId, delta) => console.log(delta),
 *     onComplete: (reason) => console.log('Done:', reason),
 *     onError: (err) => console.error(err),
 *   });
 * }
 * ```
 */
export async function parseChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: StreamParserCallbacks,
  options: ParseOptions = {}
): Promise<void> {
  const { signal, timeoutMs } = options;

  let buffer = "";
  let currentMessageId: string | null = null;
  let completed = false;
  let timedOut = false;
  const parserCallbacks: StreamParserCallbacks = {
    ...callbacks,
    onComplete: finishReason => {
      if (completed) return;
      completed = true;
      callbacks.onComplete?.(finishReason);
    },
    onError: error => {
      if (completed) return;
      callbacks.onError?.(error);
    },
  };

  type LoopEvent =
    | { type: "read"; result: ReadableStreamReadResult<Uint8Array> }
    | { type: "read-error"; error: unknown }
    | { type: "timeout" }
    | { type: "abort" };

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise: Promise<LoopEvent> | null =
    timeoutMs && timeoutMs > 0
      ? new Promise(resolve => {
          timeoutId = setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
        })
      : null;

  let onAbort: (() => void) | null = null;
  const abortPromise: Promise<LoopEvent> | null = signal
    ? signal.aborted
      ? Promise.resolve({ type: "abort" as const })
      : new Promise(resolve => {
          onAbort = () => resolve({ type: "abort" });
          signal.addEventListener("abort", onAbort, { once: true });
        })
    : null;

  const decoder = new TextDecoder();

  try {
    while (true) {
      const readPromise: Promise<LoopEvent> = reader
        .read()
        .then(result => ({ type: "read", result }) as LoopEvent)
        .catch(error => ({ type: "read-error", error }) as LoopEvent);

      const events: Promise<LoopEvent>[] = [readPromise];
      if (timeoutPromise) events.push(timeoutPromise);
      if (abortPromise) events.push(abortPromise);
      const next = await Promise.race(events);

      if (next.type === "timeout") {
        timedOut = true;
        logger.warn("Stream read timed out");
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel errors
        }
        parserCallbacks.onComplete?.("timeout");
        break;
      }

      if (next.type === "abort") {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel errors
        }
        break;
      }

      if (next.type === "read-error") {
        throw next.error;
      }

      const { done, value } = next.result;

      if (done) {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          processBufferLine(buffer.trim(), parserCallbacks, currentMessageId);
        }

        if (!completed && !timedOut) {
          parserCallbacks.onComplete?.("stop");
        }
        break;
      }

      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

      for (const line of lines) {
        currentMessageId = processBufferLine(line, parserCallbacks, currentMessageId);
      }
    }
  } catch (error) {
    if (!completed) {
      parserCallbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
    try {
      reader.releaseLock();
    } catch {
      // Ignore release errors
    }
  }
}

/**
 * Process a single line from the buffer
 */
function processBufferLine(
  line: string,
  callbacks: StreamParserCallbacks,
  currentMessageId: string | null
): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return currentMessageId;
  }

  // Handle SSE-style data: prefix
  if (trimmed.startsWith("data: ")) {
    const data = trimmed.slice(6).trim();

    // Handle [DONE] marker
    if (data === "[DONE]") {
      callbacks.onComplete?.("stop");
      return currentMessageId;
    }

    // Try to parse as JSON event
    try {
      const parsed = JSON.parse(data);
      const event = parseStreamEvent(parsed);
      if (event) {
        return processStreamEvent(event, callbacks, currentMessageId);
      }
    } catch {
      // If JSON parse fails, try raw protocol parsing
      return tryParseRawLine(data, callbacks, currentMessageId);
    }
  } else {
    // Try raw protocol parsing for non-SSE lines
    return tryParseRawLine(trimmed, callbacks, currentMessageId);
  }

  return currentMessageId;
}

/**
 * Create a parser instance with stateful message tracking
 * Useful for tracking message ID across multiple parse calls
 */
export function createStreamParser(callbacks: StreamParserCallbacks) {
  let currentMessageId: string | null = null;
  let buffer = "";
  const decoder = new TextDecoder();
  let completed = false;
  const parserCallbacks: StreamParserCallbacks = {
    ...callbacks,
    onComplete: finishReason => {
      if (completed) return;
      completed = true;
      callbacks.onComplete?.(finishReason);
    },
    onError: error => {
      if (completed) return;
      callbacks.onError?.(error);
    },
  };

  return {
    /**
     * Parse a chunk of stream data
     * @param chunk - Uint8Array chunk from stream
     * @returns true if parsing should continue, false if complete
     */
    parseChunk(chunk: Uint8Array): boolean {
      buffer += decoder.decode(chunk, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        currentMessageId = processBufferLine(line, parserCallbacks, currentMessageId);
      }

      return true;
    },

    /**
     * Signal end of stream
     */
    end(): void {
      if (buffer.trim()) {
        processBufferLine(buffer.trim(), parserCallbacks, currentMessageId);
      }
      if (!completed) {
        parserCallbacks.onComplete?.("stop");
      }
    },

    /**
     * Get current message ID
     */
    getCurrentMessageId(): string | null {
      return currentMessageId;
    },

    /**
     * Reset parser state
     */
    reset(): void {
      currentMessageId = null;
      buffer = "";
      completed = false;
    },
  };
}
