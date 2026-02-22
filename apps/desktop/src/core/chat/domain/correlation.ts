/**
 * Correlation Key System
 *
 * Provides matching logic for reconciling optimistic data with canonical SSE events.
 *
 * Based on Phase 0 Architecture Contracts:
 * - Message matching by ID, then parent+window+role
 * - Part matching by ID, then message+type+callID/reasoningId
 */

import type { MessageInfo, Part } from "@sakti-code/shared/event-types";

/** Extended message with ID */
export type MessageWithId = MessageInfo & { id: string; sessionID?: string; parentID?: string };

/** Extended part with required fields for matching */
export type PartWithRequired = Part & { id: string; messageID: string };

/** Window in milliseconds for considering optimistic messages as candidates for correlation */
export const CORRELATION_TIME_WINDOW_MS = 30000;

/** Metadata attached to optimistic entities for reconciliation */
export interface OptimisticMetadata {
  /** Marks this entity as optimistically created */
  optimistic: true;
  /** Source of the optimistic write */
  optimisticSource: "useChat" | "userAction";
  /** Key for matching with canonical events */
  correlationKey: string;
  /** Timestamp of creation */
  timestamp: number;
}

/** Extended message type with optimistic metadata */
export type MessageWithOptimisticMetadata = MessageWithId & {
  metadata?: OptimisticMetadata;
};

/** Extended part type with optimistic metadata */
export type PartWithOptimisticMetadata = PartWithRequired & {
  metadata?: OptimisticMetadata;
};

/** Correlation key components for messages */
export interface MessageCorrelationKey {
  type: "message";
  id?: string;
  parentID?: string;
  role: "user" | "assistant" | "system";
  createdAt: number;
}

/** Correlation key components for parts */
export interface PartCorrelationKey {
  type: "part";
  id?: string;
  messageID: string;
  partType: string;
  callID?: string;
  reasoningId?: string;
}

/** Result of a correlation match */
export interface CorrelationMatch<T> {
  /** The matched entity */
  entity: T;
  /** The match confidence level */
  confidence: "exact" | "correlation" | "fuzzy";
  /** The matching strategy used */
  strategy: string;
}

/**
 * Generate a correlation key for an optimistic message
 */
export function generateMessageCorrelationKey(
  message: Omit<MessageCorrelationKey, "type">
): string {
  const components = [
    "msg",
    message.role,
    message.parentID || "no-parent",
    message.createdAt.toString(),
  ];
  return components.join(":");
}

/**
 * Generate a correlation key for an optimistic part
 */
export function generatePartCorrelationKey(part: Omit<PartCorrelationKey, "type">): string {
  const components = [
    "part",
    part.messageID,
    part.partType,
    part.callID || part.reasoningId || "default",
  ];
  return components.join(":");
}

/**
 * Check if a message matches a canonical event by exact ID
 */
export function matchMessageByExactId(
  optimistic: MessageWithOptimisticMetadata,
  canonicalId: string
): boolean {
  return (optimistic as { id?: string }).id === canonicalId;
}

/**
 * Check if a message matches by correlation (parent + window + role)
 */
export function matchMessageByCorrelation(
  optimistic: MessageWithOptimisticMetadata,
  candidate: {
    role: "user" | "assistant" | "system";
    parentID?: string;
    createdAt: number;
  }
): boolean {
  // Must be optimistic to match by correlation
  if (!optimistic.metadata?.optimistic) {
    return false;
  }

  // Role must match
  const optimisticRole = (optimistic as { role?: string }).role;
  if (optimisticRole !== candidate.role) {
    return false;
  }

  // Parent ID must match (both undefined or same value)
  const optimisticParent = (optimistic as { parentID?: string }).parentID;
  if (optimisticParent !== candidate.parentID) {
    return false;
  }

  // Must be within time window
  const age = Math.abs(candidate.createdAt - optimistic.metadata.timestamp);
  if (age > CORRELATION_TIME_WINDOW_MS) {
    return false;
  }

  return true;
}

/**
 * Find the best matching optimistic message for a canonical message
 *
 * Match priority:
 * 1. Exact ID match
 * 2. Correlation match (parent + window + role)
 */
export function findMatchingMessage(
  optimisticMessages: MessageWithOptimisticMetadata[],
  canonical: {
    id: string;
    role: "user" | "assistant" | "system";
    parentID?: string;
    createdAt: number;
  }
): CorrelationMatch<MessageWithOptimisticMetadata> | undefined {
  // Priority 1: Exact ID match
  const exactMatch = optimisticMessages.find(msg => matchMessageByExactId(msg, canonical.id));
  if (exactMatch) {
    return {
      entity: exactMatch,
      confidence: "exact",
      strategy: "exact-id",
    };
  }

  // Priority 2: Correlation match
  const correlationMatch = optimisticMessages.find(msg =>
    matchMessageByCorrelation(msg, {
      role: canonical.role,
      parentID: canonical.parentID,
      createdAt: canonical.createdAt,
    })
  );

  if (correlationMatch) {
    return {
      entity: correlationMatch,
      confidence: "correlation",
      strategy: "parent-window-role",
    };
  }

  return undefined;
}

/**
 * Check if a part matches by exact ID
 */
export function matchPartByExactId(
  optimistic: PartWithOptimisticMetadata,
  canonicalId: string
): boolean {
  return (optimistic as { id?: string }).id === canonicalId;
}

/**
 * Check if a tool part matches by callID
 */
export function matchToolPartByCallId(
  optimistic: PartWithOptimisticMetadata,
  messageID: string,
  callID: string
): boolean {
  if (!optimistic.metadata?.optimistic) {
    return false;
  }

  const optimisticType = (optimistic as { type?: string }).type;
  if (optimisticType !== "tool" && optimisticType !== "tool-call") {
    return false;
  }

  const optimisticMessageID = (optimistic as { messageID?: string }).messageID;
  if (optimisticMessageID !== messageID) {
    return false;
  }

  const optimisticCallId = (optimistic as { callID?: string }).callID;
  return optimisticCallId === callID;
}

/**
 * Check if a text part matches by messageID (for single active text part)
 */
export function matchTextPartByMessage(
  optimistic: PartWithOptimisticMetadata,
  messageID: string
): boolean {
  if (!optimistic.metadata?.optimistic) {
    return false;
  }

  const optimisticType = (optimistic as { type?: string }).type;
  if (optimisticType !== "text") {
    return false;
  }

  const optimisticMessageID = (optimistic as { messageID?: string }).messageID;
  return optimisticMessageID === messageID;
}

/**
 * Check if a reasoning part matches by messageID and reasoningId
 */
export function matchReasoningPart(
  optimistic: PartWithOptimisticMetadata,
  messageID: string,
  reasoningId?: string
): boolean {
  if (!optimistic.metadata?.optimistic) {
    return false;
  }

  const optimisticType = (optimistic as { type?: string }).type;
  if (optimisticType !== "reasoning") {
    return false;
  }

  const optimisticMessageID = (optimistic as { messageID?: string }).messageID;
  if (optimisticMessageID !== messageID) {
    return false;
  }

  if (reasoningId) {
    const optimisticReasoningId = (optimistic as { reasoningId?: string }).reasoningId;
    return optimisticReasoningId === reasoningId;
  }

  return true;
}

/**
 * Find the best matching optimistic part for a canonical part
 *
 * Match priority:
 * 1. Exact ID match
 * 2. Tool parts: messageID + type + callID
 * 3. Text parts: messageID + type
 * 4. Reasoning parts: messageID + type + reasoningId
 */
export function findMatchingPart(
  optimisticParts: PartWithOptimisticMetadata[],
  canonical: {
    id: string;
    type: string;
    messageID: string;
    callID?: string;
    reasoningId?: string;
  }
): CorrelationMatch<PartWithOptimisticMetadata> | undefined {
  // Priority 1: Exact ID match
  const exactMatch = optimisticParts.find(part => matchPartByExactId(part, canonical.id));
  if (exactMatch) {
    return {
      entity: exactMatch,
      confidence: "exact",
      strategy: "exact-id",
    };
  }

  // Priority 2: Tool part matching
  if ((canonical.type === "tool" || canonical.type === "tool-call") && canonical.callID) {
    const toolMatch = optimisticParts.find(part =>
      matchToolPartByCallId(part, canonical.messageID, canonical.callID!)
    );
    if (toolMatch) {
      return {
        entity: toolMatch,
        confidence: "correlation",
        strategy: "message-callid",
      };
    }
  }

  // Priority 3: Text part matching
  if (canonical.type === "text") {
    const textMatch = optimisticParts.find(part =>
      matchTextPartByMessage(part, canonical.messageID)
    );
    if (textMatch) {
      return {
        entity: textMatch,
        confidence: "correlation",
        strategy: "message-type",
      };
    }
  }

  // Priority 4: Reasoning part matching
  if (canonical.type === "reasoning") {
    const reasoningMatch = optimisticParts.find(part =>
      matchReasoningPart(part, canonical.messageID, canonical.reasoningId)
    );
    if (reasoningMatch) {
      return {
        entity: reasoningMatch,
        confidence: "correlation",
        strategy: "message-reasoningid",
      };
    }
  }

  return undefined;
}

/**
 * Create optimistic metadata for a new entity
 */
export function createOptimisticMetadata(
  source: "useChat" | "userAction",
  correlationKey: string
): OptimisticMetadata {
  return {
    optimistic: true,
    optimisticSource: source,
    correlationKey,
    timestamp: Date.now(),
  };
}

/**
 * Check if an entity is optimistic
 */
export function isOptimisticEntity<T extends { metadata?: OptimisticMetadata }>(
  entity: T
): boolean {
  return entity.metadata?.optimistic === true;
}

/**
 * Get the age of an optimistic entity in milliseconds
 */
export function getOptimisticAge<T extends { metadata?: OptimisticMetadata }>(entity: T): number {
  if (!entity.metadata?.optimistic) {
    return Infinity;
  }
  return Date.now() - entity.metadata.timestamp;
}

/**
 * Filter entities that are stale (older than threshold)
 */
export function filterStaleOptimisticEntities<T extends { metadata?: OptimisticMetadata }>(
  entities: T[],
  maxAgeMs: number = CORRELATION_TIME_WINDOW_MS
): T[] {
  return entities.filter(entity => {
    if (!entity.metadata?.optimistic) {
      return false;
    }
    return getOptimisticAge(entity) > maxAgeMs;
  });
}
