import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type {
  CreateObservationalMemoryInput,
  CreateReflectionGenerationInput,
  ObservationalMemoryHistoryOptions,
  ObservationalMemoryRecord,
  ObservationalMemoryStorage,
  SwapBufferedToActiveResult,
  UpdateActiveObservationsInput,
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
  async insertObservationalMemoryRecord(record: ObservationalMemoryRecord): Promise<void> {
    this.db
      .insert(observationalMemory)
      .values({
        id: record.id,
        lookupKey: omLookupKey(record.threadId, record.resourceId),
        scope: record.scope,
        resourceId: record.resourceId,
        threadId: record.threadId,
        activeObservations: record.activeObservations ?? "",
        ...(record.activeObservationsPendingUpdate === undefined
          ? {}
          : { activeObservationsPendingUpdate: record.activeObservationsPendingUpdate }),
        ...(record.bufferedObservationChunks === undefined
          ? {}
          : { bufferedObservationChunks: JSON.stringify(record.bufferedObservationChunks) }),
        ...(record.bufferedReflection === undefined
          ? {}
          : { bufferedReflection: record.bufferedReflection }),
        ...(record.bufferedReflectionTokens === undefined
          ? {}
          : { bufferedReflectionTokens: record.bufferedReflectionTokens }),
        ...(record.bufferedReflectionInputTokens === undefined
          ? {}
          : { bufferedReflectionInputTokens: record.bufferedReflectionInputTokens }),
        ...(record.reflectedObservationLineCount === undefined
          ? {}
          : { reflectedObservationLineCount: record.reflectedObservationLineCount }),
        ...(record.observedMessageIds === undefined
          ? {}
          : { observedMessageIds: JSON.stringify(record.observedMessageIds) }),
        ...(record.observedTimezone === undefined
          ? {}
          : { observedTimezone: record.observedTimezone }),
        originType: record.originType,
        generationCount: record.generationCount,
        config: JSON.stringify(record.config),
        pendingMessageTokens: record.pendingMessageTokens,
        totalTokensObserved: record.totalTokensObserved,
        observationTokenCount: record.observationTokenCount,
        isObserving: record.isObserving,
        isReflecting: record.isReflecting,
        isBufferingObservation: record.isBufferingObservation,
        isBufferingReflection: record.isBufferingReflection,
        lastBufferedAtTokens: record.lastBufferedAtTokens,
        ...(record.lastObservedAt === undefined
          ? {}
          : { lastObservedAt: record.lastObservedAt.getTime() }),
        ...(record.lastReflectionAt === undefined
          ? {}
          : { lastReflectionAt: record.lastReflectionAt.getTime() }),
        ...(record.lastBufferedAtTime === undefined || record.lastBufferedAtTime === null
          ? {}
          : { lastBufferedAtTime: record.lastBufferedAtTime.getTime() }),
        ...(record.metadata === undefined ? {} : { metadata: JSON.stringify(record.metadata) }),
        createdAt: record.createdAt.getTime(),
        updatedAt: record.updatedAt.getTime(),
      })
      .run();
  }

  async updateActiveObservations(input: UpdateActiveObservationsInput): Promise<void> {
    const existing = this.db
      .select({ id: observationalMemory.id })
      .from(observationalMemory)
      .where(eq(observationalMemory.id, input.id))
      .get();
    if (!existing) throw new Error(`Observational memory record not found: ${input.id}`);
    this.db
      .update(observationalMemory)
      .set({
        activeObservations: input.observations,
        lastObservedAt: input.lastObservedAt.getTime(),
        pendingMessageTokens: 0,
        observationTokenCount: input.tokenCount,
        totalTokensObserved: sql`${observationalMemory.totalTokensObserved} + ${input.tokenCount}`,
        ...(input.observedMessageIds === undefined
          ? {}
          : { observedMessageIds: JSON.stringify(input.observedMessageIds) }),
        updatedAt: Date.now(),
      })
      .where(eq(observationalMemory.id, input.id))
      .run();
  }

  async createReflectionGeneration(
    input: CreateReflectionGenerationInput,
  ): Promise<ObservationalMemoryRecord> {
    const c = input.currentRecord;
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db
      .insert(observationalMemory)
      .values({
        id,
        lookupKey: omLookupKey(c.threadId, c.resourceId),
        scope: c.scope,
        resourceId: c.resourceId,
        threadId: c.threadId,
        activeObservations: input.reflection,
        originType: "reflection",
        generationCount: c.generationCount + 1,
        config: JSON.stringify(c.config),
        pendingMessageTokens: 0,
        totalTokensObserved: c.totalTokensObserved,
        observationTokenCount: input.tokenCount,
        isObserving: false,
        isReflecting: false,
        isBufferingObservation: false,
        isBufferingReflection: false,
        lastBufferedAtTokens: 0,
        ...(c.lastObservedAt === undefined ? {} : { lastObservedAt: c.lastObservedAt.getTime() }),
        lastReflectionAt: now,
        ...(c.observedTimezone === undefined ? {} : { observedTimezone: c.observedTimezone }),
        ...(c.metadata === undefined ? {} : { metadata: JSON.stringify(c.metadata) }),
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
