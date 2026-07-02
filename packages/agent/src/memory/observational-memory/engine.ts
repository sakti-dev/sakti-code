/**
 * Observational Memory sync engine.
 *
 * Ports the sync slice of Mastra's observational-memory state machine:
 * get-or-create record, load un-observed messages, maybe-observe, maybe-reflect,
 * and build the <observations> system-message suffix.
 *
 * Phase D adds async buffering: buffered observations and buffered reflection
 * are layered on top of the sync path. When buffering is configured, the engine
 * buffers observations/reflections in the background and activates them when
 * the corresponding threshold is reached.
 *
 * OM failures are best-effort: logged and swallowed so they never abort a run.
 */

import { Effect } from "effect";
import type { AgentMessage, OmAgentEvent } from "../../types.ts";
import { buildSessionContextFromEntries } from "../../session/session.ts";
import type { MessageEntry, ObservationPruneEntry } from "../../session/entries.ts";
import type {
  BufferedObservationChunkInput,
  ObservationalMemoryRecord,
  ObservationalMemoryStorage,
} from "../../observational-memory-storage.ts";
import type { SessionStorageShape } from "../../session/storage.ts";
import type { ObservationalMemoryDeps } from "./config.ts";
import { getObservedEntryIdsForCleanup, resolveRetentionFloor } from "./cleanup.ts";
import { formatObservationsForContext } from "./prompts.ts";
import { runObserver } from "./observer.ts";
import { runReflector } from "./reflector.ts";
import {
  BufferingCoordinator,
  resolveActivationRatio,
  resolveBufferTokens,
} from "./buffering-coordinator.ts";

export interface ObservationalMemoryEngineOptions {
  readonly deps: ObservationalMemoryDeps;
  /** Run-level abort signal (user-cancel channel). Threaded to observer/reflector. */
  readonly abortSignal?: AbortSignal;
  /** OM lifecycle callback — forwarded to the WS bridge by agent-run.ts. */
  readonly onOmEvent?: (event: OmAgentEvent) => void;
}

export class ObservationalMemoryEngine {
  private readonly deps: ObservationalMemoryDeps;
  private readonly storage: ObservationalMemoryStorage;
  private readonly sessionStorage: SessionStorageShape;
  private readonly sessionId: string;
  private readonly projectId: string;
  private readonly tokenCounter: ObservationalMemoryDeps["tokenCounter"];
  private readonly logger: ObservationalMemoryDeps["logger"];
  private readonly bufferingCoordinator: BufferingCoordinator;
  private readonly abortSignal: AbortSignal | undefined;
  private readonly onOmEvent: ((event: OmAgentEvent) => void) | undefined;

  constructor(options: ObservationalMemoryEngineOptions) {
    this.deps = options.deps;
    this.storage = options.deps.storage;
    this.sessionStorage = options.deps.sessionStorage;
    this.sessionId = options.deps.sessionId;
    this.projectId = options.deps.projectId;
    this.tokenCounter = options.deps.tokenCounter;
    this.logger = options.deps.logger;
    this.abortSignal = options.abortSignal;
    this.onOmEvent = options.onOmEvent;
    this.bufferingCoordinator = new BufferingCoordinator({
      lookupKey: this.computeLookupKey(),
      observationBufferTokens: resolveBufferTokens(
        options.deps.buffering?.observationBufferTokens,
        options.deps.thresholds.observation,
      ),
      reflectionBufferActivation: options.deps.buffering?.reflectionBufferActivation ?? 0,
    });
  }

  /**
   * Resolve the storage ids for the active scope. Mirrors Mastra's
   * `getStorageIds`: under `resource` scope the record is keyed by
   * `resource:{projectId}` with threadId=null (one record per project,
   * shared across sessions); under `thread` scope it is keyed by
   * `thread:{sessionId}`.
   */
  private getStorageIds(): { threadId: string | null; resourceId: string } {
    return this.deps.scope === "resource"
      ? { threadId: null, resourceId: this.projectId }
      : { threadId: this.sessionId, resourceId: this.projectId };
  }

  /** The lookup-key string used for storage and buffer-coordinator namespacing. */
  private computeLookupKey(): string {
    return this.deps.scope === "resource"
      ? `resource:${this.projectId}`
      : `thread:${this.sessionId}`;
  }

  /** Current record, creating an initial one if absent. */
  async getOrCreateRecord(): Promise<ObservationalMemoryRecord> {
    const ids = this.getStorageIds();
    const existing = await this.storage.getObservationalMemory(ids.threadId, ids.resourceId);
    if (existing) return existing;

    return this.storage.initializeObservationalMemory({
      threadId: ids.threadId,
      resourceId: ids.resourceId,
      scope: this.deps.scope,
      config: {},
    });
  }

  /**
   * Load message-kind entries since record.lastObservedAt as AgentMessage[].
   *
   * The leaf is resolved fresh on every call via `sessionStorage.getLeafId()`
   * (NOT a value captured at run start) — otherwise messages appended during
   * the current run would be invisible to observe/reflect.
   *
   * Filters to `type === "message"` and `createdAt > lastObservedAt`, then
   * converts via buildSessionContextFromEntries.
   */
  async loadUnobservedMessages(record: ObservationalMemoryRecord): Promise<AgentMessage[]> {
    const entries = await this.loadUnobservedMessageEntries(record);
    return buildSessionContextFromEntries(entries).messages;
  }

  /**
   * Same filter as {@link loadUnobservedMessages} but returns the raw message
   * entries (with their ids) so observe can populate `observedMessageIds`.
   */
  private async loadUnobservedMessageEntries(
    record: ObservationalMemoryRecord,
  ): Promise<MessageEntry[]> {
    const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
    const pathEntries = await Effect.runPromise(this.sessionStorage.getPathToRoot(leafId));
    const messageEntries = pathEntries.filter(
      (entry): entry is MessageEntry => entry.type === "message",
    );
    if (record.lastObservedAt === undefined) return messageEntries;
    const lastObservedAt = record.lastObservedAt;
    return messageEntries.filter((entry) => {
      const ts = entry.message.timestamp ? new Date(entry.message.timestamp) : undefined;
      return ts !== undefined && ts > lastObservedAt;
    });
  }

  /**
   * Run the Observer if pending message tokens exceed the observation threshold.
   * When buffering is enabled, this also handles buffer-then-activate behavior.
   * Returns the updated record (or the original if no observe happened).
   */
  async maybeObserve(record: ObservationalMemoryRecord): Promise<ObservationalMemoryRecord> {
    const entries = await this.loadUnobservedMessageEntries(record);
    if (entries.length === 0) return record;

    const unobserved = buildSessionContextFromEntries(entries).messages;
    const pendingTokens = this.tokenCounter.countMessages(unobserved);
    const threshold = this.deps.thresholds.observation;

    let result: ObservationalMemoryRecord;
    try {
      if (this.bufferingCoordinator.isAsyncObservationEnabled()) {
        // Over threshold: try to activate any buffered chunks first, then sync observe.
        if (pendingTokens >= threshold) {
          const activated = await this.maybeActivateBufferedObservations(record);
          const afterActivate =
            activated.id === record.id ? activated : await this.getOrCreateRecord();
          const afterEntries = await this.loadUnobservedMessageEntries(afterActivate);
          const afterUnobserved = buildSessionContextFromEntries(afterEntries).messages;
          const afterPending = this.tokenCounter.countMessages(afterUnobserved);
          if (afterPending >= threshold) {
            result = await this.runSyncObserve(afterActivate, afterEntries);
          } else {
            result = afterActivate;
          }
        } else if (
          this.bufferingCoordinator.shouldTriggerAsyncObservation(pendingTokens, record, threshold)
        ) {
          // Below threshold but crossed buffer interval: detach buffer observation.
          this.detach(
            "buffer observation",
            this.maybeBufferObservation(record, entries, pendingTokens),
          );
          result = record;
        } else {
          result = record;
        }
      } else {
        // Sync-only path
        if (pendingTokens <= threshold) {
          result = record;
        } else {
          result = await this.runSyncObserve(record, entries);
        }
      }
    } catch (error) {
      this.logError("observe failed", error);
      result = record;
    }

    await this.pruneObservedMessages(result);
    this.emitOmStatus(result);
    return result;
  }

  /**
   * Run the Reflector if observationTokenCount exceeds the reflection threshold.
   * When buffering is enabled, this also handles async reflection buffering.
   * Returns the updated record (or the original if no reflect happened).
   */
  async maybeReflect(record: ObservationalMemoryRecord): Promise<ObservationalMemoryRecord> {
    const observationTokens = record.observationTokenCount;
    const threshold = this.deps.thresholds.reflection;

    let result: ObservationalMemoryRecord;
    try {
      if (this.bufferingCoordinator.isAsyncReflectionEnabled()) {
        // Over threshold: try to activate buffered reflection first.
        if (observationTokens >= threshold) {
          const activated = await this.maybeActivateBufferedReflection(record);
          const afterActivate =
            activated.id === record.id ? activated : await this.getOrCreateRecord();
          if (afterActivate.observationTokenCount >= threshold) {
            result = await this.runSyncReflect(afterActivate);
          } else {
            result = afterActivate;
          }
        } else if (
          this.bufferingCoordinator.shouldTriggerAsyncReflection(
            observationTokens,
            record,
            threshold,
          )
        ) {
          // At activation point but below threshold: detach buffer reflection.
          this.detach("buffer reflection", this.maybeBufferReflection(record));
          result = record;
        } else {
          result = record;
        }
      } else {
        // Sync-only path
        if (observationTokens <= threshold) {
          result = record;
        } else {
          result = await this.runSyncReflect(record);
        }
      }
    } catch (error) {
      this.logError("reflect failed", error);
      result = record;
    }

    this.emitOmStatus(result);
    return result;
  }

  /**
   * Buffer a chunk of observations without merging into active observations.
   * Runs the Observer over messages newer than the buffer cursor and stores
   * the result as a pending buffered chunk.
   */
  async maybeBufferObservation(
    record: ObservationalMemoryRecord,
    entries?: MessageEntry[],
    pendingTokens?: number,
  ): Promise<ObservationalMemoryRecord> {
    if (!this.bufferingCoordinator.isAsyncObservationEnabled()) return record;

    const allEntries = entries ?? (await this.loadUnobservedMessageEntries(record));
    if (allEntries.length === 0) return record;

    const messages = buildSessionContextFromEntries(allEntries).messages;
    const currentTokens = pendingTokens ?? this.tokenCounter.countMessages(messages);
    const threshold = this.deps.thresholds.observation;

    if (
      !this.bufferingCoordinator.shouldTriggerAsyncObservation(currentTokens, record, threshold)
    ) {
      return record;
    }

    this.bufferingCoordinator.registerOp(currentTokens, "observation");

    const cycleId = `buffer-obs-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const startTime = Date.now();
    this.emitOmEvent({
      type: "om_start",
      cycleId,
      operationType: "buffering",
      tokenCount: currentTokens,
    });

    let flagCleared = false;
    let resolveOp: () => void;
    const opPromise = new Promise<void>((resolve) => {
      resolveOp = resolve;
    });
    this.bufferingCoordinator.setAsyncOp("observation", opPromise);

    try {
      await this.storage.setBufferingObservationFlag(record.id, true, currentTokens);

      const candidateEntries = this.filterEntriesAfterCursor(allEntries, record);
      const candidateMessages = buildSessionContextFromEntries(candidateEntries).messages;
      const bufferTokens = this.bufferingCoordinator.observationBufferTokens!;
      const minNewTokens = bufferTokens / 2;
      const newTokens = this.tokenCounter.countMessages(candidateMessages);

      if (candidateMessages.length === 0 || newTokens < minNewTokens) {
        flagCleared = true;
        await this.storage.setBufferingObservationFlag(record.id, false, currentTokens);
        return record;
      }

      const observerResult = await runObserver({
        messagesToObserve: candidateMessages,
        existingObservations: record.activeObservations,
        deps: this.deps,
        ...(this.abortSignal ? { abortSignal: this.abortSignal } : {}),
      });

      const maxTs = this.getMaxMessageTimestamp(candidateMessages);
      const lastObservedAt = new Date(maxTs.getTime() + 1);

      const chunk: BufferedObservationChunkInput = {
        cycleId,
        observations: observerResult.observations,
        tokenCount: observerResult.tokenCount,
        messageIds: this.extractObservedMessageIds(candidateEntries),
        messageTokens: newTokens,
        lastObservedAt,
        ...(observerResult.suggestedContinuation !== undefined
          ? { suggestedContinuation: observerResult.suggestedContinuation }
          : {}),
      };

      await this.storage.updateBufferedObservations({
        id: record.id,
        chunk,
        lastBufferedAtTime: lastObservedAt,
      });

      flagCleared = true;
      await this.storage.setBufferingObservationFlag(record.id, false, newTokens);
      this.bufferingCoordinator.setLastBufferedAtTime(lastObservedAt);

      this.emitOmEvent({
        type: "om_end",
        cycleId,
        operationType: "buffering",
        durationMs: Date.now() - startTime,
        tokensProcessed: newTokens,
        tokensProduced: observerResult.tokenCount,
        ...(observerResult.observations ? { observations: observerResult.observations } : {}),
      });

      return this.getOrCreateRecord();
    } catch (error) {
      this.logError("buffer observation failed", error);
      this.emitOmEvent({
        type: "om_failed",
        cycleId,
        operationType: "buffering",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      return record;
    } finally {
      this.bufferingCoordinator.unregisterOp("observation");
      resolveOp!();
      if (!flagCleared) {
        await this.storage.setBufferingObservationFlag(record.id, false).catch(() => {});
      }
    }
  }

  /**
   * Activate buffered observation chunks by merging them into active observations.
   * This is a pure storage operation — no LLM call.
   */
  async maybeActivateBufferedObservations(
    record: ObservationalMemoryRecord,
  ): Promise<ObservationalMemoryRecord> {
    const chunks = record.bufferedObservationChunks;
    if (!chunks || chunks.length === 0) return record;

    const threshold = this.deps.thresholds.observation;
    const activationRatio = resolveActivationRatio(
      this.deps.buffering?.observationBufferActivation ?? 1,
      threshold,
    );
    const totalChunkMessageTokens = chunks.reduce(
      (sum, chunk) => sum + (chunk.messageTokens ?? 0),
      0,
    );
    const currentPendingTokens = record.pendingMessageTokens || totalChunkMessageTokens;

    await this.storage.swapBufferedToActive({
      id: record.id,
      messageTokensThreshold: threshold,
      activationRatio,
      currentPendingTokens,
      forceMaxActivation: false,
    });

    this.emitOmEvent({
      type: "om_activation",
      cycleId: `activation-obs-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      operationType: "observation",
      chunksActivated: chunks.length,
      tokensActivated: totalChunkMessageTokens,
      observationTokens: 0,
    });

    await this.storage.setBufferingObservationFlag(record.id, false).catch(() => {});
    this.bufferingCoordinator.cleanupStaticMaps([]);

    return this.getOrCreateRecord();
  }

  /**
   * Start an async buffered reflection. Reflects a slice of active observations
   * and stores the result in bufferedReflection without creating a new generation.
   */
  async maybeBufferReflection(
    record: ObservationalMemoryRecord,
  ): Promise<ObservationalMemoryRecord> {
    if (!this.bufferingCoordinator.isAsyncReflectionEnabled()) return record;

    const observationTokens = record.observationTokenCount;
    const threshold = this.deps.thresholds.reflection;

    if (
      !this.bufferingCoordinator.shouldTriggerAsyncReflection(observationTokens, record, threshold)
    ) {
      return record;
    }

    const cycleId = `reflect-buf-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const startTime = Date.now();
    this.bufferingCoordinator.registerOp(observationTokens, "reflection", cycleId);

    this.emitOmEvent({
      type: "om_start",
      cycleId,
      operationType: "buffering",
      tokenCount: observationTokens,
    });

    let resolveOp: () => void;
    const opPromise = new Promise<void>((resolve) => {
      resolveOp = resolve;
    });
    this.bufferingCoordinator.setAsyncOp("reflection", opPromise);

    try {
      await this.storage.setBufferingReflectionFlag(record.id, true);

      const fullObservations = record.activeObservations ?? "";
      const allLines = fullObservations.split("\n");
      const totalLines = allLines.length;
      const avgTokensPerLine = totalLines > 0 ? observationTokens / totalLines : 1;
      const activationPoint = threshold * (this.deps.buffering?.reflectionBufferActivation ?? 0.5);
      const linesToReflect =
        avgTokensPerLine > 1
          ? Math.min(Math.floor(activationPoint / avgTokensPerLine), totalLines)
          : totalLines;

      const activeObservations = allLines.slice(0, linesToReflect).join("\n");
      const reflectedObservationLineCount = linesToReflect;
      const sliceTokenEstimate = Math.round(avgTokensPerLine * linesToReflect);

      const reflectorResult = await runReflector({
        observations: activeObservations,
        deps: this.deps,
        ...(this.abortSignal ? { abortSignal: this.abortSignal } : {}),
      });

      await this.storage.updateBufferedReflection({
        id: record.id,
        reflection: reflectorResult.reflection,
        tokenCount: reflectorResult.tokenCount,
        inputTokenCount: sliceTokenEstimate,
        reflectedObservationLineCount,
      });

      await this.storage.setBufferingReflectionFlag(record.id, false);

      this.emitOmEvent({
        type: "om_end",
        cycleId,
        operationType: "buffering",
        durationMs: Date.now() - startTime,
        tokensProcessed: sliceTokenEstimate,
        tokensProduced: reflectorResult.tokenCount,
        observations: reflectorResult.reflection,
      });

      return this.getOrCreateRecord();
    } catch (error) {
      this.logError("buffer reflection failed", error);
      this.emitOmEvent({
        type: "om_failed",
        cycleId,
        operationType: "buffering",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      this.bufferingCoordinator.clearBoundary("reflection");
      return record;
    } finally {
      this.bufferingCoordinator.unregisterOp("reflection");
      resolveOp!();
      await this.storage.setBufferingReflectionFlag(record.id, false).catch(() => {});
    }
  }

  /**
   * Activate a buffered reflection by merging it into active observations and
   * creating a new generation.
   */
  async maybeActivateBufferedReflection(
    record: ObservationalMemoryRecord,
  ): Promise<ObservationalMemoryRecord> {
    if (!record.bufferedReflection) return record;

    const fullObservations = record.activeObservations ?? "";
    const allLines = fullObservations.split("\n");
    const reflectedLineCount = record.reflectedObservationLineCount ?? 0;
    const unreflectedLines = allLines.slice(reflectedLineCount);
    const unreflectedContent = unreflectedLines.join("\n").trim();

    const combinedObservations = unreflectedContent
      ? `${record.bufferedReflection}\n\n${unreflectedContent}`
      : record.bufferedReflection;
    const combinedTokenCount = this.tokenCounter.countObservations(combinedObservations);

    const newRecord = await this.storage.swapBufferedReflectionToActive({
      currentRecord: record,
      tokenCount: combinedTokenCount,
    });

    this.emitOmEvent({
      type: "om_activation",
      cycleId: `activation-refl-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      operationType: "reflection",
      chunksActivated: 1,
      tokensActivated: combinedTokenCount,
      observationTokens: combinedTokenCount,
    });

    this.bufferingCoordinator.clearBoundary("reflection");
    return newRecord;
  }

  /**
   * Build the <observations> system-message section, or undefined if empty.
   */
  buildContextSystemMessage(record: ObservationalMemoryRecord): string | undefined {
    return formatObservationsForContext(record.activeObservations);
  }

  /**
   * Prune observed messages from the active context by appending an
   * ObservationPruneEntry to the session tree. The context builder honors
   * this entry — skipping observed messages whose content is available as
   * compressed observations in the system prompt.
   *
   * Port of Mastra's cleanupMessages (observational-memory.ts:2327-2416).
   * Two-pass retention-aware: per-message floor check + LIFO aggregate
   * restore.
   */
  async pruneObservedMessages(record: ObservationalMemoryRecord): Promise<void> {
    const observedIds = record.observedMessageIds ?? [];
    if (observedIds.length === 0) return;

    try {
      const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
      const pathEntries = await Effect.runPromise(this.sessionStorage.getPathToRoot(leafId));
      const messageEntries = pathEntries.filter((e): e is MessageEntry => e.type === "message");

      // Skip if no observed entries are still present in the tree.
      const observedSet = new Set(observedIds);
      const presentObserved = messageEntries.filter((e) => observedSet.has(e.id));
      if (presentObserved.length === 0) return;

      const floor = resolveRetentionFloor(
        this.deps.buffering?.observationBufferActivation ?? 1,
        this.deps.thresholds.observation,
      );

      const toRemove = getObservedEntryIdsForCleanup({
        entries: messageEntries,
        observedEntryIds: observedIds,
        retentionFloor: floor,
        tokenCounter: this.tokenCounter,
      });

      if (toRemove.length === 0) return;

      const id = await Effect.runPromise(this.sessionStorage.createEntryId());
      const pruneEntry: ObservationPruneEntry = {
        type: "observation_prune",
        id,
        parentId: leafId,
        timestamp: new Date().toISOString(),
        observedEntryIds: toRemove,
        observationRecordId: record.id,
      };
      await Effect.runPromise(this.sessionStorage.appendEntry(pruneEntry));
    } catch (error) {
      this.logError("prune observed messages", error);
    }
  }

  /**
   * Await any in-flight detached buffering ops (obs + refl) for this engine's
   * lookup key, with a timeout. Called at run end so a slow detached observe
   * completes before teardown rather than being orphaned.
   */
  async waitForBuffering(timeoutMs: number): Promise<void> {
    await this.bufferingCoordinator.awaitInFlight(timeoutMs);
  }

  /**
   * Fire an OM lifecycle event via the callback. Best-effort: errors in the
   * callback are caught and logged, never propagated to the caller.
   */
  private emitOmEvent(event: OmAgentEvent): void {
    try {
      this.onOmEvent?.(event);
    } catch (error) {
      this.logError("onOmEvent callback", error);
    }
  }

  /**
   * Fire an om_status window snapshot from the current record state.
   */
  private emitOmStatus(record: ObservationalMemoryRecord): void {
    this.emitOmEvent({
      type: "om_status",
      windows: {
        messages: {
          tokens: record.pendingMessageTokens,
          threshold: this.deps.thresholds.observation,
        },
        observations: {
          tokens: record.observationTokenCount,
          threshold: this.deps.thresholds.reflection,
        },
      },
      recordId: record.id,
    });
  }

  /**
   * Fire-and-forget a detached op, guarding against unhandled rejections.
   * Detached failures are best-effort (already logged inside the op body).
   */
  private detach(phase: string, op: Promise<unknown>): void {
    void op.catch((error) => this.logError(`${phase} (detached)`, error));
  }

  private async runSyncObserve(
    record: ObservationalMemoryRecord,
    entries: MessageEntry[],
  ): Promise<ObservationalMemoryRecord> {
    const cycleId = crypto.randomUUID();
    const startTime = Date.now();
    const unobserved = buildSessionContextFromEntries(entries).messages;
    const tokenCount = this.tokenCounter.countMessages(unobserved);

    this.emitOmEvent({ type: "om_start", cycleId, operationType: "observation", tokenCount });

    try {
      const observerResult = await runObserver({
        messagesToObserve: unobserved,
        existingObservations: record.activeObservations,
        deps: this.deps,
        ...(this.abortSignal ? { abortSignal: this.abortSignal } : {}),
      });

      const now = new Date();
      const observedMessageIds = this.extractObservedMessageIds(entries);

      await this.storage.updateActiveObservations({
        id: record.id,
        observations: record.activeObservations
          ? `${record.activeObservations}\n\n${observerResult.observations}`
          : observerResult.observations,
        lastObservedAt: now,
        tokenCount: observerResult.tokenCount,
        ...(observedMessageIds.length > 0 ? { observedMessageIds } : {}),
      });

      this.emitOmEvent({
        type: "om_end",
        cycleId,
        operationType: "observation",
        durationMs: Date.now() - startTime,
        tokensProcessed: tokenCount,
        tokensProduced: observerResult.tokenCount,
        ...(observerResult.observations ? { observations: observerResult.observations } : {}),
        ...(observerResult.suggestedContinuation
          ? { suggestedResponse: observerResult.suggestedContinuation }
          : {}),
      });

      return this.getOrCreateRecord();
    } catch (error) {
      this.emitOmEvent({
        type: "om_failed",
        cycleId,
        operationType: "observation",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  private async runSyncReflect(
    record: ObservationalMemoryRecord,
  ): Promise<ObservationalMemoryRecord> {
    const cycleId = crypto.randomUUID();
    const startTime = Date.now();
    const tokenCount = record.observationTokenCount;

    this.emitOmEvent({ type: "om_start", cycleId, operationType: "reflection", tokenCount });

    await this.storage.setReflectingFlag(record.id, true);
    try {
      const reflectorResult = await runReflector({
        observations: record.activeObservations,
        deps: this.deps,
        ...(this.abortSignal ? { abortSignal: this.abortSignal } : {}),
      });

      await this.storage.createReflectionGeneration({
        currentRecord: record,
        reflection: reflectorResult.reflection,
        tokenCount: reflectorResult.tokenCount,
      });

      this.emitOmEvent({
        type: "om_end",
        cycleId,
        operationType: "reflection",
        durationMs: Date.now() - startTime,
        tokensProcessed: tokenCount,
        tokensProduced: reflectorResult.tokenCount,
        observations: reflectorResult.reflection,
      });

      return this.getOrCreateRecord();
    } catch (error) {
      this.emitOmEvent({
        type: "om_failed",
        cycleId,
        operationType: "reflection",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    } finally {
      await this.storage.setReflectingFlag(record.id, false).catch(() => {});
    }
  }

  private filterEntriesAfterCursor(
    entries: MessageEntry[],
    record: ObservationalMemoryRecord,
  ): MessageEntry[] {
    const lastBufferedAtTime = record.lastBufferedAtTime ?? undefined;
    let bufferCursor = this.bufferingCoordinator.getLastBufferedAtTime() ?? lastBufferedAtTime;
    if (record.lastObservedAt) {
      if (!bufferCursor || record.lastObservedAt.getTime() > bufferCursor.getTime()) {
        bufferCursor = record.lastObservedAt;
      }
    }

    if (!bufferCursor) return entries;
    const cursorMs = bufferCursor.getTime();

    return entries.filter((entry) => {
      const ts = entry.message.timestamp;
      if (ts === undefined) return true;
      return ts > cursorMs;
    });
  }

  private getMaxMessageTimestamp(messages: AgentMessage[]): Date {
    let maxTime = 0;
    for (const msg of messages) {
      const ts = "timestamp" in msg ? msg.timestamp : undefined;
      if (ts !== undefined && ts > maxTime) {
        maxTime = ts;
      }
    }
    return maxTime > 0 ? new Date(maxTime) : new Date();
  }

  private extractObservedMessageIds(entries: MessageEntry[]): string[] {
    return entries.map((entry) => entry.id);
  }

  private logError(phase: string, error: unknown): void {
    // Best-effort logging only; OM failures must never abort the run.
    this.logger?.warn("observational-memory failure (best-effort)", {
      phase,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
