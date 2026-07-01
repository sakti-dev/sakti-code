import { and, desc, eq, gte, lte } from "drizzle-orm";
import type {
  CreateObservationalMemoryInput,
  ObservationalMemoryHistoryOptions,
  ObservationalMemoryRecord,
  ObservationalMemoryStorage,
  SwapBufferedToActiveResult,
} from "@sakti-code/agent";
import type { DrizzleDB } from "./init.ts";
import { observationalMemory } from "./schema.ts";

function omLookupKey(threadId: string | null, resourceId: string): string {
  return threadId ? `thread:${threadId}` : `resource:${resourceId}`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toDate(value: number | null | undefined): Date | undefined {
  return value == null ? undefined : new Date(value);
}

function parseRecord(row: typeof observationalMemory.$inferSelect): ObservationalMemoryRecord {
  return {
    id: row.id,
    scope: row.scope as ObservationalMemoryRecord["scope"],
    threadId: row.threadId,
    resourceId: row.resourceId ?? "",
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    ...(row.lastObservedAt == null ? {} : { lastObservedAt: new Date(row.lastObservedAt) }),
    ...(row.lastReflectionAt == null ? {} : { lastReflectionAt: new Date(row.lastReflectionAt) }),
    originType: row.originType as ObservationalMemoryRecord["originType"],
    generationCount: row.generationCount,
    activeObservations: row.activeObservations,
    ...(row.activeObservationsPendingUpdate == null
      ? {}
      : { activeObservationsPendingUpdate: row.activeObservationsPendingUpdate }),
    ...(row.bufferedObservationChunks == null
      ? {}
      : {
          bufferedObservationChunks: parseJson(row.bufferedObservationChunks, undefined as never),
        }),
    ...(row.bufferedReflection == null ? {} : { bufferedReflection: row.bufferedReflection }),
    ...(row.bufferedReflectionTokens == null
      ? {}
      : { bufferedReflectionTokens: row.bufferedReflectionTokens }),
    ...(row.bufferedReflectionInputTokens == null
      ? {}
      : { bufferedReflectionInputTokens: row.bufferedReflectionInputTokens }),
    ...(row.reflectedObservationLineCount == null
      ? {}
      : { reflectedObservationLineCount: row.reflectedObservationLineCount }),
    ...(row.observedMessageIds == null
      ? {}
      : { observedMessageIds: parseJson(row.observedMessageIds, undefined as never) }),
    ...(row.observedTimezone == null ? {} : { observedTimezone: row.observedTimezone }),
    totalTokensObserved: row.totalTokensObserved,
    observationTokenCount: row.observationTokenCount,
    pendingMessageTokens: row.pendingMessageTokens,
    isObserving: row.isObserving,
    isReflecting: row.isReflecting,
    isBufferingObservation: row.isBufferingObservation,
    isBufferingReflection: row.isBufferingReflection,
    lastBufferedAtTokens: row.lastBufferedAtTokens,
    lastBufferedAtTime: toDate(row.lastBufferedAtTime ?? null) ?? null,
    config: parseJson(row.config, {}),
    ...(row.metadata == null ? {} : { metadata: parseJson(row.metadata, {} as never) }),
  };
}

export class SqliteObservationalMemoryStorage implements ObservationalMemoryStorage {
  private readonly db: DrizzleDB;
  constructor(db: DrizzleDB) {
    this.db = db;
  }

  async getObservationalMemory(
    threadId: string | null,
    resourceId: string,
  ): Promise<ObservationalMemoryRecord | null> {
    const row = this.db
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.lookupKey, omLookupKey(threadId, resourceId)))
      .orderBy(desc(observationalMemory.generationCount))
      .limit(1)
      .get();
    return row ? parseRecord(row) : null;
  }

  async getObservationalMemoryHistory(
    threadId: string | null,
    resourceId: string,
    limit = 10,
    options?: ObservationalMemoryHistoryOptions,
  ): Promise<ObservationalMemoryRecord[]> {
    const conditions = [eq(observationalMemory.lookupKey, omLookupKey(threadId, resourceId))];
    if (options?.from) conditions.push(gte(observationalMemory.createdAt, options.from.getTime()));
    if (options?.to) conditions.push(lte(observationalMemory.createdAt, options.to.getTime()));
    const query = this.db
      .select()
      .from(observationalMemory)
      .where(and(...conditions))
      .orderBy(desc(observationalMemory.generationCount))
      .limit(limit);
    const result = options?.offset != null ? query.offset(options.offset) : query;
    return result.all().map(parseRecord);
  }

  async initializeObservationalMemory(
    input: CreateObservationalMemoryInput,
  ): Promise<ObservationalMemoryRecord> {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db
      .insert(observationalMemory)
      .values({
        id,
        lookupKey: omLookupKey(input.threadId, input.resourceId),
        scope: input.scope,
        resourceId: input.resourceId,
        threadId: input.threadId,
        activeObservations: "",
        originType: "initial",
        generationCount: 0,
        config: JSON.stringify(input.config),
        pendingMessageTokens: 0,
        totalTokensObserved: 0,
        observationTokenCount: 0,
        isObserving: false,
        isReflecting: false,
        isBufferingObservation: false,
        isBufferingReflection: false,
        lastBufferedAtTokens: 0,
        ...(input.observedTimezone === undefined
          ? {}
          : { observedTimezone: input.observedTimezone }),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const row = this.db
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.id, id))
      .get();
    if (!row) throw new Error(`OM record not found after insert: ${id}`);
    return parseRecord(row);
  }

  // Stub methods — implemented in later tasks
  async insertObservationalMemoryRecord(): Promise<void> {
    throw new Error("not implemented");
  }
  async updateActiveObservations(): Promise<void> {
    throw new Error("not implemented");
  }
  async createReflectionGeneration(): Promise<ObservationalMemoryRecord> {
    throw new Error("not implemented");
  }
  async setReflectingFlag(): Promise<void> {
    throw new Error("not implemented");
  }
  async setObservingFlag(): Promise<void> {
    throw new Error("not implemented");
  }
  async setBufferingObservationFlag(): Promise<void> {
    throw new Error("not implemented");
  }
  async setBufferingReflectionFlag(): Promise<void> {
    throw new Error("not implemented");
  }
  async clearObservationalMemory(): Promise<void> {
    throw new Error("not implemented");
  }
  async setPendingMessageTokens(): Promise<void> {
    throw new Error("not implemented");
  }
  async updateObservationalMemoryConfig(): Promise<void> {
    throw new Error("not implemented");
  }
  async updateBufferedObservations(): Promise<void> {
    throw new Error("not implemented");
  }
  async swapBufferedToActive(): Promise<SwapBufferedToActiveResult> {
    throw new Error("not implemented");
  }
  async updateBufferedReflection(): Promise<void> {
    throw new Error("not implemented");
  }
  async swapBufferedReflectionToActive(): Promise<ObservationalMemoryRecord> {
    throw new Error("not implemented");
  }
}
