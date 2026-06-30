import type { AgentMessage } from "@sakti-code/agent";

/**
 * A single content part within a UI message.
 * Text is accumulated from streaming deltas.
 * Tool calls track their execution lifecycle.
 */
export type MessagePart = { isStreaming?: boolean } & (
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      input: unknown;
      status: "running" | "done" | "error";
      result?: string;
      details?: unknown;
    }
  | { type: "thinking"; text: string; startedAt?: number; endedAt?: number }
);

/**
 * Frontend representation of a chat message.
 * Built from AgentHarnessEvents during streaming,
 * or from AgentMessage[] on initial REST load.
 */
export interface UIMessage {
  content: string;
  error?: string;
  id: string;
  isStreaming: boolean;
  parts: MessagePart[];
  role: "user" | "assistant" | "system";
  timestamp: number;
  usage?: {
    cost: number;
    input: number;
    output: number;
    /** Tokens spent on hidden reasoning (subset of `output`). Optional. */
    reasoningTokens?: number;
  };
}

/**
 * Streaming state for a session.
 */
export interface StreamState {
  currentMessageId: string | null;
  currentToolName: string | null;
  phase: "idle" | "thinking" | "writing" | "tool_running" | "error";
  startedAt: number;
  tokenCount: number;
}

export interface TurnTiming {
  endedAt: number | null;
  startedAt: number;
}

/**
 * Transient retry state shown in the banner while the server retries a failed
 * turn. Set by `auto_retry_start`, cleared by `auto_retry_end`. `null` when no
 * retry is in progress (the common case).
 */
export interface RetryState {
  // 1-based retry attempt number (first retry = 1).
  attempt: number;
  // Computed backoff delay before the retry runs.
  delayMs: number;
  // The error text from the failed turn.
  errorMessage: string;
  // Configured max attempts, for "attempt N of M".
  maxAttempts: number;
}

export const idleStreamState: StreamState = {
  phase: "idle",
  startedAt: 0,
  tokenCount: 0,
  currentMessageId: null,
  currentToolName: null,
};

/**
 * Convert an AgentMessage (from REST `/messages` or agent_end) into UIMessage(s).
 */
export function agentMessageToUI(msg: AgentMessage): UIMessage {
  const timestamp = typeof msg.timestamp === "number" ? msg.timestamp : Date.now();

  if (msg.role === "user" || msg.role === "assistant") {
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
    }

    const usage =
      msg.role === "assistant" && "usage" in msg && msg.usage
        ? {
            input: msg.usage.input,
            output: msg.usage.output,
            cost: msg.usage.cost.total,
            ...(msg.usage.reasoningTokens === undefined
              ? {}
              : { reasoningTokens: msg.usage.reasoningTokens }),
          }
        : undefined;

    return {
      id: crypto.randomUUID(),
      role: msg.role,
      content,
      parts: [{ type: "text", text: content }],
      isStreaming: false,
      timestamp,
      ...(usage === undefined ? {} : { usage }),
    };
  }

  return {
    id: crypto.randomUUID(),
    role: "system",
    content: "",
    parts: [],
    isStreaming: false,
    timestamp,
  };
}
