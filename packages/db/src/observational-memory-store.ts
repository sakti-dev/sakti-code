import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import type {
  BufferedObservationChunk,
  CreateObservationalMemoryInput,
  CreateReflectionGenerationInput,
  ObservationalMemoryHistoryOptions,
  ObservationalMemoryRecord,
  ObservationalMemoryStorage,
  SwapBufferedToActiveInput,
  SwapBufferedToActiveResult,
  SwapBufferedReflectionToActiveInput,
  UpdateActiveObservationsInput,
  UpdateBufferedObservationsInput,
  UpdateBufferedReflectionInput,
  UpdateObservationalMemoryConfigInput,
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

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const t = target[key];
    const s = source[key];
    out[key] = isPlainObj(t) && isPlainObj(s) ? deepMerge(t, s) : s;
  }
  return out;
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
          bufferedObservationChunks: parseJson<BufferedObservationChunk[]>(
            row.bufferedObservationChunks,
            [],
          ).map((c) => ({
            ...c,
            // JSON round-trips Dates as ISO strings; revive them to match the type.
            lastObservedAt: new Date(c.lastObservedAt),
            createdAt: new Date(c.createdAt),
          })),
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
      : { observedMessageIds: parseJson<string[]>(row.observedMessageIds, []) }),
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
    ...(row.metadata == null
      ? {}
      : { metadata: parseJson<Record<string, unknown>>(row.metadata, {}) }),
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
        activeObservations: input.activeObservations ?? input.reflection,
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
  async setReflectingFlag(id: string, isReflecting: boolean): Promise<void> {
    if (
      !this.db
        .select({ id: observationalMemory.id })
        .from(observationalMemory)
        .where(eq(observationalMemory.id, id))
        .get()
    )
      throw new Error(`OM record not found: ${id}`);
    this.db
      .update(observationalMemory)
      .set({ isReflecting, updatedAt: Date.now() })
      .where(eq(observationalMemory.id, id))
      .run();
  }

  async setObservingFlag(id: string, isObserving: boolean): Promise<void> {
    if (
      !this.db
        .select({ id: observationalMemory.id })
        .from(observationalMemory)
        .where(eq(observationalMemory.id, id))
        .get()
    )
      throw new Error(`OM record not found: ${id}`);
    this.db
      .update(observationalMemory)
      .set({ isObserving, updatedAt: Date.now() })
      .where(eq(observationalMemory.id, id))
      .run();
  }

  async setBufferingObservationFlag(
    id: string,
    isBuffering: boolean,
    lastBufferedAtTokens?: number,
  ): Promise<void> {
    if (
      !this.db
        .select({ id: observationalMemory.id })
        .from(observationalMemory)
        .where(eq(observationalMemory.id, id))
        .get()
    )
      throw new Error(`OM record not found: ${id}`);
    this.db
      .update(observationalMemory)
      .set({
        isBufferingObservation: isBuffering,
        ...(lastBufferedAtTokens !== undefined ? { lastBufferedAtTokens } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(observationalMemory.id, id))
      .run();
  }

  async setBufferingReflectionFlag(id: string, isBuffering: boolean): Promise<void> {
    if (
      !this.db
        .select({ id: observationalMemory.id })
        .from(observationalMemory)
        .where(eq(observationalMemory.id, id))
        .get()
    )
      throw new Error(`OM record not found: ${id}`);
    this.db
      .update(observationalMemory)
      .set({ isBufferingReflection: isBuffering, updatedAt: Date.now() })
      .where(eq(observationalMemory.id, id))
      .run();
  }

  async clearObservationalMemory(threadId: string | null, resourceId: string): Promise<void> {
    this.db
      .delete(observationalMemory)
      .where(eq(observationalMemory.lookupKey, omLookupKey(threadId, resourceId)))
      .run();
  }

  async pruneHistory(threadId: string | null, resourceId: string, keepId: string): Promise<void> {
    this.db
      .delete(observationalMemory)
      .where(
        and(
          eq(observationalMemory.lookupKey, omLookupKey(threadId, resourceId)),
          ne(observationalMemory.id, keepId),
        ),
      )
      .run();
  }

  async setPendingMessageTokens(id: string, tokenCount: number): Promise<void> {
    if (
      !this.db
        .select({ id: observationalMemory.id })
        .from(observationalMemory)
        .where(eq(observationalMemory.id, id))
        .get()
    )
      throw new Error(`OM record not found: ${id}`);
    this.db
      .update(observationalMemory)
      .set({ pendingMessageTokens: tokenCount, updatedAt: Date.now() })
      .where(eq(observationalMemory.id, id))
      .run();
  }

  async updateObservationalMemoryConfig(
    input: UpdateObservationalMemoryConfigInput,
  ): Promise<void> {
    const row = this.db
      .select({ config: observationalMemory.config })
      .from(observationalMemory)
      .where(eq(observationalMemory.id, input.id))
      .get();
    if (!row) throw new Error(`OM record not found: ${input.id}`);
    const existing = parseJson<Record<string, unknown>>(row.config, {});
    const merged = deepMerge(existing, input.config);
    this.db
      .update(observationalMemory)
      .set({ config: JSON.stringify(merged), updatedAt: Date.now() })
      .where(eq(observationalMemory.id, input.id))
      .run();
  }
  async updateBufferedObservations(input: UpdateBufferedObservationsInput): Promise<void> {
    this.db.transaction((tx) => {
      const row = tx
        .select({ chunks: observationalMemory.bufferedObservationChunks })
        .from(observationalMemory)
        .where(eq(observationalMemory.id, input.id))
        .get();
      if (!row) throw new Error(`OM record not found: ${input.id}`);

      const existing = parseJson<BufferedObservationChunk[]>(row.chunks, []);
      // Adapter assigns id + createdAt before persisting (matches Mastra).
      const newChunk: BufferedObservationChunk = {
        id: `ombuf-${crypto.randomUUID()}`,
        cycleId: input.chunk.cycleId,
        observations: input.chunk.observations,
        tokenCount: input.chunk.tokenCount,
        messageIds: input.chunk.messageIds,
        messageTokens: input.chunk.messageTokens,
        lastObservedAt: input.chunk.lastObservedAt,
        createdAt: new Date(),
        ...(input.chunk.suggestedContinuation === undefined
          ? {}
          : { suggestedContinuation: input.chunk.suggestedContinuation }),
        ...(input.chunk.currentTask === undefined ? {} : { currentTask: input.chunk.currentTask }),
        ...(input.chunk.threadTitle === undefined ? {} : { threadTitle: input.chunk.threadTitle }),
      };
      const updated = [...existing, newChunk];

      const setData: Record<string, unknown> = {
        bufferedObservationChunks: JSON.stringify(updated),
        updatedAt: Date.now(),
      };
      if (input.lastBufferedAtTime !== undefined) {
        setData.lastBufferedAtTime = input.lastBufferedAtTime.getTime();
      }

      tx.update(observationalMemory).set(setData).where(eq(observationalMemory.id, input.id)).run();
    });
  }

  async swapBufferedToActive(
    input: SwapBufferedToActiveInput,
  ): Promise<SwapBufferedToActiveResult> {
    return this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(observationalMemory)
        .where(eq(observationalMemory.id, input.id))
        .get();
      if (!row) throw new Error(`OM record not found: ${input.id}`);

      const chunks = parseJson<BufferedObservationChunk[]>(row.bufferedObservationChunks, []);
      const empty: SwapBufferedToActiveResult = {
        chunksActivated: 0,
        messageTokensActivated: 0,
        observationTokensActivated: 0,
        messagesActivated: 0,
        activatedCycleIds: [],
        activatedMessageIds: [],
      };
      if (chunks.length === 0) return empty;

      // STEP 1: Compute target
      const retentionFloor = input.messageTokensThreshold * (1 - input.activationRatio);
      const targetMessageTokens = Math.max(0, input.currentPendingTokens - retentionFloor);

      // STEP 2: Find best chunk boundary
      let cumulativeMessageTokens = 0;
      let bestOverBoundary = 0;
      let bestOverTokens = 0;
      let bestUnderBoundary = 0;
      let bestUnderTokens = 0;

      for (let i = 0; i < chunks.length; i++) {
        cumulativeMessageTokens += chunks[i]!.messageTokens ?? 0;
        const boundary = i + 1;

        if (cumulativeMessageTokens >= targetMessageTokens) {
          if (bestOverBoundary === 0 || cumulativeMessageTokens < bestOverTokens) {
            bestOverBoundary = boundary;
            bestOverTokens = cumulativeMessageTokens;
          }
        } else {
          if (cumulativeMessageTokens > bestUnderTokens) {
            bestUnderBoundary = boundary;
            bestUnderTokens = cumulativeMessageTokens;
          }
        }
      }

      // STEP 3: Safeguard selection
      const maxOvershoot = retentionFloor * 0.95;
      const overshoot = bestOverTokens - targetMessageTokens;
      const remainingAfterOver = input.currentPendingTokens - bestOverTokens;
      const remainingAfterUnder = input.currentPendingTokens - bestUnderTokens;
      const minRemaining = Math.min(1000, retentionFloor);

      let chunksToActivate: number;
      if (input.forceMaxActivation && bestOverBoundary > 0 && remainingAfterOver >= minRemaining) {
        chunksToActivate = bestOverBoundary;
      } else if (
        bestOverBoundary > 0 &&
        overshoot <= maxOvershoot &&
        remainingAfterOver >= minRemaining
      ) {
        chunksToActivate = bestOverBoundary;
      } else if (bestUnderBoundary > 0 && remainingAfterUnder >= minRemaining) {
        chunksToActivate = bestUnderBoundary;
      } else if (bestOverBoundary > 0) {
        chunksToActivate = bestOverBoundary;
      } else {
        chunksToActivate = 1;
      }

      // STEP 4: Split
      const activatedChunks = chunks.slice(0, chunksToActivate);
      const remainingChunks = chunks.slice(chunksToActivate);

      // STEP 5: Compute aggregates
      const activatedContent = activatedChunks.map((c) => c.observations).join("\n\n");
      const activatedTokens = activatedChunks.reduce((sum, c) => sum + c.tokenCount, 0);
      const activatedMessageTokens = activatedChunks.reduce(
        (sum, c) => sum + (c.messageTokens ?? 0),
        0,
      );
      const activatedMessageCount = activatedChunks.reduce(
        (sum, c) => sum + c.messageIds.length,
        0,
      );
      const activatedCycleIds = activatedChunks
        .map((c) => c.cycleId)
        .filter((id): id is string => !!id);
      const activatedMessageIds = activatedChunks.flatMap((c) => c.messageIds);

      // Derive lastObservedAt from the latest activated chunk, or use provided value
      const latestChunk = activatedChunks[activatedChunks.length - 1];
      const lastObservedAt =
        input.lastObservedAt ??
        (latestChunk?.lastObservedAt ? new Date(latestChunk.lastObservedAt) : new Date());

      // STEP 6: Merge into activeObservations
      const now = Date.now();
      const existingActive = row.activeObservations ?? "";
      const boundary = existingActive
        ? `\n\n--- message boundary (${lastObservedAt.toISOString()}) ---\n\n`
        : "";
      const newActive = `${existingActive}${boundary}${activatedContent}`;

      const setData: Record<string, unknown> = {
        activeObservations: newActive,
        observationTokenCount: (row.observationTokenCount ?? 0) + activatedTokens,
        pendingMessageTokens: Math.max(0, (row.pendingMessageTokens ?? 0) - activatedMessageTokens),
        lastObservedAt: lastObservedAt.getTime(),
        updatedAt: now,
      };
      if (remainingChunks.length > 0) {
        setData.bufferedObservationChunks = JSON.stringify(remainingChunks);
      } else {
        setData.bufferedObservationChunks = null;
      }

      tx.update(observationalMemory).set(setData).where(eq(observationalMemory.id, input.id)).run();

      return {
        chunksActivated: activatedChunks.length,
        messageTokensActivated: activatedMessageTokens,
        observationTokensActivated: activatedTokens,
        messagesActivated: activatedMessageCount,
        activatedCycleIds,
        activatedMessageIds,
      };
    });
  }
  async clearBufferedObservations(id: string): Promise<void> {
    this.db
      .update(observationalMemory)
      .set({
        bufferedObservationChunks: null,
        updatedAt: Date.now(),
      })
      .where(eq(observationalMemory.id, id))
      .run();
  }
  async updateBufferedReflection(input: UpdateBufferedReflectionInput): Promise<void> {
    this.db.transaction((tx) => {
      const row = tx
        .select({
          reflection: observationalMemory.bufferedReflection,
          tokens: observationalMemory.bufferedReflectionTokens,
          inputTokens: observationalMemory.bufferedReflectionInputTokens,
        })
        .from(observationalMemory)
        .where(eq(observationalMemory.id, input.id))
        .get();
      if (!row) throw new Error(`OM record not found: ${input.id}`);

      // Accumulate (matches Mastra): append to existing reflection, add to token totals.
      const existingReflection = row.reflection ?? "";
      const newReflection =
        existingReflection !== ""
          ? `${existingReflection}\n\n${input.reflection}`
          : input.reflection;
      const newTokens = (row.tokens ?? 0) + input.tokenCount;
      const newInputTokens = (row.inputTokens ?? 0) + input.inputTokenCount;

      tx.update(observationalMemory)
        .set({
          bufferedReflection: newReflection,
          bufferedReflectionTokens: newTokens,
          bufferedReflectionInputTokens: newInputTokens,
          reflectedObservationLineCount: input.reflectedObservationLineCount,
          updatedAt: Date.now(),
        })
        .where(eq(observationalMemory.id, input.id))
        .run();
    });
  }

  async swapBufferedReflectionToActive(
    input: SwapBufferedReflectionToActiveInput,
  ): Promise<ObservationalMemoryRecord> {
    return this.db.transaction((tx) => {
      const id = input.currentRecord.id;
      const row = tx.select().from(observationalMemory).where(eq(observationalMemory.id, id)).get();
      if (!row) throw new Error(`OM record not found: ${id}`);
      if (!row.bufferedReflection) throw new Error("No buffered reflection to swap");

      const bufferedReflection = row.bufferedReflection;
      const reflectedLineCount = row.reflectedObservationLineCount ?? 0;

      // Lines 0..reflectedLineCount were reflected on → replaced by bufferedReflection.
      // Lines after reflectedLineCount were added after reflection started → kept as-is.
      const allLines = (row.activeObservations ?? "").split("\n");
      const unreflectedLines = allLines.slice(reflectedLineCount);
      const unreflectedContent = unreflectedLines.join("\n").trim();

      const newObservations = unreflectedContent
        ? `${bufferedReflection}\n\n${unreflectedContent}`
        : bufferedReflection;

      // Create new generation inside the same transaction (inlined so it shares `tx`).
      const c = input.currentRecord;
      const newId = crypto.randomUUID();
      const now = Date.now();
      tx.insert(observationalMemory)
        .values({
          id: newId,
          lookupKey: omLookupKey(c.threadId, c.resourceId),
          scope: c.scope,
          resourceId: c.resourceId,
          threadId: c.threadId,
          activeObservations: newObservations,
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

      // Clear buffered state on the old (current) record
      tx.update(observationalMemory)
        .set({
          bufferedReflection: null,
          bufferedReflectionTokens: null,
          bufferedReflectionInputTokens: null,
          reflectedObservationLineCount: null,
          updatedAt: now,
        })
        .where(eq(observationalMemory.id, id))
        .run();

      const created = tx
        .select()
        .from(observationalMemory)
        .where(eq(observationalMemory.id, newId))
        .get();
      if (!created) throw new Error(`OM record not found after insert: ${newId}`);
      return parseRecord(created);
    });
  }
}
