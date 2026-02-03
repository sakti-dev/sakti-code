/**
 * Extended UIMessage types for the desktop chat integration
 *
 * Based on Vercel AI SDK's UIMessage with custom data parts for:
 * - RLM (Recursive Language Model) state from workflow engine
 * - Progress updates for long-running operations
 * - Permission requests from tools
 * - Session data
 */
import type { UIMessage } from "ai";

/**
 * Extended UI message with custom data parts
 * Uses AI SDK's native extended message format for type-safe custom parts
 */
export type ChatUIMessage = UIMessage<
  never, // No reasoning parts needed
  {
    "data-rlm-state": RLMStateData;
    "data-progress": ProgressData;
    "data-permission": PermissionRequestData;
    "data-session": SessionData;
  }
>;

/**
 * RLM (Recursive Language Model) state from backend orchestrator
 * Represents the current state of the explore → plan → build workflow
 */
export interface RLMStateData {
  /** XState machine value (current state node) */
  value: unknown;
  /** Current phase of the workflow */
  phase?: "explore" | "plan" | "build" | "completed" | "failed";
  /** Current step within the phase */
  step?: string;
  /** 0-1 progress indicator */
  progress?: number;
  /** Currently running agents */
  activeAgents?: string[];
  /** Additional context about current operation */
  context?: Record<string, unknown>;
}

/**
 * Progress updates for long-running operations
 * Used for operations like file scanning, indexing, etc.
 */
export interface ProgressData {
  /** Name of the operation being performed */
  operation: string;
  /** Current progress count */
  current: number;
  /** Total items to process */
  total: number;
  /** Optional message describing current activity */
  message?: string;
}

/**
 * Permission request data from tool execution
 * Sent via SSE when a tool requires user approval
 */
export interface PermissionRequestData {
  /** Unique ID for this permission request */
  id: string;
  /** Name of the tool requesting permission */
  toolName: string;
  /** Arguments passed to the tool */
  args: Record<string, unknown>;
  /** Session ID this request belongs to */
  sessionID: string;
  /** Timestamp of the request */
  timestamp?: string;
  /** Description of what the tool will do */
  description?: string;
}

/**
 * Session data from the server
 * Sent on new session creation or session restoration
 */
export interface SessionData {
  /** Server-generated session ID (UUIDv7) */
  sessionId: string;
  /** Resource ID (userId or 'local') */
  resourceId: string;
  /** Thread ID (same as sessionId per cohesion doc) */
  threadId: string;
  /** Session creation timestamp */
  createdAt: string;
  /** Last access timestamp */
  lastAccessed: string;
}

/**
 * Chat state for Solid store
 * Represents the complete state of a chat session
 */
export interface ChatState {
  /** All messages in the conversation */
  messages: ChatUIMessage[];
  /** Current connection/streaming status */
  status: ChatStatus;
  /** Current error if any */
  error: Error | null;
  /** Current RLM state (extracted from data parts for easy access) */
  rlmState: RLMStateData | null;
  /** Current session ID */
  sessionId: string | null;
}

/**
 * Chat status enum-like type
 */
export type ChatStatus =
  | "idle" // Ready for input
  | "connecting" // Establishing connection
  | "streaming" // Receiving streamed response
  | "processing" // Server processing (between stream chunks)
  | "done" // Response complete
  | "error"; // Error occurred

/**
 * Tool call part data structure
 * Used for rendering tool calls in the message list
 */
export interface ToolCallPartData {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  /** Status for UI display */
  status?: "pending" | "executing" | "completed" | "failed";
}

/**
 * Tool result part data structure
 * Used for rendering tool results in the message list
 */
export interface ToolResultPartData {
  type: "tool-result";
  toolCallId: string;
  toolName?: string;
  result?: unknown;
  error?: string;
}
