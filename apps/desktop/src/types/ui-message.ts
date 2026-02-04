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

// =============================================================================
// Antigravity UI Mode & Event Types
// =============================================================================

/**
 * Agent mode determines which UI composition to render
 * - planning: Aggregated "Run Card" UI (single evolving block)
 * - build: Chronological "Activity Feed" UI (flat timeline)
 * - chat: Simple conversation mode (default)
 */
export type AgentMode = "planning" | "build" | "chat";

/**
 * Canonical event kinds for agent actions (shared across modes)
 */
export type AgentEventKind =
  | "thought" // AI model reasoning (from AI SDK reasoning events)
  | "note" // Informational message
  | "analyzed" // Read-only file/search operations
  | "created" // New file created
  | "edited" // File modified
  | "deleted" // File deleted
  | "terminal" // Shell command execution
  | "error" // Error occurred
  | "tool"; // Generic tool call

/**
 * Event actions for user interaction (Electron IPC)
 */
export type AgentEventAction =
  | { type: "open-file"; path: string; line?: number }
  | { type: "open-diff"; path: string }
  | { type: "open-terminal"; id: string }
  | { type: "open-url"; url: string };

/**
 * Canonical agent event (used in both planning and build modes)
 * Maps to tool-call/tool-result events from AgentProcessor
 */
export interface AgentEvent {
  /** Unique event ID */
  id: string;
  /** Timestamp (ms since epoch) */
  ts: number;
  /** Event kind determines icon and styling */
  kind: AgentEventKind;
  /** Primary display text (e.g., "Read file.ts") */
  title: string;
  /** Secondary text (e.g., file path, command output preview) */
  subtitle?: string;
  /** File info for file-related events */
  file?: {
    path: string;
    range?: string; // e.g., "L10-L25"
  };
  /** Diff stats for edit events */
  diff?: {
    plus: number;
    minus: number;
  };
  /** Terminal info for shell events */
  terminal?: {
    command: string;
    cwd?: string;
    outputPreview: string;
    exitCode?: number;
    background?: boolean;
  };
  /** Error info */
  error?: {
    message: string;
    details?: string;
  };
  /** Available actions for this event */
  actions?: AgentEventAction[];
  /** Tool call ID for linking to tool-result */
  toolCallId?: string;
  /** Agent ID that produced this event */
  agentId?: string;
}

// =============================================================================
// Reasoning Part (from AI SDK reasoning-start/delta/end events)
// =============================================================================

/**
 * Reasoning part for "Thought for Ns" display
 * Matches OpenCode's ReasoningPart schema
 */
export interface ReasoningPart {
  /** Unique reasoning ID */
  id: string;
  /** Reasoning text (accumulated from deltas) */
  text: string;
  /** Provider metadata */
  metadata?: Record<string, unknown>;
  /** Timing info */
  time: {
    start: number;
    end?: number;
  };
}

/**
 * Data for streaming reasoning updates
 */
export interface ThoughtData {
  /** Reasoning ID */
  id: string;
  /** Accumulated text */
  text: string;
  /** Status of the reasoning */
  status: "thinking" | "complete";
  /** Duration in ms (set when complete) */
  durationMs?: number;
  /** Agent ID */
  agentId?: string;
}

// =============================================================================
// Planning Mode: Run Card Types
// =============================================================================

/**
 * Run Card data for planning mode aggregated view
 */
export interface RunCardData {
  /** Unique run ID */
  runId: string;
  /** Run title (e.g., "Planning Authentication") */
  title: string;
  /** Subtitle/description */
  subtitle?: string;
  /** Current status */
  status: "planning" | "executing" | "done" | "error";
  /** Ordered list of edited file paths */
  filesEditedOrder: string[];
  /** Ordered list of progress group IDs */
  groupsOrder: string[];
  /** Whether all groups are collapsed */
  collapsedAll?: boolean;
  /** Start timestamp */
  startedAt?: number;
  /** First significant update timestamp */
  firstSignificantUpdateAt?: number;
  /** Finish timestamp */
  finishedAt?: number;
  /** Duration in ms */
  elapsedMs?: number;
}

/**
 * File entry in the "Files Edited" section
 */
export interface RunFileData {
  /** Absolute file path */
  path: string;
  /** File tag for display */
  tag?: "Task" | "Implementation Plan" | "Doc" | "Code" | "Config";
  /** Diff stats */
  diff?: {
    plus: number;
    minus: number;
  };
  /** Call-to-action button */
  cta?: "open" | "open-diff";
}

/**
 * Progress group (collapsible section in Run Card)
 */
export interface RunGroupData {
  /** Group ID */
  id: string;
  /** Group index (for ordering) */
  index: number;
  /** Group title */
  title: string;
  /** Whether group is collapsed */
  collapsed: boolean;
  /** Ordered list of event IDs in this group */
  itemsOrder: string[];
}

// =============================================================================
// Build Mode: Action Data Types
// =============================================================================

/**
 * Action data for build mode activity feed
 * Extends AgentEvent (same structure, used directly)
 */
export type ActionData = AgentEvent;

/**
 * Terminal output data for expanded terminal cards
 */
export interface TerminalData {
  /** Terminal/process ID */
  id: string;
  /** Command that was run */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Full output (may be truncated) */
  output: string;
  /** Exit code (undefined if still running) */
  exitCode?: number;
  /** Whether command is running in background */
  background?: boolean;
  /** Timestamp */
  ts: number;
}

// =============================================================================
// Message Metadata
// =============================================================================

/**
 * Metadata attached to assistant messages for mode selection
 */
export interface ChatMessageMetadata {
  /** UI mode for rendering this message */
  mode: AgentMode;
  /** Run ID for planning mode */
  runId?: string;
  /** Timestamps */
  startedAt?: number;
  firstSignificantUpdateAt?: number;
  finishedAt?: number;
  elapsedMs?: number;
  /** Model info */
  model?: string;
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    totalTokens: number;
  };
}

// =============================================================================
// Extended ChatUIMessage
// =============================================================================

/**
 * Extended UI message with custom data parts for Antigravity UI
 * Uses AI SDK's native extended message format for type-safe custom parts
 */
export type ChatUIMessage = UIMessage<
  never, // No reasoning parts in generic (handled via data-thought)
  {
    // Existing data parts
    "data-rlm-state": RLMStateData;
    "data-progress": ProgressData;
    "data-permission": PermissionRequestData;
    "data-session": SessionData;
    // NEW: Reasoning/thinking
    "data-thought": ThoughtData;
    // NEW: Planning mode parts
    "data-run": RunCardData;
    "data-run-file": RunFileData;
    "data-run-group": RunGroupData;
    "data-run-item": AgentEvent;
    // NEW: Build mode parts
    "data-action": ActionData;
    "data-terminal": TerminalData;
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
 * Normalized message storage for O(1) lookups
 * Used internally by the store for high-performance streaming updates
 */
export interface ChatMessagesState {
  /** Ordered list of message IDs for rendering */
  order: string[];
  /** Messages indexed by ID for O(1) access */
  byId: Record<string, ChatUIMessage>;
}

/**
 * Normalized event storage for O(1) lookups
 * Used for activity feed and run card items
 */
export interface ChatEventsState {
  /** Ordered list of event IDs for rendering */
  order: string[];
  /** Events indexed by ID for O(1) access */
  byId: Record<string, AgentEvent>;
}

/**
 * Active reasoning state for streaming "Thinking..." display
 */
export interface ChatReasoningState {
  /** Active reasoning parts indexed by ID */
  byId: Record<string, ReasoningPart>;
}

/**
 * Chat state for Solid store
 * Represents the complete state of a chat session
 *
 * Uses normalized storage (order + byId) for true O(1) updates.
 * At 50-100 tokens/sec streaming, this prevents the O(N) scan that would
 * occur with a flat array.
 */
export interface ChatState {
  /** Normalized message storage for O(1) lookups */
  messages: ChatMessagesState;
  /** Normalized event storage for O(1) lookups */
  events: ChatEventsState;
  /** Active reasoning parts (cleared on completion) */
  reasoning: ChatReasoningState;
  /** Current connection/streaming status */
  status: ChatStatus;
  /** Current error if any */
  error: Error | null;
  /** Current RLM state (extracted from data parts for easy access) */
  rlmState: RLMStateData | null;
  /** Current session ID */
  sessionId: string | null;
  /** Current message metadata (for mode tracking) */
  currentMetadata: ChatMessageMetadata | null;
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
