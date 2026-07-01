/**
 * Observational Memory buffering coordinator.
 *
 * Ports the threshold math and interval tracking from Mastra's
 * `buffering-coordinator.ts` and `thresholds.ts`. The coordinator is
 * stateless except for static in-memory maps that track the last buffered
 * boundary per thread, matching Mastra's process-level sharing semantics.
 *
 * Thread scope only — resource scope is deferred per the implementation plan.
 */

import type { ObservationalMemoryRecord } from "../observational-memory-storage.ts";

/**
 * Get the maximum value from a threshold (simple number or range).
 */
export function getMaxThreshold(threshold: number | { min: number; max: number }): number {
  if (typeof threshold === "number") return threshold;
  return threshold.max;
}

/**
 * Resolve bufferTokens config value.
 * Values in (0, 1) are treated as ratios of the message threshold.
 */
export function resolveBufferTokens(
  bufferTokens: number | false | undefined,
  messageTokens: number | { min: number; max: number },
): number | undefined {
  if (bufferTokens === false) return undefined;
  if (bufferTokens === undefined) return undefined;
  if (bufferTokens > 0 && bufferTokens < 1) {
    return Math.round(getMaxThreshold(messageTokens) * bufferTokens);
  }
  return bufferTokens;
}

/**
 * Convert bufferActivation to the equivalent ratio (0-1) for the storage layer.
 * When bufferActivation >= 1000, it's an absolute retention target.
 */
export function resolveActivationRatio(
  bufferActivation: number,
  messageTokensThreshold: number,
): number {
  if (bufferActivation >= 1000) {
    return Math.max(0, Math.min(1, 1 - bufferActivation / messageTokensThreshold));
  }
  return Math.max(0, Math.min(1, bufferActivation));
}

/**
 * Convert bufferActivation to an absolute retention floor (tokens to keep after activation).
 */
export function resolveRetentionFloor(
  bufferActivation: number,
  messageTokensThreshold: number,
): number {
  if (bufferActivation >= 1000) return bufferActivation;
  const ratio = Math.max(0, Math.min(1, bufferActivation));
  return messageTokensThreshold * (1 - ratio);
}

/**
 * Shared in-memory state for async buffering operations.
 *
 * Mastra uses static maps because multiple OM instances are created per
 * agent loop step and they need to share knowledge of in-flight operations.
 * sakti constructs one engine per run, but we keep the same static-map shape
 * so tests and future multi-engine scenarios behave consistently.
 *
 * NOTE on "buffered" semantics: in this port, buffering is **incremental
 * chunking within the awaited turn**, not background execution — the engine
 * awaits `maybeBufferObservation`/`maybeBufferReflection` inline from the
 * turn hook. The `asyncBufferingOps` Promise tracking here is a faithful
 * Mastra port retained for a future background-detach; with serial
 * execution the in-flight guard is effectively always empty at check time.
 * Renaming the storage API (`setBufferingObservationFlag`, etc.) is out of
 * scope because it would churn the DB adapter.
 */
export class BufferingCoordinator {
  /**
   * Track in-flight async buffering operations per thread.
   * Key format: "obs:{threadId}" or "refl:{threadId}".
   */
  static asyncBufferingOps = new Map<string, Promise<void>>();

  /**
   * Track the last token boundary at which we started buffering.
   * Key format: "obs:{threadId}" or "refl:{threadId}".
   */
  static lastBufferedBoundary = new Map<string, number>();

  /**
   * Track the timestamp cursor for buffered messages.
   * Key format: "obs:{threadId}".
   */
  static lastBufferedAtTime = new Map<string, Date>();

  /**
   * Tracks cycleId for in-flight buffered reflections.
   * Key format: "refl:{threadId}".
   */
  static reflectionBufferCycleIds = new Map<string, string>();

  private readonly observationBufferTokensInternal: number | undefined;
  private readonly reflectionBufferActivation: number;
  private readonly threadId: string;

  constructor(opts: {
    threadId: string;
    observationBufferTokens?: number | undefined;
    observationBufferActivation?: number | undefined;
    reflectionBufferActivation: number;
  }) {
    this.threadId = opts.threadId;
    this.observationBufferTokensInternal = opts.observationBufferTokens;
    this.reflectionBufferActivation = opts.reflectionBufferActivation;
  }

  get observationBufferKey(): string {
    return `obs:${this.threadId}`;
  }

  get reflectionBufferKey(): string {
    return `refl:${this.threadId}`;
  }

  get observationBufferTokens(): number | undefined {
    return this.observationBufferTokensInternal;
  }

  isAsyncObservationEnabled(): boolean {
    return (
      this.observationBufferTokensInternal !== undefined && this.observationBufferTokensInternal > 0
    );
  }

  isAsyncReflectionEnabled(): boolean {
    return this.reflectionBufferActivation > 0;
  }

  isAsyncBufferingInProgress(bufferKey: string): boolean {
    return BufferingCoordinator.asyncBufferingOps.has(bufferKey);
  }

  /**
   * Check if we've crossed a new bufferTokens interval boundary for async observation.
   */
  shouldTriggerAsyncObservation(
    currentTokens: number,
    record: ObservationalMemoryRecord,
    messageTokensThreshold: number,
  ): boolean {
    if (!this.isAsyncObservationEnabled()) return false;

    if (record.isBufferingObservation) return false;

    const bufferKey = this.observationBufferKey;
    if (this.isAsyncBufferingInProgress(bufferKey)) return false;

    const bufferTokens = this.observationBufferTokens!;
    const dbBoundary = record.lastBufferedAtTokens ?? 0;
    const memBoundary = BufferingCoordinator.lastBufferedBoundary.get(bufferKey) ?? 0;
    const lastBoundary = Math.max(dbBoundary, memBoundary);

    const rampPoint = messageTokensThreshold - bufferTokens * 1.1;
    const effectiveBufferTokens = currentTokens >= rampPoint ? bufferTokens / 2 : bufferTokens;

    const currentInterval = Math.floor(currentTokens / effectiveBufferTokens);
    const lastInterval = Math.floor(lastBoundary / effectiveBufferTokens);

    return currentInterval > lastInterval;
  }

  /**
   * Check if reflection buffering should trigger.
   */
  shouldTriggerAsyncReflection(
    observationTokens: number,
    record: ObservationalMemoryRecord,
    reflectionThreshold: number,
  ): boolean {
    if (!this.isAsyncReflectionEnabled()) return false;
    if (record.isBufferingReflection) return false;

    const bufferKey = this.reflectionBufferKey;
    if (this.isAsyncBufferingInProgress(bufferKey)) return false;
    if (BufferingCoordinator.lastBufferedBoundary.has(bufferKey)) return false;
    if (record.bufferedReflection) return false;

    const activationPoint = reflectionThreshold * this.reflectionBufferActivation;
    return observationTokens >= activationPoint && observationTokens < reflectionThreshold;
  }

  /**
   * Record that a buffering operation has started.
   */
  registerOp(boundaryTokens: number, kind: "observation" | "reflection", cycleId?: string): void {
    const bufferKey = kind === "observation" ? this.observationBufferKey : this.reflectionBufferKey;
    BufferingCoordinator.lastBufferedBoundary.set(bufferKey, boundaryTokens);
    if (cycleId && kind === "reflection") {
      BufferingCoordinator.reflectionBufferCycleIds.set(bufferKey, cycleId);
    }
  }

  /**
   * Record that a buffering operation has completed.
   */
  unregisterOp(kind: "observation" | "reflection"): void {
    const bufferKey = kind === "observation" ? this.observationBufferKey : this.reflectionBufferKey;
    BufferingCoordinator.asyncBufferingOps.delete(bufferKey);
  }

  /**
   * Set the in-flight promise for a buffering operation.
   */
  setAsyncOp(kind: "observation" | "reflection", promise: Promise<void>): void {
    const bufferKey = kind === "observation" ? this.observationBufferKey : this.reflectionBufferKey;
    BufferingCoordinator.asyncBufferingOps.set(bufferKey, promise);
  }

  /**
   * Update the timestamp cursor for buffered observation messages.
   */
  setLastBufferedAtTime(cursor: Date): void {
    BufferingCoordinator.lastBufferedAtTime.set(this.observationBufferKey, cursor);
  }

  /**
   * Get the timestamp cursor for buffered observation messages.
   */
  getLastBufferedAtTime(): Date | undefined {
    return BufferingCoordinator.lastBufferedAtTime.get(this.observationBufferKey);
  }

  /**
   * Clear the last buffered boundary for a kind.
   */
  clearBoundary(kind: "observation" | "reflection"): void {
    const bufferKey = kind === "observation" ? this.observationBufferKey : this.reflectionBufferKey;
    BufferingCoordinator.lastBufferedBoundary.delete(bufferKey);
  }

  /**
   * Clean up static maps for a thread to prevent memory leaks.
   */
  cleanupStaticMaps(activatedMessageIds?: string[]): void {
    const obsKey = this.observationBufferKey;
    const reflKey = this.reflectionBufferKey;

    if (activatedMessageIds) {
      BufferingCoordinator.lastBufferedBoundary.delete(obsKey);
      BufferingCoordinator.lastBufferedAtTime.delete(obsKey);
    } else {
      BufferingCoordinator.lastBufferedAtTime.delete(obsKey);
      BufferingCoordinator.lastBufferedBoundary.delete(obsKey);
      BufferingCoordinator.lastBufferedBoundary.delete(reflKey);
      BufferingCoordinator.asyncBufferingOps.delete(obsKey);
      BufferingCoordinator.asyncBufferingOps.delete(reflKey);
      BufferingCoordinator.reflectionBufferCycleIds.delete(reflKey);
    }
  }
}
