import type { ToolCall, Usage } from "@earendil-works/pi-ai";

// ── Content blocks (re-export pi-ai types for convenience) ──

export type { ToolCall, Usage };

export interface TextContent {
  text: string;
  type: "text";
}

export interface ThinkingContent {
  thinking: string;
  type: "thinking";
}

// ── AgentMessage discriminated union ──

export interface UserMessage {
  content: string;
  role: "user";
  timestamp: number;
}

export interface AssistantMessage {
  content: (TextContent | ThinkingContent | ToolCall)[];
  role: "assistant";
  timestamp: number;
  usage: Usage;
}

export interface ToolResultMessage {
  content: TextContent[];
  isError: boolean;
  role: "tool";
  timestamp: number;
  toolCallId: string;
  toolName: string;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

export function isAgentMessage(v: unknown): v is AgentMessage {
  if (v == null || typeof v !== "object") {
    return false;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.role !== "string" || typeof o.timestamp !== "number") {
    return false;
  }
  switch (o.role) {
    case "user":
      return typeof o.content === "string";
    case "assistant":
      return (
        Array.isArray(o.content) &&
        typeof o.usage === "object" &&
        o.usage !== null
      );
    case "tool":
      return (
        typeof o.toolCallId === "string" &&
        typeof o.toolName === "string" &&
        Array.isArray(o.content)
      );
    default:
      return false;
  }
}

// ── Tool types ──

export interface AgentToolResult {
  content: string;
  isError?: boolean;
  terminate: boolean;
}

export interface AgentTool {
  description: string;
  execute: (
    id: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (partial: string) => void
  ) => Promise<AgentToolResult>;
  name: string;
  parameters: Record<string, unknown>;
}

export function isAgentTool(v: unknown): v is AgentTool {
  if (v == null || typeof v !== "object") {
    return false;
  }
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.description === "string" &&
    typeof o.execute === "function"
  );
}

// ── Event types ──

export interface AgentEventBase {
  timestamp: number;
}

export interface AgentStartEvent extends AgentEventBase {
  sessionId: string;
  type: "agent_start";
}
export interface AgentEndEvent extends AgentEventBase {
  sessionId: string;
  type: "agent_end";
}
export interface TurnStartEvent extends AgentEventBase {
  turnIndex: number;
  type: "turn_start";
}
export interface TurnEndEvent extends AgentEventBase {
  message: Extract<AgentMessage, { role: "assistant" }>;
  toolResults: Extract<AgentMessage, { role: "tool" }>[];
  turnIndex: number;
  type: "turn_end";
}
export interface MessageStartEvent extends AgentEventBase {
  type: "message_start";
}
export interface MessageEndEvent extends AgentEventBase {
  type: "message_end";
}

export type MessageUpdate =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "toolcall_start"; contentIndex: number }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall };

export interface MessageUpdateEvent extends AgentEventBase {
  type: "message_update";
  update: MessageUpdate;
}

export interface ToolExecutionStartEvent extends AgentEventBase {
  toolCallId: string;
  toolName: string;
  type: "tool_execution_start";
}
export interface ToolExecutionUpdateEvent extends AgentEventBase {
  accumulated: string;
  toolCallId: string;
  toolName: string;
  type: "tool_execution_update";
}
export interface ToolExecutionEndEvent extends AgentEventBase {
  result: AgentToolResult;
  toolCallId: string;
  toolName: string;
  type: "tool_execution_end";
}

export interface ErrorEvent extends AgentEventBase {
  message: string;
  type: "error";
}
export interface CompactionStartEvent extends AgentEventBase {
  type: "compaction_start";
}
export interface CompactionEndEvent extends AgentEventBase {
  tokensAfter: number;
  tokensBefore: number;
  type: "compaction_end";
}
export interface RetryEvent extends AgentEventBase {
  attempt: number;
  delayMs: number;
  maxRetries: number;
  type: "retry";
}

export type AgentEvent =
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageEndEvent
  | MessageUpdateEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | ErrorEvent
  | CompactionStartEvent
  | CompactionEndEvent
  | RetryEvent;

const EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_end",
  "message_update",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "error",
  "compaction_start",
  "compaction_end",
  "retry",
]);

export function isAgentEvent(v: unknown): v is AgentEvent {
  if (v == null || typeof v !== "object") {
    return false;
  }
  const o = v as Record<string, unknown>;
  return EVENT_TYPES.has(o.type as string) && typeof o.timestamp === "number";
}

// ── Config ──

import type { Model } from "@earendil-works/pi-ai";

export type { Model };
export type AnyModel = Model<any>;

// ── SessionStore interface ──

export interface SessionStore {
  appendMessage(sessionId: string, message: AgentMessage): Promise<void>;
  loadMessages(sessionId: string): Promise<AgentMessage[]>;
  replaceMessages(sessionId: string, messages: AgentMessage[]): Promise<void>;
}

export interface AgentConfig {
  keepRecentTokens: number;
  maxRetries: number;
  model: AnyModel;
  reserveTokens: number;
  retryBaseDelayMs: number;
  sessionId: string;
  store: SessionStore;
  toolExecutionMode: "sequential" | "parallel";
  tools: AgentTool[];
}

export interface AgentConfigInput {
  keepRecentTokens?: number;
  maxRetries?: number;
  model: AnyModel;
  reserveTokens?: number;
  retryBaseDelayMs?: number;
  sessionId: string;
  store: SessionStore;
  toolExecutionMode?: "sequential" | "parallel";
  tools: AgentTool[];
}

export function createAgentConfig(input: AgentConfigInput): AgentConfig {
  return {
    toolExecutionMode: input.toolExecutionMode ?? "parallel",
    maxRetries: input.maxRetries ?? 3,
    retryBaseDelayMs: input.retryBaseDelayMs ?? 1000,
    reserveTokens: input.reserveTokens ?? 16_000,
    keepRecentTokens: input.keepRecentTokens ?? 20_000,
    ...input,
  };
}

export function isAgentConfig(v: unknown): v is AgentConfig {
  if (v == null || typeof v !== "object") {
    return false;
  }
  const o = v as Record<string, unknown>;
  return (
    typeof o.sessionId === "string" &&
    Array.isArray(o.tools) &&
    typeof o.store === "object" &&
    o.store !== null
  );
}
