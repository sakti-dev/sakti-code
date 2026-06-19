import type { ToolCall, Usage } from "@earendil-works/pi-ai";

// ── Content blocks (re-export pi-ai types for convenience) ──

export type { ToolCall, Usage };

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

// ── AgentMessage discriminated union ──

export interface UserMessage {
  role: "user";
  content: string;
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  usage: Usage;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  toolName: string;
  content: TextContent[];
  isError: boolean;
  timestamp: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

export function isAgentMessage(v: unknown): v is AgentMessage {
  if (v == null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.role !== "string" || typeof o.timestamp !== "number") return false;
  switch (o.role) {
    case "user":
      return typeof o.content === "string";
    case "assistant":
      return Array.isArray(o.content) && typeof o.usage === "object" && o.usage !== null;
    case "tool":
      return typeof o.toolCallId === "string" && typeof o.toolName === "string" && Array.isArray(o.content);
    default:
      return false;
  }
}

// ── Tool types ──

export interface AgentToolResult {
  content: string;
  terminate: boolean;
  isError?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    id: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (partial: string) => void,
  ) => Promise<AgentToolResult>;
}

export function isAgentTool(v: unknown): v is AgentTool {
  if (v == null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && typeof o.description === "string" && typeof o.execute === "function";
}

// ── Event types ──

export interface AgentEventBase {
  timestamp: number;
}

export interface AgentStartEvent extends AgentEventBase { type: "agent_start"; sessionId: string }
export interface AgentEndEvent extends AgentEventBase { type: "agent_end"; sessionId: string }
export interface TurnStartEvent extends AgentEventBase { type: "turn_start"; turnIndex: number }
export interface TurnEndEvent extends AgentEventBase { type: "turn_end"; turnIndex: number; message: Extract<AgentMessage, { role: "assistant" }>; toolResults: Extract<AgentMessage, { role: "tool" }>[] }
export interface MessageStartEvent extends AgentEventBase { type: "message_start" }
export interface MessageEndEvent extends AgentEventBase { type: "message_end" }

export type MessageUpdate =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "toolcall_start"; contentIndex: number }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall };

export interface MessageUpdateEvent extends AgentEventBase { type: "message_update"; update: MessageUpdate }

export interface ToolExecutionStartEvent extends AgentEventBase { type: "tool_execution_start"; toolCallId: string; toolName: string }
export interface ToolExecutionUpdateEvent extends AgentEventBase { type: "tool_execution_update"; toolCallId: string; toolName: string; accumulated: string }
export interface ToolExecutionEndEvent extends AgentEventBase { type: "tool_execution_end"; toolCallId: string; toolName: string; result: AgentToolResult }

export interface ErrorEvent extends AgentEventBase { type: "error"; message: string }
export interface CompactionStartEvent extends AgentEventBase { type: "compaction_start" }
export interface CompactionEndEvent extends AgentEventBase { type: "compaction_end"; tokensBefore: number; tokensAfter: number }
export interface RetryEvent extends AgentEventBase { type: "retry"; attempt: number; maxRetries: number; delayMs: number }

export type AgentEvent =
  | AgentStartEvent | AgentEndEvent
  | TurnStartEvent | TurnEndEvent
  | MessageStartEvent | MessageEndEvent | MessageUpdateEvent
  | ToolExecutionStartEvent | ToolExecutionUpdateEvent | ToolExecutionEndEvent
  | ErrorEvent
  | CompactionStartEvent | CompactionEndEvent
  | RetryEvent;

const EVENT_TYPES = new Set([
  "agent_start", "agent_end",
  "turn_start", "turn_end",
  "message_start", "message_end", "message_update",
  "tool_execution_start", "tool_execution_update", "tool_execution_end",
  "error",
  "compaction_start", "compaction_end",
  "retry",
]);

export function isAgentEvent(v: unknown): v is AgentEvent {
  if (v == null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return EVENT_TYPES.has(o.type as string) && typeof o.timestamp === "number";
}

// ── Config ──

import type { Model } from "@earendil-works/pi-ai";
export type { Model };
export type AnyModel = Model<any>;

// ── SessionStore interface ──

export interface SessionStore {
  loadMessages(sessionId: string): Promise<AgentMessage[]>;
  appendMessage(sessionId: string, message: AgentMessage): Promise<void>;
  replaceMessages(sessionId: string, messages: AgentMessage[]): Promise<void>;
}

export interface AgentConfig {
  sessionId: string;
  model: AnyModel;
  tools: AgentTool[];
  store: SessionStore;
  toolExecutionMode: "sequential" | "parallel";
  maxRetries: number;
  retryBaseDelayMs: number;
  reserveTokens: number;
  keepRecentTokens: number;
}

export interface AgentConfigInput {
  sessionId: string;
  model: AnyModel;
  tools: AgentTool[];
  store: SessionStore;
  toolExecutionMode?: "sequential" | "parallel";
  maxRetries?: number;
  retryBaseDelayMs?: number;
  reserveTokens?: number;
  keepRecentTokens?: number;
}

export function createAgentConfig(input: AgentConfigInput): AgentConfig {
  return {
    toolExecutionMode: input.toolExecutionMode ?? "parallel",
    maxRetries: input.maxRetries ?? 3,
    retryBaseDelayMs: input.retryBaseDelayMs ?? 1000,
    reserveTokens: input.reserveTokens ?? 16000,
    keepRecentTokens: input.keepRecentTokens ?? 20000,
    ...input,
  };
}

export function isAgentConfig(v: unknown): v is AgentConfig {
  if (v == null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.sessionId === "string" && Array.isArray(o.tools) && typeof o.store === "object" && o.store !== null;
}
