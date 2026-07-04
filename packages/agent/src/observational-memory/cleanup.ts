import type { MessageEntry } from "../session/entries.ts";
import type { AgentMessage } from "../types.ts";

/** Minimal token counter interface (decoupled from full OM deps). */
export interface TokenCounterLike {
  countMessages(messages: AgentMessage[]): number;
}

/**
 * Compute the retention floor — the minimum token count that must remain
 * after pruning observed messages.
 *
 * Port of Mastra's `thresholds.ts:89-97`.
 *
 * Two modes:
 * - Ratio mode (0 < bufferActivation ≤ 1): floor = threshold × (1 − ratio)
 * - Absolute mode (bufferActivation ≥ 1000): floor = bufferActivation
 *
 * Default config: bufferActivation = 0.8, threshold = 30_000 → floor = 6_000.
 */
export function resolveRetentionFloor(
  bufferActivation: number,
  messageTokensThreshold: number,
): number {
  if (bufferActivation >= 1000) return bufferActivation;
  const ratio = Math.max(0, Math.min(1, bufferActivation));
  return Math.round(messageTokensThreshold * (1 - ratio));
}

/**
 * Determine which observed entry IDs are safe to remove from context.
 *
 * Port of Mastra's `observational-memory.ts:2240-2314`
 * (`getObservedMessageIdsForCleanup`).
 *
 * Two-pass algorithm:
 * 1. Walk entries, queue observed ones for removal. Per-message check:
 *    if removing this entry would drop remaining tokens below the floor,
 *    stop early.
 * 2. Aggregate LIFO restore: if total remaining tokens are still below
 *    the floor, restore the most-recently-queued removals until the floor
 *    is met.
 *
 * Returns entry IDs safe to remove entirely.
 */
export function getObservedEntryIdsForCleanup(params: {
  entries: MessageEntry[];
  observedEntryIds: string[];
  retentionFloor: number;
  tokenCounter: TokenCounterLike;
}): string[] {
  const { entries, observedEntryIds, retentionFloor, tokenCounter } = params;
  if (observedEntryIds.length === 0) return [];

  const observedSet = new Set(observedEntryIds);

  // Only consider entries that are actually present AND observed.
  const candidates = entries.filter((e) => observedSet.has(e.id));
  if (candidates.length === 0) return [];

  // If floor is 0 (no async buffering), remove all observed unconditionally.
  if (retentionFloor <= 0) {
    return candidates.map((e) => e.id);
  }

  const idsToRemove = new Set<string>();
  const removalOrder: string[] = [];

  const countRemaining = (): number =>
    tokenCounter.countMessages(entries.filter((e) => !idsToRemove.has(e.id)).map((e) => e.message));

  // Pass 1: queue observed entries for removal, per-message floor check.
  for (const entry of candidates) {
    // Simulate removal: check if remaining would be at or above floor.
    idsToRemove.add(entry.id);
    const remaining = countRemaining();
    if (remaining < retentionFloor) {
      // Removing this entry drops below floor — undo and stop.
      idsToRemove.delete(entry.id);
      break;
    }
    removalOrder.push(entry.id);
  }

  // Pass 2: LIFO restore if aggregate total is still below floor.
  // (Handles edge cases where per-message check allowed removals but
  // the aggregate is still too low due to token estimation drift.)
  if (idsToRemove.size > 0) {
    let remainingTokens = countRemaining();
    while (remainingTokens < retentionFloor && removalOrder.length > 0) {
      const restoreId = removalOrder.pop()!;
      idsToRemove.delete(restoreId);
      remainingTokens = countRemaining();
    }
  }

  return [...idsToRemove];
}
