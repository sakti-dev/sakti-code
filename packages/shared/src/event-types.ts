/**
 * Shared SSE Event Types
 *
 * This file defines the contract between server and desktop client.
 * Server events are typed with Zod; client uses these TypeScript types.
 * Changes must be synchronized with packages/server/src/bus/index.ts
 */

// ============================================================================
// Simplified Chat Types (to avoid dependency on @sakti-code/core)
// ============================================================================

/**
 * Part - a message part (simplified)
 * In the full schema, this is a discriminated union of many part types.
 * Here we use a loose type since the client doesn't need full validation.
 */
export type Part = Record<string, unknown> & {
  type: string;
  id?: string;
  messageID?: string;
};

/**
 * MessageInfo - message metadata (simplified)
 */
export type MessageInfo =
  | ({ role: "user" } & Record<string, unknown>)
  | ({ role: "assistant" } & Record<string, unknown>)
  | ({ role: "system" } & Record<string, unknown>);

// ============================================================================
// Event Integrity Fields (Batch 2: Data Integrity)
// ============================================================================

/**
 * Event integrity metadata for ordering, deduplication, and tracing
 * All server events must include these fields for data integrity
 */
export interface EventIntegrityFields {
  /** Unique event ID (UUIDv7) for global deduplication */
  eventId: string;
  /** Monotonic sequence number within the session for ordering */
  sequence: number;
  /** Unix timestamp (ms) when event was created */
  timestamp: number;
  /** Session ID this event belongs to */
  sessionID?: string;
}

// ============================================================================
// Server Event Base Type
// ============================================================================

/**
 * Base server event shape
 * Now includes integrity fields for data consistency
 */
export interface ServerEvent<
  T extends string = string,
  P = Record<string, unknown>,
> extends EventIntegrityFields {
  type: T;
  properties: P;
  directory?: string;
}

// ============================================================================
// Event Payload Types
// ============================================================================

// Server events
export interface ServerConnectedPayload {
  directory?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ServerHeartbeatPayload {}

export interface ServerInstanceDisposedPayload {
  directory: string;
}

// Message events
export interface MessageUpdatedPayload {
  info: MessageInfo;
}

export interface MessagePartUpdatedPayload {
  part: Part;
  delta?: string;
}

export interface MessagePartRemovedPayload {
  partID: string;
  messageID: string;
  sessionID: string;
}

// Session events
export interface SessionCreatedPayload {
  sessionID: string;
  directory: string;
}

export interface SessionUpdatedPayload {
  sessionID: string;
  status: "idle" | "running" | "error";
  metadata?: Record<string, unknown>;
}

export interface SessionStatusPayload {
  sessionID: string;
  status:
    | { type: "idle" }
    | { type: "busy" }
    | { type: "retry"; attempt: number; message: string; next: number };
}

// Permission events
export interface PermissionAskedPayload {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  always: string[];
  metadata?: Record<string, unknown>;
  tool?: { messageID: string; callID: string };
}

export interface PermissionRepliedPayload {
  sessionID: string;
  requestID: string;
  reply: "once" | "always" | "reject";
}

// Question events
export interface QuestionAskedPayload {
  id: string;
  sessionID: string;
  questions: unknown[];
  tool?: { messageID: string; callID: string };
}

export interface QuestionRepliedPayload {
  sessionID: string;
  requestID: string;
  reply: unknown;
}

export interface QuestionRejectedPayload {
  sessionID: string;
  requestID: string;
  reason?: string;
}

// Task events
export interface TaskUpdatedPayload {
  sessionId: string;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: number;
  }>;
}

export interface TaskSessionUpdatedPayload {
  taskSessionId: string;
  workspaceId: string | null;
  status: "researching" | "specifying" | "implementing" | "completed" | "failed";
  specType: "comprehensive" | "quick" | null;
  sessionKind: "intake" | "task";
  title: string | null;
  lastActivityAt: string;
  mutation: "created" | "updated" | "deleted";
}

// ============================================================================
// EventMap Type
// ============================================================================

/**
 * Complete EventMap type
 * Maps event type names to their payload shapes
 */
export type EventMap = {
  "server.connected": ServerConnectedPayload;
  "server.heartbeat": ServerHeartbeatPayload;
  "server.instance.disposed": ServerInstanceDisposedPayload;

  "message.updated": MessageUpdatedPayload;
  "message.part.updated": MessagePartUpdatedPayload;
  "message.part.removed": MessagePartRemovedPayload;

  "session.created": SessionCreatedPayload;
  "session.updated": SessionUpdatedPayload;
  "session.status": SessionStatusPayload;

  "permission.asked": PermissionAskedPayload;
  "permission.replied": PermissionRepliedPayload;
  "question.asked": QuestionAskedPayload;
  "question.replied": QuestionRepliedPayload;
  "question.rejected": QuestionRejectedPayload;

  "task.updated": TaskUpdatedPayload;
  "task-session.updated": TaskSessionUpdatedPayload;
};

/**
 * Helper type: Extract event type from EventMap
 */
export type EventType = keyof EventMap;

/**
 * Helper type: Server event with typed payload
 */
export type TypedServerEvent<K extends EventType> = ServerEvent<K, EventMap[K]>;

/**
 * Helper type: All possible server events
 */
export type AllServerEvents = {
  [K in EventType]: TypedServerEvent<K>;
}[EventType];

// Note: Zod schemas for validation are in event-guards.ts
// Import from there to avoid duplication:
// import { EventIntegritySchema, ServerEventSchema, hasIntegrityFields, validateEventIntegrity } from './event-guards';
