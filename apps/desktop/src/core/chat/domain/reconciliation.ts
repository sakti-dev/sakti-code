/**
 * Reconciliation Service
 *
 * Pure functions for reconciling optimistic entities with canonical SSE events.
 *
 * This module implements the reconciliation logic for Phase 3: Streaming Reconciliation Hardening.
 * It provides functions to:
 * - Match optimistic entities with canonical versions using various strategies
 * - Generate reconciliation results with entities to upsert and remove
 * - Find orphaned/stale optimistic entities for cleanup
 */

import type { MessageWithId } from "@/state/stores/message-store";
import type { Part } from "@ekacode/shared/event-types";
import {
  CORRELATION_TIME_WINDOW_MS,
  filterStaleOptimisticEntities,
  findMatchingMessage,
  findMatchingPart,
  type MessageWithOptimisticMetadata,
  type OptimisticMetadata,
  type PartWithOptimisticMetadata,
} from "./correlation";

/**
 * Result of reconciling optimistic entities with canonical entities
 */
export interface ReconciliationResult<T> {
  /** Entities to add/update (canonical, not matched or new) */
  toUpsert: T[];
  /** Optimistic entity IDs to remove (matched and replaced) */
  toRemove: string[];
  /** Statistics for diagnostics */
  stats: {
    totalCanonical: number;
    totalOptimistic: number;
    matched: number;
    unmatched: number;
    stale: number;
    /** Breakdown by matching strategy */
    strategy: Record<string, number>;
  };
}

/** Internal type for entities with metadata */
type EntityWithMetadata = { id: string; metadata?: unknown };

/**
 * Helper to check if an entity has optimistic metadata
 */
function hasOptimisticMetadata(
  entity: EntityWithMetadata
): entity is EntityWithMetadata & { metadata: OptimisticMetadata } {
  const metadata = entity.metadata as OptimisticMetadata | undefined;
  return metadata?.optimistic === true;
}

/**
 * Reconcile canonical parts with optimistic parts
 *
 * Matching priority:
 * 1. Exact ID match
 * 2. Tool parts: messageID + type + callID
 * 3. Text parts: messageID + type
 * 4. Reasoning parts: messageID + type + reasoningId
 *
 * @param canonicalParts - Parts received from SSE (authoritative)
 * @param optimisticParts - Parts created optimistically during streaming
 * @returns Reconciliation result with parts to upsert and IDs to remove
 */
export function reconcileParts(
  canonicalParts: Part[],
  optimisticParts: Part[]
): ReconciliationResult<Part> {
  const toRemove: string[] = [];
  const toUpsert: Part[] = [];
  const matchedOptimisticIds = new Set<string>();
  const strategyCounts: Record<string, number> = {};

  // Cast for internal processing
  const optimisticWithMetadata = optimisticParts as PartWithOptimisticMetadata[];

  // Identify stale optimistic entities
  const staleOptimistic = filterStaleOptimisticEntities(
    optimisticWithMetadata.filter(p => hasOptimisticMetadata(p as EntityWithMetadata)),
    CORRELATION_TIME_WINDOW_MS
  );
  const staleIds = new Set(staleOptimistic.map(p => p.id));

  // For each canonical part, find matching optimistic part
  for (const canonical of canonicalParts) {
    const canonicalWithId = canonical as {
      id: string;
      type: string;
      messageID: string;
      callID?: string;
      reasoningId?: string;
    };

    // Find matching optimistic part
    const match = findMatchingPart(
      optimisticWithMetadata.filter(p => hasOptimisticMetadata(p as EntityWithMetadata)),
      {
        id: canonicalWithId.id,
        type: canonicalWithId.type,
        messageID: canonicalWithId.messageID,
        callID: canonicalWithId.callID,
        reasoningId: canonicalWithId.reasoningId,
      }
    );

    if (match) {
      // Mark optimistic for removal
      const matchedId = (match.entity as { id: string }).id;
      if (!matchedOptimisticIds.has(matchedId)) {
        toRemove.push(matchedId);
        matchedOptimisticIds.add(matchedId);

        // Track strategy
        strategyCounts[match.strategy] = (strategyCounts[match.strategy] || 0) + 1;
      }
    }

    // Always upsert canonical part (without optimistic metadata)
    toUpsert.push(clearOptimisticMetadataFromPart(canonical));
  }

  // Count unmatched optimistic (not matched but not stale)
  const unmatchedCount = optimisticParts.filter(p => {
    const id = (p as { id: string }).id;
    return (
      hasOptimisticMetadata(p as EntityWithMetadata) &&
      !matchedOptimisticIds.has(id) &&
      !staleIds.has(id)
    );
  }).length;

  return {
    toUpsert,
    toRemove,
    stats: {
      totalCanonical: canonicalParts.length,
      totalOptimistic: optimisticParts.length,
      matched: matchedOptimisticIds.size,
      unmatched: unmatchedCount,
      stale: staleIds.size,
      strategy: strategyCounts,
    },
  };
}

/**
 * Reconcile canonical messages with optimistic messages
 *
 * Matching priority:
 * 1. Exact ID match
 * 2. Correlation match (parent + window + role)
 *
 * @param canonicalMessages - Messages received from SSE (authoritative)
 * @param optimisticMessages - Messages created optimistically
 * @returns Reconciliation result with messages to upsert and IDs to remove
 */
export function reconcileMessages(
  canonicalMessages: MessageWithId[],
  optimisticMessages: MessageWithId[]
): ReconciliationResult<MessageWithId> {
  const toRemove: string[] = [];
  const toUpsert: MessageWithId[] = [];
  const matchedOptimisticIds = new Set<string>();
  const strategyCounts: Record<string, number> = {};

  // Cast for internal processing
  const optimisticWithMetadata = optimisticMessages as unknown as MessageWithOptimisticMetadata[];

  // Identify stale optimistic entities
  const staleOptimistic = filterStaleOptimisticEntities(
    optimisticWithMetadata.filter(m => hasOptimisticMetadata(m as EntityWithMetadata)),
    CORRELATION_TIME_WINDOW_MS
  );
  const staleIds = new Set(staleOptimistic.map(m => m.id));

  // For each canonical message, find matching optimistic message
  for (const canonical of canonicalMessages) {
    const canonicalInfo = canonical as {
      id: string;
      role: string;
      parentID?: string;
      time?: { created?: number };
    };

    // Find matching optimistic message
    const match = findMatchingMessage(
      optimisticWithMetadata.filter(m => hasOptimisticMetadata(m as EntityWithMetadata)),
      {
        id: canonicalInfo.id,
        role: canonicalInfo.role as "user" | "assistant" | "system",
        parentID: canonicalInfo.parentID,
        createdAt: canonicalInfo.time?.created ?? Date.now(),
      }
    );

    if (match) {
      // Mark optimistic for removal
      const matchedId = match.entity.id;
      if (!matchedOptimisticIds.has(matchedId)) {
        toRemove.push(matchedId);
        matchedOptimisticIds.add(matchedId);

        // Track strategy
        strategyCounts[match.strategy] = (strategyCounts[match.strategy] || 0) + 1;
      }
    }

    // Always upsert canonical message (without optimistic metadata)
    toUpsert.push(clearOptimisticMetadataFromMessage(canonical));
  }

  // Count unmatched optimistic (not matched but not stale)
  const unmatchedCount = optimisticMessages.filter(m => {
    return (
      hasOptimisticMetadata(m as EntityWithMetadata) &&
      !matchedOptimisticIds.has(m.id) &&
      !staleIds.has(m.id)
    );
  }).length;

  return {
    toUpsert,
    toRemove,
    stats: {
      totalCanonical: canonicalMessages.length,
      totalOptimistic: optimisticMessages.length,
      matched: matchedOptimisticIds.size,
      unmatched: unmatchedCount,
      stale: staleIds.size,
      strategy: strategyCounts,
    },
  };
}

/**
 * Find optimistic entities to clean up after stream completion
 *
 * Entities are considered orphaned if:
 * 1. They have optimistic metadata
 * 2. They are older than the specified threshold
 *
 * @param entities - Array of entities with optional metadata
 * @param maxAgeMs - Maximum age in milliseconds before entity is considered orphaned
 * @returns Array of entity IDs that should be cleaned up
 */
export function findOrphanedOptimisticEntities(
  entities: Array<{ id: string; metadata?: unknown }>,
  maxAgeMs: number = CORRELATION_TIME_WINDOW_MS
): string[] {
  const orphaned: string[] = [];
  const now = Date.now();

  for (const entity of entities) {
    const metadata = entity.metadata as OptimisticMetadata | undefined;

    // Must be optimistic
    if (!metadata?.optimistic) {
      continue;
    }

    // Check age
    const age = now - metadata.timestamp;
    if (age > maxAgeMs) {
      orphaned.push(entity.id);
    }
  }

  return orphaned;
}

/**
 * Clear optimistic metadata from a part (for canonical replacement)
 */
function clearOptimisticMetadataFromPart(part: Part): Part {
  const metadata = (part as { metadata?: OptimisticMetadata }).metadata;

  // Only clear if it's optimistic metadata
  if (!metadata?.optimistic) {
    return part;
  }

  // Return copy without metadata
  const { metadata: _, ...rest } = part as Part & { metadata?: OptimisticMetadata };
  return rest as Part;
}

/**
 * Clear optimistic metadata from a message (for canonical replacement)
 */
function clearOptimisticMetadataFromMessage(message: MessageWithId): MessageWithId {
  const metadata = (message as { metadata?: OptimisticMetadata }).metadata;

  // Only clear if it's optimistic metadata
  if (!metadata?.optimistic) {
    return message;
  }

  // Return copy without metadata
  const { metadata: _, ...rest } = message as MessageWithId & { metadata?: OptimisticMetadata };
  return rest as MessageWithId;
}

/**
 * Clear optimistic metadata from an entity (for canonical replacement)
 *
 * When a canonical entity replaces an optimistic one, we remove the
 * optimistic metadata to mark it as authoritative.
 *
 * @param entity - Entity with potential optimistic metadata
 * @returns Entity with optimistic metadata removed (shallow copy if modified)
 */
export function clearOptimisticMetadata<T extends { metadata?: unknown }>(entity: T): T {
  const metadata = entity.metadata as OptimisticMetadata | undefined;

  // Only clear if it's optimistic metadata
  if (!metadata?.optimistic) {
    return entity;
  }

  // Return copy without metadata
  const { metadata: _, ...rest } = entity as T & { metadata?: OptimisticMetadata };
  return rest as T;
}
