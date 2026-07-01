/**
 * Observational Memory sync engine.
 *
 * Ports the sync slice of Mastra's observational-memory state machine:
 * get-or-create record, load un-observed messages, maybe-observe, maybe-reflect,
 * and build the <observations> system-message suffix.
 *
 * OM failures are best-effort: logged and swallowed so they never abort a run.
 */

import { Effect } from "effect";
import type { AgentMessage } from "../types.ts";
import { buildSessionContextFromEntries } from "../session/session.ts";
import type { SessionTreeEntry } from "../session/entries.ts";
import type {
  ObservationalMemoryRecord,
  ObservationalMemoryStorage,
} from "../observational-memory-storage.ts";
import type { SessionStorageShape } from "../session/storage.ts";
import type { ObservationalMemoryDeps } from "./config.ts";
import { formatObservationsForContext } from "./prompts.ts";
import { runObserver } from "./observer.ts";
import { runReflector } from "./reflector.ts";

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

  constructor(options: ObservationalMemoryEngineOptions) {
    this.deps = options.deps;
    this.storage = options.deps.storage;
    this.sessionStorage = options.deps.sessionStorage;
    this.sessionId = options.deps.sessionId;
    this.projectId = options.deps.projectId;
    this.leafId = options.deps.leafId;
    this.tokenCounter = options.deps.tokenCounter;
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
   * Returns the updated record (or the original if no observe happened).
   */
  async maybeObserve(record: ObservationalMemoryRecord): Promise<ObservationalMemoryRecord> {
    const unobserved = await this.loadUnobservedMessages(record);
    if (unobserved.length === 0) return record;

    const pendingTokens = this.tokenCounter.countMessages(unobserved);
    if (pendingTokens <= this.deps.thresholds.observation) return record;

    try {
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
    } catch (error) {
      this.logError("observe failed", error);
      return record;
    }
  }

  /**
   * Run the Reflector if observationTokenCount exceeds the reflection threshold.
   * Returns the updated record (or the original if no reflect happened).
   */
  async maybeReflect(record: ObservationalMemoryRecord): Promise<ObservationalMemoryRecord> {
    if (record.observationTokenCount <= this.deps.thresholds.reflection) return record;

    try {
      await this.storage.setReflectingFlag(record.id, true);

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

  /**
   * Build the <observations> system-message section, or undefined if empty.
   */
  buildContextSystemMessage(record: ObservationalMemoryRecord): string | undefined {
    return formatObservationsForContext(record.activeObservations);
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
