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
import type { AgentMessage } from "../types.ts";
import { buildSessionContextFromEntries } from "../session/session.ts";
import type { SessionTreeEntry } from "../session/entries.ts";
import type {
  BufferedObservationChunkInput,
  ObservationalMemoryRecord,
  ObservationalMemoryStorage,
} from "../observational-memory-storage.ts";
import type { SessionStorageShape } from "../session/storage.ts";
import type { ObservationalMemoryDeps } from "./config.ts";
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
}

export class ObservationalMemoryEngine {
  private readonly deps: ObservationalMemoryDeps;
  private readonly storage: ObservationalMemoryStorage;
  private readonly sessionStorage: SessionStorageShape;
  private readonly sessionId: string;
  private readonly projectId: string;
  private readonly leafId: string | null;
  private readonly tokenCounter: ObservationalMemoryDeps["tokenCounter"];
  private readonly bufferingCoordinator: BufferingCoordinator;

  constructor(options: ObservationalMemoryEngineOptions) {
    this.deps = options.deps;
    this.storage = options.deps.storage;
    this.sessionStorage = options.deps.sessionStorage;
    this.sessionId = options.deps.sessionId;
    this.projectId = options.deps.projectId;
    this.leafId = options.deps.leafId;
    this.tokenCounter = options.deps.tokenCounter;
    this.bufferingCoordinator = new BufferingCoordinator({
      threadId: this.sessionId,
      observationBufferTokens: resolveBufferTokens(
        options.deps.buffering?.observationBufferTokens,
        options.deps.thresholds.observation,
      ),
      reflectionBufferActivation: options.deps.buffering?.reflectionBufferActivation ?? 0,
    });
  }

  /** Current record, creating an initial one if absent. */
  async getOrCreateRecord(): Promise<ObservationalMemoryRecord> {
    const existing = await this.storage.getObservationalMemory(this.sessionId, this.projectId);
    if (existing) return existing;

    return this.storage.initializeObservationalMemory({
      threadId: this.sessionId,
      resourceId: this.projectId,
      scope: "thread",
      config: {},
    });
  }

  /**
   * Load message-kind entries since record.lastObservedAt as AgentMessage[].
   *
   * Filters to `type === "message"` and `createdAt > lastObservedAt`, then
   * converts via buildSessionContextFromEntries.
   */
  async loadUnobservedMessages(record: ObservationalMemoryRecord): Promise<AgentMessage[]> {
    const pathEntries = await Effect.runPromise(this.sessionStorage.getPathToRoot(this.leafId));
    const messageEntries = pathEntries.filter((entry) => entry.type === "message");

    const unobservedEntries: SessionTreeEntry[] = messageEntries.filter((entry) => {
      if (record.lastObservedAt === undefined) return true;
      const messageTimestamp =
        entry.type === "message" && entry.message.timestamp
          ? new Date(entry.message.timestamp)
          : undefined;
      return messageTimestamp !== undefined && messageTimestamp > record.lastObservedAt;
    });

    return buildSessionContextFromEntries(unobservedEntries).messages;
  }

  /**
   * Run the Observer if pending message tokens exceed the observation threshold.
   * When buffering is enabled, this also handles buffer-then-activate behavior.
   * Returns the updated record (or the original if no observe happened).
   */
  async maybeObserve(record: ObservationalMemoryRecord): Promise<ObservationalMemoryRecord> {
    const unobserved = await this.loadUnobservedMessages(record);
    if (unobserved.length === 0) return record;

    const pendingTokens = this.tokenCounter.countMessages(unobserved);
    const threshold = this.deps.thresholds.observation;

    try {
      if (this.bufferingCoordinator.isAsyncObservationEnabled()) {
        // Over threshold: try to activate any buffered chunks first, then sync observe.
        if (pendingTokens >= threshold) {
          const activated = await this.maybeActivateBufferedObservations(record);
          const afterActivate =
            activated.id === record.id ? activated : await this.getOrCreateRecord();
          const afterUnobserved = await this.loadUnobservedMessages(afterActivate);
          const afterPending = this.tokenCounter.countMessages(afterUnobserved);
          if (afterPending >= threshold) {
            return this.runSyncObserve(afterActivate, afterUnobserved);
          }
          return afterActivate;
        }

        // Below threshold but crossed buffer interval: buffer observations.
        if (
          this.bufferingCoordinator.shouldTriggerAsyncObservation(pendingTokens, record, threshold)
        ) {
          return this.maybeBufferObservation(record, unobserved, pendingTokens);
        }

        return record;
      }

      // Sync-only path
      if (pendingTokens <= threshold) return record;
      return this.runSyncObserve(record, unobserved);
    } catch (error) {
      this.logError("observe failed", error);
      return record;
    }
  }

  /**
   * Run the Reflector if observationTokenCount exceeds the reflection threshold.
   * When buffering is enabled, this also handles async reflection buffering.
   * Returns the updated record (or the original if no reflect happened).
   */
  async maybeReflect(record: ObservationalMemoryRecord): Promise<ObservationalMemoryRecord> {
    const observationTokens = record.observationTokenCount;
    const threshold = this.deps.thresholds.reflection;

    try {
      if (this.bufferingCoordinator.isAsyncReflectionEnabled()) {
        // Over threshold: try to activate buffered reflection first.
        if (observationTokens >= threshold) {
          const activated = await this.maybeActivateBufferedReflection(record);
          const afterActivate =
            activated.id === record.id ? activated : await this.getOrCreateRecord();
          if (afterActivate.observationTokenCount >= threshold) {
            return this.runSyncReflect(afterActivate);
          }
          return afterActivate;
        }

        // At activation point but below threshold: start async buffered reflection.
        if (
          this.bufferingCoordinator.shouldTriggerAsyncReflection(
            observationTokens,
            record,
            threshold,
          )
        ) {
          return this.maybeBufferReflection(record);
        }

        return record;
      }

      // Sync-only path
      if (observationTokens <= threshold) return record;
      return this.runSyncReflect(record);
    } catch (error) {
      this.logError("reflect failed", error);
      return record;
    }
  }

  /**
   * Buffer a chunk of observations without merging into active observations.
   * Runs the Observer over messages newer than the buffer cursor and stores
   * the result as a pending buffered chunk.
   */
  async maybeBufferObservation(
    record: ObservationalMemoryRecord,
    unobservedMessages?: AgentMessage[],
    pendingTokens?: number,
  ): Promise<ObservationalMemoryRecord> {
    if (!this.bufferingCoordinator.isAsyncObservationEnabled()) return record;

    const messages = unobservedMessages ?? (await this.loadUnobservedMessages(record));
    if (messages.length === 0) return record;

    const currentTokens = pendingTokens ?? this.tokenCounter.countMessages(messages);
    const threshold = this.deps.thresholds.observation;

    if (
      !this.bufferingCoordinator.shouldTriggerAsyncObservation(currentTokens, record, threshold)
    ) {
      return record;
    }

    this.bufferingCoordinator.registerOp(currentTokens, "observation");

    let flagCleared = false;
    let resolveOp: () => void;
    const opPromise = new Promise<void>((resolve) => {
      resolveOp = resolve;
    });
    this.bufferingCoordinator.setAsyncOp("observation", opPromise);

    try {
      await this.storage.setBufferingObservationFlag(record.id, true, currentTokens);

      const candidateMessages = this.filterMessagesAfterCursor(messages, record);
      const bufferTokens = this.bufferingCoordinator.observationBufferTokens!;
      const minNewTokens = bufferTokens / 2;
      const newTokens = this.tokenCounter.countMessages(candidateMessages);

      if (candidateMessages.length === 0 || newTokens < minNewTokens) {
        flagCleared = true;
        await this.storage.setBufferingObservationFlag(record.id, false, currentTokens);
        return record;
      }

      const cycleId = `buffer-obs-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const observerResult = await runObserver({
        messagesToObserve: candidateMessages,
        existingObservations: record.activeObservations,
        deps: this.deps,
      });

      const maxTs = this.getMaxMessageTimestamp(candidateMessages);
      const lastObservedAt = new Date(maxTs.getTime() + 1);

      const chunk: BufferedObservationChunkInput = {
        cycleId,
        observations: observerResult.observations,
        tokenCount: observerResult.tokenCount,
        messageIds: this.extractObservedMessageIds(candidateMessages),
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

      return this.getOrCreateRecord();
    } catch (error) {
      this.logError("buffer observation failed", error);
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
    this.bufferingCoordinator.registerOp(observationTokens, "reflection", cycleId);

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
      });

      await this.storage.updateBufferedReflection({
        id: record.id,
        reflection: reflectorResult.reflection,
        tokenCount: reflectorResult.tokenCount,
        inputTokenCount: sliceTokenEstimate,
        reflectedObservationLineCount,
      });

      await this.storage.setBufferingReflectionFlag(record.id, false);
      return this.getOrCreateRecord();
    } catch (error) {
      this.logError("buffer reflection failed", error);
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

    this.bufferingCoordinator.clearBoundary("reflection");
    return newRecord;
  }

  /**
   * Build the <observations> system-message section, or undefined if empty.
   */
  buildContextSystemMessage(record: ObservationalMemoryRecord): string | undefined {
    return formatObservationsForContext(record.activeObservations);
  }

  private async runSyncObserve(
    record: ObservationalMemoryRecord,
    unobserved: AgentMessage[],
  ): Promise<ObservationalMemoryRecord> {
    const observerResult = await runObserver({
      messagesToObserve: unobserved,
      existingObservations: record.activeObservations,
      deps: this.deps,
    });

    const now = new Date();
    const observedMessageIds = this.extractObservedMessageIds(unobserved);

    await this.storage.updateActiveObservations({
      id: record.id,
      observations: record.activeObservations
        ? `${record.activeObservations}\n\n${observerResult.observations}`
        : observerResult.observations,
      lastObservedAt: now,
      tokenCount: observerResult.tokenCount,
      ...(observedMessageIds.length > 0 ? { observedMessageIds } : {}),
    });

    return this.getOrCreateRecord();
  }

  private async runSyncReflect(
    record: ObservationalMemoryRecord,
  ): Promise<ObservationalMemoryRecord> {
    await this.storage.setReflectingFlag(record.id, true);

    try {
      const reflectorResult = await runReflector({
        observations: record.activeObservations,
        deps: this.deps,
      });

      await this.storage.createReflectionGeneration({
        currentRecord: record,
        reflection: reflectorResult.reflection,
        tokenCount: reflectorResult.tokenCount,
      });

      return this.getOrCreateRecord();
    } catch (error) {
      this.logError("reflect failed", error);
      return record;
    } finally {
      await this.storage.setReflectingFlag(record.id, false).catch(() => {});
    }
  }

  private filterMessagesAfterCursor(
    messages: AgentMessage[],
    record: ObservationalMemoryRecord,
  ): AgentMessage[] {
    const lastBufferedAtTime = record.lastBufferedAtTime ?? undefined;
    let bufferCursor = this.bufferingCoordinator.getLastBufferedAtTime() ?? lastBufferedAtTime;
    if (record.lastObservedAt) {
      if (!bufferCursor || record.lastObservedAt.getTime() > bufferCursor.getTime()) {
        bufferCursor = record.lastObservedAt;
      }
    }

    if (!bufferCursor) return messages;

    return messages.filter((msg) => {
      const ts = "timestamp" in msg ? msg.timestamp : undefined;
      if (ts === undefined) return true;
      return ts > bufferCursor.getTime();
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

  private extractObservedMessageIds(_messages: AgentMessage[]): string[] {
    // The storage adapter owns entry ids; the processor only knows messages.
    // For now we return an empty array — the storage plan's observedMessageIds
    // is a safeguard and is not required for the sync path.
    return [];
  }

  private logError(_message: string, _error: unknown): void {
    // Best-effort logging only; OM failures must never abort the run.
    // Logger is not part of deps currently; keep this hook for future use.
  }
}
