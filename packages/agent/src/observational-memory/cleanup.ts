import type { MessageEntry } from "../session/entries.ts";
import type { AgentMessage } from "../types.ts";

/** Minimal token counter interface (decoupled from full OM deps). */
export interface TokenCounterLike {
  countMessages(messages: AgentMessage[]): number;
  countMessage(message: AgentMessage): number;
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

  // Pre-compute per-message token counts once: O(n).
  // All subsequent floor checks use arithmetic instead of re-tokenizing,
  // avoiding the O(candidates × n) blowup that plagued the original.
  const tokensById = new Map<string, number>();
  for (const entry of entries) {
    tokensById.set(entry.id, tokenCounter.countMessage(entry.message));
  }

  // Start from the full token count (includes conversation-level overhead).
  // countMessages = TOKENS_PER_CONVERSATION + Σ countMessage, so subtracting
  // individual countMessage values preserves the exact remaining estimate.
  let remainingTokens = tokenCounter.countMessages(entries.map((e) => e.message));

  const idsToRemove = new Set<string>();
  const removalOrder: string[] = [];

  // Pass 1: queue observed entries for removal, per-message floor check.
  for (const entry of candidates) {
    remainingTokens -= tokensById.get(entry.id)!;
    if (remainingTokens < retentionFloor) {
      // Removing this entry drops below floor — undo and stop.
      remainingTokens += tokensById.get(entry.id)!;
      break;
    }
    idsToRemove.add(entry.id);
    removalOrder.push(entry.id);
  }

  // Pass 2: LIFO restore if aggregate total is still below floor.
  while (remainingTokens < retentionFloor && removalOrder.length > 0) {
    const restoreId = removalOrder.pop()!;
    idsToRemove.delete(restoreId);
    remainingTokens += tokensById.get(restoreId)!;
  }

  return [...idsToRemove];
}
