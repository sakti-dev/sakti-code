/**
 * Event Bus System
 *
 * Opencode-style event bus for publish-subscribe messaging.
 * Supports typed events, wildcard subscriptions, and global emission.
 * Updated for Batch 2: Data Integrity - includes event IDs and sequence numbers
 */

import { MessageInfo as ChatMessageInfo, Part as ChatPart } from "@sakti-code/core/chat";
import { Instance } from "@sakti-code/core/server";
import { registerCoreBusBindings } from "@sakti-code/shared/core-server-bridge";
import { createLogger } from "@sakti-code/shared/logger";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { removePart, upsertMessage, upsertPart } from "../state/session-message-store";
import { defineBusEvent, type BusEventDefinition } from "./bus-event";

const logger = createLogger("bus");

/**
 * Event payload with integrity fields (Batch 2: Data Integrity)
 */
interface EventPayload {
  type: string;
  properties: unknown;
  directory?: string;
  eventId: string;
  sequence: number;
  timestamp: number;
  sessionID?: string;
}

type Subscription = (event: EventPayload) => void | Promise<void>;

/**
 * Per-session sequence number tracking
 */
const sessionSequences = new Map<string, number>();

/**
 * Get next sequence number for a session
 */
function getNextSequence(sessionID?: string): number {
  if (!sessionID) return 0;
  const current = sessionSequences.get(sessionID) || 0;
  const next = current + 1;
  sessionSequences.set(sessionID, next);
  return next;
}

/**
 * Reset sequence counter for a session (useful for testing)
 */
export function resetSessionSequence(sessionID: string): void {
  sessionSequences.delete(sessionID);
}

/**
 * Get current sequence number for a session (for testing)
 */
export function getSessionSequence(sessionID: string): number {
  return sessionSequences.get(sessionID) || 0;
}

function resolveDirectory(properties: unknown): string | undefined {
  if (properties && typeof properties === "object") {
    const withDirectory = properties as { directory?: unknown };
    if (typeof withDirectory.directory === "string" && withDirectory.directory.length > 0) {
      return withDirectory.directory;
    }
  }

  if (Instance.inContext) {
    try {
      return Instance.directory;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function extractSessionID(properties: unknown): string | undefined {
  if (!properties || typeof properties !== "object") return undefined;
  const record = properties as Record<string, unknown>;

  if (typeof record.sessionID === "string" && record.sessionID.length > 0) {
    return record.sessionID;
  }

  const info = record.info;
  if (info && typeof info === "object") {
    const infoSession = (info as { sessionID?: unknown }).sessionID;
    if (typeof infoSession === "string" && infoSession.length > 0) {
      return infoSession;
    }
  }

  const part = record.part;
  if (part && typeof part === "object") {
    const partSession = (part as { sessionID?: unknown }).sessionID;
    if (typeof partSession === "string" && partSession.length > 0) {
      return partSession;
    }
  }

  return undefined;
}

/**
 * Core event definitions
 */
export const ServerConnected = defineBusEvent("server.connected", z.object({}));
export const ServerHeartbeat = defineBusEvent("server.heartbeat", z.object({}));
export const ServerInstanceDisposed = defineBusEvent(
  "server.instance.disposed",
  z.object({
    directory: z.string(),
  })
);

export const MessageUpdated = defineBusEvent(
  "message.updated",
  z.object({
    info: ChatMessageInfo,
  })
);

export const MessagePartUpdated = defineBusEvent(
  "message.part.updated",
  z.object({
    part: ChatPart,
    delta: z.string().optional(),
  })
);

export const MessagePartRemoved = defineBusEvent(
  "message.part.removed",
  z.object({
    partID: z.string(),
    messageID: z.string(),
    sessionID: z.string(),
  })
);

export const SessionCreated = defineBusEvent(
  "session.created",
  z.object({
    sessionID: z.string(),
    directory: z.string(),
  })
);

export const SessionUpdated = defineBusEvent(
  "session.updated",
  z.object({
    sessionID: z.string(),
    status: z.enum(["idle", "running", "error"]),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
);

export const SessionStatus = defineBusEvent(
  "session.status",
  z.object({
    sessionID: z.string(),
    status: z.union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("busy"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
    ]),
  })
);

export const TaskUpdated = defineBusEvent(
  "task.updated",
  z.object({
    sessionId: z.string(),
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.number(),
      })
    ),
  })
);

export const TaskSessionUpdated = defineBusEvent(
  "task-session.updated",
  z.object({
    taskSessionId: z.string(),
    workspaceId: z.string().nullable(),
    status: z.enum(["researching", "specifying", "implementing", "completed", "failed"]),
    specType: z.enum(["comprehensive", "quick"]).nullable(),
    sessionKind: z.enum(["intake", "task"]),
    title: z.string().nullable(),
    lastActivityAt: z.string(),
    mutation: z.enum(["created", "updated", "deleted"]),
  })
);

export const PermissionAsked = defineBusEvent(
  "permission.asked",
  z.object({
    id: z.string(),
    sessionID: z.string(),
    permission: z.string(),
    patterns: z.string().array(),
    always: z.string().array(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    tool: z
      .object({
        messageID: z.string(),
        callID: z.string(),
      })
      .optional(),
  })
);

export const PermissionReplied = defineBusEvent(
  "permission.replied",
  z.object({
    sessionID: z.string(),
    requestID: z.string(),
    reply: z.enum(["once", "always", "reject"]),
  })
);

export const QuestionAsked = defineBusEvent(
  "question.asked",
  z.object({
    id: z.string(),
    sessionID: z.string(),
    questions: z.array(z.unknown()),
    tool: z
      .object({
        messageID: z.string(),
        callID: z.string(),
      })
      .optional(),
  })
);

export const QuestionReplied = defineBusEvent(
  "question.replied",
  z.object({
    sessionID: z.string(),
    requestID: z.string(),
    reply: z.unknown().refine(value => value !== undefined, "reply is required"),
  })
);

export const QuestionRejected = defineBusEvent(
  "question.rejected",
  z.object({
    sessionID: z.string(),
    requestID: z.string(),
    reason: z.string().optional(),
  })
);

registerCoreBusBindings({
  publishTaskUpdated: async (sessionId, tasks) => {
    await publish(TaskUpdated, {
      sessionId,
      tasks,
    });
  },
});

/**
 * In-memory subscription state
 * In production, this could be backed by Redis or similar
 */
const subscriptions = new Map<string, Subscription[]>();

/**
 * Publish an event to all subscribers
 * @param def - Event definition (from defineBusEvent)
 * @param properties - Event properties (must match Zod schema)
 */
export async function publish<Definition extends BusEventDefinition>(
  def: Definition,
  properties: z.infer<Definition["properties"]>
): Promise<void> {
  if (def.type === "message.updated") {
    const info = (properties as { info?: ChatMessageInfo }).info;
    if (info) {
      upsertMessage(info);
    }
  } else if (def.type === "message.part.updated") {
    const part = (properties as { part?: ChatPart }).part;
    if (part) {
      upsertPart(part);
    }
  } else if (def.type === "message.part.removed") {
    const payload = properties as { sessionID?: string; messageID?: string; partID?: string };
    if (payload.sessionID && payload.messageID && payload.partID) {
      removePart({
        sessionID: payload.sessionID,
        messageID: payload.messageID,
        partID: payload.partID,
      });
    }
  }

  const directory = resolveDirectory(properties);

  // Extract sessionID from properties if available
  const sessionID = extractSessionID(properties);

  // Generate integrity fields (Batch 2: Data Integrity)
  const eventId = uuidv7();
  const sequence = getNextSequence(sessionID);
  const timestamp = Date.now();

  const payload: EventPayload = {
    type: def.type,
    properties,
    directory,
    eventId,
    sequence,
    timestamp,
    sessionID,
  };

  logger.info("publishing", { type: def.type, eventId, sequence, sessionID });
  if (process.env.SAKTI_CODE_LOG_BUS_EVENT_PAYLOADS === "true") {
    logger.debug("publishing payload", {
      type: def.type,
      eventId,
      sequence,
      sessionID,
      directory,
      properties,
    });
  }

  const pending: Array<void | Promise<void>> = [];

  // Subscribe to both specific type and wildcard
  for (const key of [def.type, "*"]) {
    const match = subscriptions.get(key);
    if (match) {
      for (const sub of match) {
        pending.push(sub(payload));
      }
    }
  }

  // Emit to global bus (for cross-process communication if needed)
  GlobalBus.emit("event", payload as unknown as Record<string, unknown>);

  await Promise.all(pending);
}

/**
 * Subscribe to a specific event type
 * @param def - Event definition to subscribe to
 * @param callback - Callback function that receives event
 * @returns Unsubscribe function
 */
export function subscribe<Definition extends BusEventDefinition>(
  def: Definition,
  callback: (event: {
    type: Definition["type"];
    properties: z.infer<Definition["properties"]>;
  }) => void | Promise<void>
): () => void {
  return raw(def.type, callback as (event: EventPayload) => void | Promise<void>);
}

/**
 * Subscribe to a specific event type once
 * @param def - Event definition to subscribe to
 * @param callback - Callback function, return "done" to unsubscribe
 * @returns Unsubscribe function
 */
export function once<Definition extends BusEventDefinition>(
  def: Definition,
  callback: (event: {
    type: Definition["type"];
    properties: z.infer<Definition["properties"]>;
  }) => "done" | undefined | Promise<"done" | undefined>
): () => void {
  const unsubscribeRef: { current: () => void } = { current: () => {} };
  unsubscribeRef.current = raw(def.type, async event => {
    const result = await callback(
      event as {
        type: Definition["type"];
        properties: z.infer<Definition["properties"]>;
      }
    );
    if (result === "done") {
      unsubscribeRef.current();
    }
  });
  return unsubscribeRef.current;
}

/**
 * Subscribe to all events
 * @param callback - Callback function that receives all events
 * @returns Unsubscribe function
 */
export function subscribeAll(callback: (event: EventPayload) => void | Promise<void>): () => void {
  return raw("*", callback);
}

/**
 * Raw subscription helper
 * @param type - Event type or "*" for wildcard
 * @param callback - Callback function
 * @returns Unsubscribe function
 */
function raw(type: string, callback: (event: EventPayload) => void | Promise<void>): () => void {
  logger.info("subscribing", { type });

  let match = subscriptions.get(type) ?? [];
  match.push(callback);
  subscriptions.set(type, match);

  return () => {
    logger.info("unsubscribing", { type });
    const match = subscriptions.get(type);
    if (!match) return;

    const index = match.indexOf(callback);
    if (index === -1) return;

    match.splice(index, 1);

    // Clean up empty subscription arrays
    if (match.length === 0) {
      subscriptions.delete(type);
    }
  };
}

/**
 * Clear all subscriptions (useful for testing)
 */
export function clearAll(): void {
  subscriptions.clear();
}

/**
 * Get subscription count for debugging
 */
export function getSubscriptionCount(): number {
  let total = 0;
  for (const subs of subscriptions.values()) {
    total += subs.length;
  }
  return total;
}

/**
 * Global bus for cross-instance communication
 * Uses EventEmitter pattern for extensibility
 */
export const GlobalBus = {
  listeners: new Map<string, Array<(data: Record<string, unknown>) => void>>(),

  on(event: string, callback: (data: Record<string, unknown>) => void): () => void {
    let listeners = this.listeners.get(event) ?? [];
    listeners.push(callback);
    this.listeners.set(event, listeners);

    return () => {
      const listeners = this.listeners.get(event);
      if (!listeners) return;

      const index = listeners.indexOf(callback);
      if (index === -1) return;

      listeners.splice(index, 1);

      if (listeners.length === 0) {
        this.listeners.delete(event);
      }
    };
  },

  emit(event: string, data: Record<string, unknown>): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (error) {
          logger.error("GlobalBus listener error", error as Error, { event });
        }
      }
    }
  },
};

// Re-export types
export type { BusEventDefinition };
