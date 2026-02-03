/**
 * UIMessage Stream Parser
 *
 * Parses the Vercel AI SDK's UIMessage stream protocol.
 * Handles text-delta, tool-input-start/delta/end, tool-call, tool-result, and custom data-* parts.
 *
 * This follows the AI SDK's native protocol - no custom SSE event types.
 * See: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol
 */

/**
 * Callbacks for stream events
 */
export interface StreamCallbacks {
  /** Called when a new message starts */
  onMessageStart?: (messageId: string) => void;

  /** Called for each text chunk (very high frequency: 50-100/sec) */
  onTextDelta?: (messageId: string, delta: string) => void;

  /** Called when a tool call starts */
  onToolCallStart?: (toolCall: { toolCallId: string; toolName: string }) => void;

  /** Called for each tool args delta (streaming tool input) */
  onToolCallDelta?: (toolCallId: string, argsTextDelta: string) => void;

  /** Called when tool call args are complete */
  onToolCallEnd?: (toolCallId: string, args: unknown) => void;

  /** Called when tool execution returns a result */
  onToolResult?: (result: { toolCallId: string; result: unknown }) => void;

  /** Called for custom data-* parts (RLM state, progress, etc.) */
  onDataPart?: (type: string, id: string, data: unknown, transient?: boolean) => void;

  /** Called when an error occurs */
  onError?: (error: Error) => void;

  /** Called when the stream completes */
  onComplete?: (finishReason: string) => void;
}

/**
 * Internal interface for parsed stream parts
 */
interface StreamPart {
  type: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Parse AI SDK UIMessage stream from a Response
 *
 * Handles both SSE format (data: {...}) and raw protocol lines (0:text, d:{json}).
 *
 * @param response - Fetch Response with streaming body
 * @param callbacks - Event callbacks for stream updates
 *
 * @example
 * ```ts
 * await parseUIMessageStream(response, {
 *   onTextDelta: (id, delta) => store.appendTextDelta(id, delta),
 *   onToolCallStart: (tc) => store.addToolCall(id, tc),
 *   onComplete: () => store.setStatus("done"),
 * });
 * ```
 */
export async function parseUIMessageStream(
  response: Response,
  callbacks: StreamCallbacks
): Promise<void> {
  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentMessageId: string | null = null;

  // Buffer for accumulating streaming tool args
  const toolArgsBuffers = new Map<string, string>();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        callbacks.onComplete?.("stop");
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        // Handle SSE data format (data: {...})
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();

          // Check for end of stream
          if (data === "[DONE]") {
            callbacks.onComplete?.("stop");
            continue;
          }

          try {
            const part = JSON.parse(data) as StreamPart;
            currentMessageId = handleStreamPart(part, callbacks, currentMessageId, toolArgsBuffers);
          } catch {
            // Non-JSON data, try raw line parsing
            currentMessageId = tryParseRawLine(line, callbacks, currentMessageId);
          }
        } else {
          // Raw protocol line (0:text, b:json, d:json, etc.)
          currentMessageId = tryParseRawLine(line, callbacks, currentMessageId);
        }
      }
    }
  } catch (error) {
    // Handle abort (not an error)
    if ((error as Error).name === "AbortError") {
      return;
    }
    callbacks.onError?.(error as Error);
    throw error;
  }
}

/**
 * Handle individual stream parts
 */
function handleStreamPart(
  part: StreamPart,
  callbacks: StreamCallbacks,
  currentMessageId: string | null,
  toolArgsBuffers: Map<string, string>
): string | null {
  const type = part.type;
  const id = part.id as string | undefined;

  switch (type) {
    case "message-start":
      if (id) {
        callbacks.onMessageStart?.(id);
        return id;
      }
      break;

    case "text-delta":
    case "text":
      callbacks.onTextDelta?.(
        id || currentMessageId || "",
        (part.delta as string) || (part.text as string) || ""
      );
      break;

    case "tool-input-start":
      callbacks.onToolCallStart?.({
        toolCallId: part.toolCallId as string,
        toolName: part.toolName as string,
      });
      toolArgsBuffers.set(part.toolCallId as string, "");
      break;

    case "tool-input-delta":
      {
        const toolCallId = part.toolCallId as string;
        const currentArgs = toolArgsBuffers.get(toolCallId) ?? "";
        toolArgsBuffers.set(toolCallId, currentArgs + ((part.delta as string) || ""));
        callbacks.onToolCallDelta?.(toolCallId, (part.delta as string) || "");
      }
      break;

    case "tool-input-end":
      {
        const toolCallId = part.toolCallId as string;
        const finalArgs = toolArgsBuffers.get(toolCallId) ?? "{}";
        try {
          const parsedArgs = JSON.parse(finalArgs);
          callbacks.onToolCallEnd?.(toolCallId, parsedArgs);
        } catch {
          callbacks.onToolCallEnd?.(toolCallId, {});
        }
        toolArgsBuffers.delete(toolCallId);
      }
      break;

    case "tool-call":
      // Complete tool call in one part
      callbacks.onToolCallStart?.({
        toolCallId: part.toolCallId as string,
        toolName: part.toolName as string,
      });
      callbacks.onToolCallEnd?.(part.toolCallId as string, part.args);
      break;

    case "tool-result":
      callbacks.onToolResult?.({
        toolCallId: part.toolCallId as string,
        result: part.result,
      });
      break;

    case "error":
      callbacks.onError?.(new Error((part.error as string) || "Unknown stream error"));
      break;

    case "finish":
      callbacks.onComplete?.((part.finishReason as string) || "stop");
      break;

    default:
      // Handle data-* parts (RLM state, progress, etc.)
      if (type?.startsWith("data-")) {
        callbacks.onDataPart?.(type, id || "", part.data, part.transient as boolean | undefined);
      }
  }

  return currentMessageId;
}

/**
 * Parse raw AI SDK protocol lines
 *
 * Format: TYPE_CODE:CONTENT
 * - 0: text delta
 * - b: tool input
 * - d: finish/done
 * - 8: custom data
 */
function tryParseRawLine(
  line: string,
  callbacks: StreamCallbacks,
  currentMessageId: string | null
): string | null {
  // Text delta: 0:text content
  if (line.startsWith("0:")) {
    const text = line.slice(2);
    // Try to parse as JSON first (quote-prefixed)
    if (text.startsWith('"') && text.endsWith('"')) {
      try {
        callbacks.onTextDelta?.(currentMessageId || "", JSON.parse(text));
      } catch {
        callbacks.onTextDelta?.(currentMessageId || "", text);
      }
    } else {
      callbacks.onTextDelta?.(currentMessageId || "", text);
    }
    return currentMessageId;
  }

  // Tool input/result: b:{json}
  if (line.startsWith("b:")) {
    try {
      const data = JSON.parse(line.slice(2));
      // Dispatch based on data structure
      if (data.type) {
        return handleStreamPart(data, callbacks, currentMessageId, new Map());
      }
    } catch {
      // Ignore parse errors
    }
    return currentMessageId;
  }

  // Finish: d:{json}
  if (line.startsWith("d:")) {
    try {
      const data = JSON.parse(line.slice(2));
      callbacks.onComplete?.((data.finishReason as string) || "stop");
    } catch {
      callbacks.onComplete?.("stop");
    }
    return currentMessageId;
  }

  // Custom data: 8:{json}
  if (line.startsWith("8:")) {
    try {
      const parts = JSON.parse(line.slice(2));
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part.type?.startsWith("data-")) {
            callbacks.onDataPart?.(part.type, part.id || "", part.data, part.transient);
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
    return currentMessageId;
  }

  // Error: e:{json}
  if (line.startsWith("e:")) {
    try {
      const data = JSON.parse(line.slice(2));
      callbacks.onError?.(new Error(data.message || data.error || "Stream error"));
    } catch {
      callbacks.onError?.(new Error("Unknown stream error"));
    }
    return currentMessageId;
  }

  return currentMessageId;
}
