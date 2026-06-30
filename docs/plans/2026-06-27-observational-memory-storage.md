# Observational Memory Storage Adapter — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Prerequisite:** The schema plan (`docs/plans/2026-06-27-observational-memory-schema.md`) must be done first — this adapter reads/writes the `observational_memory` table it creates.

**Goal:** Implement sakti's Observational Memory **storage adapter** — the DB-facing class that owns all reads/writes to the `observational_memory` table, mirroring Mastra's `MemoryStorage` OM contract so the future OM processor (Observer/Reflector loop) ports with minimal friction.

**Architecture:** Two packages, matching sakti's existing storage split (interface in agent, impl in db):

- `packages/agent` — owns the `ObservationalMemoryStorage` **interface** + `ObservationalMemoryRecord`/input types (parallel to how `SessionStorage` lives in `harness/types.ts`).
- `packages/db` — owns `SqliteObservationalMemoryStorage`, a Drizzle impl over `node:sqlite` (parallel to `SqliteSessionStorage`).

The adapter speaks **Mastra's method names and signatures verbatim** (e.g. `getObservationalMemory(threadId, resourceId)`) so the processor port is mechanical. The glossary already maps: `threadId` = a sakti session id, `resourceId` = a sakti project id. The table columns (`thread_id`/`resource_id`) are the same mapping.

**Scope decisions (decided upfront, do not re-litigate during execution):**

1. **OM-record table only.** This adapter owns the `observational_memory` table — it does **NOT** implement Mastra's `listMessages*`. The future processor obtains messages-to-observe via the existing `SessionStorage.getPathToRoot(leafId)` + filtering `kind === "message"`. This avoids coupling the adapter to `session_entries` and reuses the recursive-CTE leaf-path logic that already exists.
2. **Session-scoped (thread) only**, matching the schema plan. `resourceId` is still stored (always present, per Mastra) but lookups are by `thread:{sessionId}`. Resource-scope is a later additive change.
3. **Full contract (17 methods)** ported, but phased so execution can pause between phases. The synchronous path (Phase A–C) is what a minimal processor needs; async buffering (Phase D–E) is the optimization.
4. **Synchronous simplification.** `node:sqlite` is synchronous + WAL, so the read-modify-write methods (`swapBuffered*`) use `db.transaction()` for atomicity instead of Mastra's optimistic-concurrency `WHERE bufferedObservationChunks IS NOT NULL` guard. This is safer and simpler; drop the optimistic guard.
5. **Timestamp boundary translation.** Table stores epoch-ms integers (per schema plan); the adapter exposes `Date` in its TS API (parse on read, `.getTime()` on write) to match Mastra types and the ported processor.
6. **JSON boundary translation.** Table stores JSON-in-`text`; adapter serializes/parse to objects/arrays.
7. **No deprecated fields.** `bufferedObservations` / `bufferedObservationTokens` / `bufferedMessageIds` (Mastra `@deprecated`) are not implemented — only `bufferedObservationChunks`.

**Tech Stack:** `node:sqlite`, Drizzle ORM (node-sqlite dialect), vitest, pnpm. `exactOptionalPropertyTypes: true` is on.

**Mastra source of truth (verify shapes against these if uncertain):**

- Record type: `openspec/references/mastra/packages/core/src/storage/types.ts:1129`
- Input types: `openspec/references/mastra/packages/core/src/storage/types.ts:1255` onward (`CreateObservationalMemoryInput`, `UpdateActiveObservationsInput`, `SwapBufferedToActiveInput`, `CreateReflectionGenerationInput`, etc.)
- Abstract contract: `openspec/references/mastra/packages/core/src/storage/domains/memory/base.ts:175`
- LibSQL reference impl: `openspec/references/mastra/stores/libsql/src/storage/domains/memory/index.ts:1536` (OM methods start here)

---

## lookupKey convention

Mirrors Mastra's `getOMKey`. Define once, use everywhere:

```ts
function omLookupKey(threadId: string | null, resourceId: string): string {
  return threadId ? `thread:${threadId}` : `resource:${resourceId}`;
}
```

"Current" record = latest by `generationCount DESC` (Mastra orders by `generationCount`, not `updatedAt` — follow that). History = all rows for the key, `generationCount DESC`.

---

## Task 1: Types + interface in `packages/agent`

**Files:**

- Create: `packages/agent/src/harness/observational-memory-storage.ts`
- Modify: `packages/agent/src/index.ts` (re-export)

### Step 1: Create the types + interface file

Create `packages/agent/src/harness/observational-memory-storage.ts`:

```ts
/**
 * Observational Memory storage contract.
 *
 * Mirrors Mastra's `MemoryStorage` OM methods so the OM processor ports with
 * minimal friction. Vocabulary mapping (see schema glossary):
 *   - `threadId`   = a sakti `sessions.id`
 *   - `resourceId` = a sakti `projects.id`
 *   - `observedMessageIds` = `session_entries.id` of message-kind entries
 *
 * Session-scoped (thread) only in v1. `resourceId` is always present (stored),
 * but lookups are keyed by `thread:{threadId}`.
 *
 * This adapter owns ONLY the `observational_memory` table. To find messages
 * to observe, the processor uses `SessionStorage.getPathToRoot(leafId)` and
 * filters `kind === "message"`.
 */

export type ObservationalMemoryScope = "thread" | "resource";
export type ObservationalMemoryOriginType =
  | "initial"
  | "initialization"
  | "observation"
  | "reflection";

export interface BufferedObservationChunk {
  cycleId?: string;
  observations: string;
  tokenCount: number;
  messageTokens?: number;
  messageIds: string[];
  lastObservedAt?: string; // ISO
}

export interface ObservationalMemoryRecord {
  id: string;
  scope: ObservationalMemoryScope;
  threadId: string | null;
  resourceId: string;

  createdAt: Date;
  updatedAt: Date;
  lastObservedAt?: Date;
  lastReflectionAt?: Date;

  originType: ObservationalMemoryOriginType;
  generationCount: number;

  activeObservations: string;
  activeObservationsPendingUpdate?: string;
  bufferedObservationChunks?: BufferedObservationChunk[];
  bufferedReflection?: string;
  bufferedReflectionTokens?: number;
  bufferedReflectionInputTokens?: number;
  reflectedObservationLineCount?: number;
  observedMessageIds?: string[];
  observedTimezone?: string;

  totalTokensObserved: number;
  observationTokenCount: number;
  pendingMessageTokens: number;

  isObserving: boolean;
  isReflecting: boolean;
  isBufferingObservation: boolean;
  isBufferingReflection: boolean;
  lastBufferedAtTokens: number;
  lastBufferedAtTime?: Date | null;

  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ObservationalMemoryHistoryOptions {
  from?: Date;
  to?: Date;
  offset?: number;
}

export interface CreateObservationalMemoryInput {
  threadId: string | null;
  resourceId: string;
  scope: ObservationalMemoryScope;
  config: Record<string, unknown>;
  observedTimezone?: string;
}

export interface UpdateActiveObservationsInput {
  id: string;
  observations: string;
  lastObservedAt: Date;
  tokenCount: number;
  observedMessageIds?: string[];
}

export interface CreateReflectionGenerationInput {
  currentRecord: ObservationalMemoryRecord;
  reflection: string;
  tokenCount: number;
}

export interface SwapBufferedToActiveInput {
  id: string;
  messageTokensThreshold: number;
  activationRatio: number;
  currentPendingTokens: number;
  forceMaxActivation: boolean;
  lastObservedAt?: Date;
}

export interface SwapBufferedToActiveResult {
  chunksActivated: number;
  messageTokensActivated: number;
  observationTokensActivated: number;
  messagesActivated: number;
  activatedCycleIds: string[];
  activatedMessageIds: string[];
}

export interface UpdateBufferedObservationsInput {
  id: string;
  chunks: BufferedObservationChunk[];
  mode: "replace" | "append";
  lastBufferedAtTokens?: number;
  lastBufferedAtTime?: Date | null;
}

export interface UpdateBufferedReflectionInput {
  id: string;
  reflection: string;
  reflectionTokens?: number;
  reflectionInputTokens?: number;
  reflectedObservationLineCount?: number;
}

export interface SwapBufferedReflectionToActiveInput {
  id: string;
  currentRecord: ObservationalMemoryRecord;
  tokenCount: number;
}

export interface UpdateObservationalMemoryConfigInput {
  id: string;
  config: Record<string, unknown>;
}

export interface ObservationalMemoryStorage {
  getObservationalMemory(
    threadId: string | null,
    resourceId: string,
  ): Promise<ObservationalMemoryRecord | null>;
  getObservationalMemoryHistory(
    threadId: string | null,
    resourceId: string,
    limit?: number,
    options?: ObservationalMemoryHistoryOptions,
  ): Promise<ObservationalMemoryRecord[]>;
  initializeObservationalMemory(
    input: CreateObservationalMemoryInput,
  ): Promise<ObservationalMemoryRecord>;
  insertObservationalMemoryRecord(record: ObservationalMemoryRecord): Promise<void>;
  updateActiveObservations(input: UpdateActiveObservationsInput): Promise<void>;
  createReflectionGeneration(
    input: CreateReflectionGenerationInput,
  ): Promise<ObservationalMemoryRecord>;
  setReflectingFlag(id: string, isReflecting: boolean): Promise<void>;
  setObservingFlag(id: string, isObserving: boolean): Promise<void>;
  setBufferingObservationFlag(
    id: string,
    isBuffering: boolean,
    lastBufferedAtTokens?: number,
  ): Promise<void>;
  setBufferingReflectionFlag(id: string, isBuffering: boolean): Promise<void>;
  clearObservationalMemory(threadId: string | null, resourceId: string): Promise<void>;
  setPendingMessageTokens(id: string, tokenCount: number): Promise<void>;
  updateObservationalMemoryConfig(input: UpdateObservationalMemoryConfigInput): Promise<void>;
  updateBufferedObservations(input: UpdateBufferedObservationsInput): Promise<void>;
  swapBufferedToActive(input: SwapBufferedToActiveInput): Promise<SwapBufferedToActiveResult>;
  updateBufferedReflection(input: UpdateBufferedReflectionInput): Promise<void>;
  swapBufferedReflectionToActive(
    input: SwapBufferedReflectionToActiveInput,
  ): Promise<ObservationalMemoryRecord>;
}
```

### Step 2: Re-export from the agent package

In `packages/agent/src/index.ts`, add (near the other harness type exports):

```ts
export type {
  BufferedObservationChunk,
  CreateObservationalMemoryInput,
  CreateReflectionGenerationInput,
  ObservationalMemoryHistoryOptions,
  ObservationalMemoryOriginType,
  ObservationalMemoryRecord,
  ObservationalMemoryScope,
  ObservationalMemoryStorage,
  SwapBufferedReflectionToActiveInput,
  SwapBufferedToActiveInput,
  SwapBufferedToActiveResult,
  UpdateActiveObservationsInput,
  UpdateBufferedObservationsInput,
  UpdateBufferedReflectionInput,
  UpdateObservationalMemoryConfigInput,
} from "./harness/observational-memory-storage.ts";
```

### Step 3: Verify + commit

Run: `cd packages/agent && pnpm typecheck`
Expected: PASS (types only, no impl yet).

```bash
git add packages/agent/src/harness/observational-memory-storage.ts packages/agent/src/index.ts
git commit -m "feat(agent): add ObservationalMemoryStorage interface and types"
```

---

## Task 2: Impl skeleton + read methods (`getObservationalMemory`, `getObservationalMemoryHistory`)

**Files:**

- Create: `packages/db/src/observational-memory-store.ts`
- Create: `packages/db/src/__tests__/observational-memory-store.test.ts`
- Modify: `packages/db/src/index.ts` (export the class)

### Step 1: Write the failing test

Create `packages/db/src/__tests__/observational-memory-store.test.ts`. This file will grow across tasks; start with read tests (which fail until a record exists / methods exist).

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initDatabase } from "../init";
import { SqliteObservationalMemoryStorage } from "../observational-memory-store";

describe("SqliteObservationalMemoryStorage — reads", () => {
  let db: DatabaseSync;
  let tmpDir: string;
  let store: SqliteObservationalMemoryStorage;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "om-store-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
    const drizzle = await initDatabase(db);
    // FK parents
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?,?,?,?,?)",
    ).run("proj1", "P", "/tmp/p", 1, 1);
    db.prepare(
      "INSERT INTO sessions (id, project_id, kind, thinking_level, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).run("sess1", "proj1", "task", "off", 1, 1);
    store = new SqliteObservationalMemoryStorage(drizzle);
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("getObservationalMemory returns null when none exists", async () => {
    const got = await store.getObservationalMemory("sess1", "proj1");
    expect(got).toBeNull();
  });

  test("initializeObservationalMemory then get returns the record", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess1",
      resourceId: "proj1",
      scope: "thread",
      config: { observation: { messageTokens: 30000 } },
    });
    expect(created.generationCount).toBe(0);
    expect(created.originType).toBe("initial");

    const got = await store.getObservationalMemory("sess1", "proj1");
    expect(got).not.toBeNull();
    expect(got!.id).toBe(created.id);
    expect(got!.activeObservations).toBe("");
    expect(got!.isObserving).toBe(false);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-store.test.ts`
Expected: FAIL — `Cannot find module '../observational-memory-store'`.

### Step 3: Implement skeleton + read/init methods

Create `packages/db/src/observational-memory-store.ts`:

```ts
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type {
  CreateObservationalMemoryInput,
  ObservationalMemoryHistoryOptions,
  ObservationalMemoryRecord,
  ObservationalMemoryStorage,
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
    lastObservedAt: toDate(row.lastObservedAt),
    lastReflectionAt: toDate(row.lastReflectionAt),
    originType: row.originType as ObservationalMemoryRecord["originType"],
    generationCount: row.generationCount,
    activeObservations: row.activeObservations,
    activeObservationsPendingUpdate: row.activeObservationsPendingUpdate ?? undefined,
    bufferedObservationChunks: parseJson(row.bufferedObservationChunks, undefined),
    bufferedReflection: row.bufferedReflection ?? undefined,
    bufferedReflectionTokens: row.bufferedReflectionTokens ?? undefined,
    bufferedReflectionInputTokens: row.bufferedReflectionInputTokens ?? undefined,
    reflectedObservationLineCount: row.reflectedObservationLineCount ?? undefined,
    observedMessageIds: parseJson(row.observedMessageIds, undefined),
    observedTimezone: row.observedTimezone ?? undefined,
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
    metadata: parseJson(row.metadata, undefined),
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
    let query = this.db
      .select()
      .from(observationalMemory)
      .where(and(...conditions))
      .orderBy(desc(observationalMemory.generationCount))
      .limit(limit);
    if (options?.offset != null) query = query.offset(options.offset);
    return query.all().map(parseRecord);
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

  // Remaining methods are added in later tasks. Stub them to satisfy the interface:
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
  async swapBufferedToActive() {
    throw new Error("not implemented");
  }
  async updateBufferedReflection(): Promise<void> {
    throw new Error("not implemented");
  }
  async swapBufferedReflectionToActive(): Promise<ObservationalMemoryRecord> {
    throw new Error("not implemented");
  }
}
```

### Step 4: Export from the db package

In `packages/db/src/index.ts`, add:

```ts
export { SqliteObservationalMemoryStorage } from "./observational-memory-store.ts";
```

### Step 5: Run test to verify it passes

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-store.test.ts`
Expected: PASS.

### Step 6: Commit

```bash
git add packages/db/src/observational-memory-store.ts \
        packages/db/src/__tests__/observational-memory-store.test.ts \
        packages/db/src/index.ts
git commit -m "feat(db): add SqliteObservationalMemoryStorage skeleton with read methods"
```

---

## Task 3: Mutation core — `updateActiveObservations`, `createReflectionGeneration`, `insertObservationalMemoryRecord`

**Files:**

- Modify: `packages/db/src/observational-memory-store.ts` (replace the 3 stubs)
- Modify: `packages/db/src/__tests__/observational-memory-store.test.ts` (add a `describe("mutations")` block)

### Step 1: Write failing tests

Add to the test file (new `describe`; reuse the `store`/`db` from `beforeAll`, or spin a fresh store per test — keep it simple, the table persists across tests in this file so create records with distinct thread ids to avoid collisions):

```ts
describe("SqliteObservationalMemoryStorage — mutations (sync path)", () => {
  test("updateActiveObservations updates content, resets pending, accumulates totals", async () => {
    const created = await store.initializeObservationalMemory({
      threadId: "sess-mut",
      resourceId: "proj1",
      scope: "thread",
      config: {},
    });
    const observedAt = new Date(2_000_000_000_000);
    await store.updateActiveObservations({
      id: created.id,
      observations: "did X",
      lastObservedAt: observedAt,
      tokenCount: 42,
      observedMessageIds: ["e1", "e2"],
    });
    const got = await store.getObservationalMemory("sess-mut", "proj1");
    expect(got!.activeObservations).toBe("did X");
    expect(got!.pendingMessageTokens).toBe(0);
    expect(got!.observationTokenCount).toBe(42);
    expect(got!.totalTokensObserved).toBe(42);
    expect(got!.observedMessageIds).toEqual(["e1", "e2"]);
    expect(got!.lastObservedAt?.getTime()).toBe(observedAt.getTime());
  });

  test("updateActiveObservations throws on unknown id", async () => {
    await expect(
      store.updateActiveObservations({
        id: "nope",
        observations: "x",
        lastObservedAt: new Date(),
        tokenCount: 1,
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("createReflectionGeneration inserts a new generation row", async () => {
    const current = await store.getObservationalMemory("sess-mut", "proj1");
    expect(current).not.toBeNull();
    const reflected = await store.createReflectionGeneration({
      currentRecord: current!,
      reflection: "condensed",
      tokenCount: 7,
    });
    expect(reflected.originType).toBe("reflection");
    expect(reflected.generationCount).toBe(current!.generationCount + 1);
    expect(reflected.activeObservations).toBe("condensed");
    expect(reflected.observationTokenCount).toBe(7);
    expect(reflected.pendingMessageTokens).toBe(0);

    const got = await store.getObservationalMemory("sess-mut", "proj1");
    expect(got!.id).toBe(reflected.id); // latest by generationCount
    expect(got!.generationCount).toBe(current!.generationCount + 1);
  });

  test("getObservationalMemoryHistory returns generations newest-first", async () => {
    const history = await store.getObservationalMemoryHistory("sess-mut", "proj1");
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]!.generationCount).toBeGreaterThan(
      history[history.length - 1]!.generationCount,
    );
  });

  test("insertObservationalMemoryRecord writes a fully-formed record verbatim", async () => {
    const now = new Date();
    const record: import("@sakti-code/agent").ObservationalMemoryRecord = {
      id: "verbatim-1",
      scope: "thread",
      threadId: "sess-verb",
      resourceId: "proj1",
      createdAt: now,
      updatedAt: now,
      originType: "observation",
      generationCount: 5,
      activeObservations: "raw",
      totalTokensObserved: 100,
      observationTokenCount: 50,
      pendingMessageTokens: 3,
      isObserving: false,
      isReflecting: false,
      isBufferingObservation: false,
      isBufferingReflection: false,
      lastBufferedAtTokens: 0,
      lastBufferedAtTime: null,
      config: { k: "v" },
      metadata: { m: 1 },
      observedMessageIds: ["a"],
    };
    await store.insertObservationalMemoryRecord(record);
    const got = await store.getObservationalMemory("sess-verb", "proj1");
    expect(got!.id).toBe("verbatim-1");
    expect(got!.generationCount).toBe(5);
    expect(got!.config).toEqual({ k: "v" });
    expect(got!.metadata).toEqual({ m: 1 });
  });
});
```

### Step 2: Run to verify failure

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-store.test.ts`
Expected: FAIL — `not implemented`.

### Step 3: Implement the three methods

Replace the three stubs in `observational-memory-store.ts`:

```ts
async insertObservationalMemoryRecord(
  record: ObservationalMemoryRecord
): Promise<void> {
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
        : {
            bufferedObservationChunks: JSON.stringify(
              record.bufferedObservationChunks
            ),
          }),
      ...(record.bufferedReflection === undefined
        ? {}
        : { bufferedReflection: record.bufferedReflection }),
      ...(record.bufferedReflectionTokens === undefined
        ? {}
        : { bufferedReflectionTokens: record.bufferedReflectionTokens }),
      ...(record.bufferedReflectionInputTokens === undefined
        ? {}
        : {
            bufferedReflectionInputTokens:
              record.bufferedReflectionInputTokens,
          }),
      ...(record.reflectedObservationLineCount === undefined
        ? {}
        : {
            reflectedObservationLineCount:
              record.reflectedObservationLineCount,
          }),
      ...(record.observedMessageIds === undefined
        ? {}
        : {
            observedMessageIds: JSON.stringify(record.observedMessageIds),
          }),
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
      ...(record.metadata === undefined
        ? {}
        : { metadata: JSON.stringify(record.metadata) }),
      createdAt: record.createdAt.getTime(),
      updatedAt: record.updatedAt.getTime(),
    })
    .run();
}

async updateActiveObservations(input: UpdateActiveObservationsInput): Promise<void> {
  const result = this.db
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
  if (result.rowsAffected === 0) {
    throw new Error(`Observational memory record not found: ${input.id}`);
  }
}

async createReflectionGeneration(
  input: CreateReflectionGenerationInput
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
      ...(c.lastObservedAt === undefined
        ? {}
        : { lastObservedAt: c.lastObservedAt.getTime() }),
      lastReflectionAt: now,
      ...(c.observedTimezone === undefined
        ? {}
        : { observedTimezone: c.observedTimezone }),
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
```

Add the missing imports at the top: `UpdateActiveObservationsInput`, `CreateReflectionGenerationInput` to the `@sakti-code/agent` type import.

### Step 4: Run tests to verify pass

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-store.test.ts`
Expected: all PASS.

### Step 5: Commit

```bash
git add packages/db/src/observational-memory-store.ts \
        packages/db/src/__tests__/observational-memory-store.test.ts
git commit -m "feat(db): OM storage sync mutations (updateActive, reflection generation, insert)"
```

---

## Task 4: Flags, clear, pending tokens, config

**Files:**

- Modify: `packages/db/src/observational-memory-store.ts` (replace 7 stubs)
- Modify: `packages/db/src/__tests__/observational-memory-store.test.ts`

### Step 1: Write failing tests

Add a `describe("SqliteObservationalMemoryStorage — flags & maintenance")` block covering:

- `setObservingFlag(id, true)` → `getObservationalMemory` reflects `isObserving: true`; `updatedAt` advanced.
- same for `setReflectingFlag`.
- `setBufferingObservationFlag(id, true, 1234)` → `isBufferingObservation: true`, `lastBufferedAtTokens: 1234`; then `setBufferingObservationFlag(id, false)` leaves `lastBufferedAtTokens` at 1234 (only set when turning on).
- `setBufferingReflectionFlag(id, true)` / false.
- each flag setter throws on unknown id.
- `setPendingMessageTokens(id, 999)` → reflected; throws on unknown id.
- `updateObservationalMemoryConfig({ id, config: { new: 1 } })` → `getObservationalMemory().config` deep-merges into existing config (existing keys retained unless overwritten).
- `clearObservationalMemory("sess-flags", "proj1")` → subsequent `getObservationalMemory` returns null and `getObservationalMemoryHistory` returns `[]`.

Use distinct thread ids per test (e.g. `sess-flags`, `sess-pend`, `sess-cfg`, `sess-clear`) to avoid cross-test collision, initializing a record first in each.

### Step 2: Run to verify failure

Expected: FAIL — `not implemented`.

### Step 3: Implement

Replace the 7 stubs:

```ts
async setReflectingFlag(id: string, isReflecting: boolean): Promise<void> {
  const result = this.db
    .update(observationalMemory)
    .set({ isReflecting, updatedAt: Date.now() })
    .where(eq(observationalMemory.id, id))
    .run();
  if (result.rowsAffected === 0) throw new Error(`OM record not found: ${id}`);
}

async setObservingFlag(id: string, isObserving: boolean): Promise<void> {
  const result = this.db
    .update(observationalMemory)
    .set({ isObserving, updatedAt: Date.now() })
    .where(eq(observationalMemory.id, id))
    .run();
  if (result.rowsAffected === 0) throw new Error(`OM record not found: ${id}`);
}

async setBufferingObservationFlag(
  id: string,
  isBuffering: boolean,
  lastBufferedAtTokens?: number
): Promise<void> {
  const result = this.db
    .update(observationalMemory)
    .set({
      isBufferingObservation: isBuffering,
      ...(isBuffering && lastBufferedAtTokens !== undefined
        ? { lastBufferedAtTokens }
        : {}),
      updatedAt: Date.now(),
    })
    .where(eq(observationalMemory.id, id))
    .run();
  if (result.rowsAffected === 0) throw new Error(`OM record not found: ${id}`);
}

async setBufferingReflectionFlag(
  id: string,
  isBuffering: boolean
): Promise<void> {
  const result = this.db
    .update(observationalMemory)
    .set({ isBufferingReflection: isBuffering, updatedAt: Date.now() })
    .where(eq(observationalMemory.id, id))
    .run();
  if (result.rowsAffected === 0) throw new Error(`OM record not found: ${id}`);
}

async clearObservationalMemory(
  threadId: string | null,
  resourceId: string
): Promise<void> {
  this.db
    .delete(observationalMemory)
    .where(
      eq(observationalMemory.lookupKey, omLookupKey(threadId, resourceId))
    )
    .run();
}

async setPendingMessageTokens(id: string, tokenCount: number): Promise<void> {
  const result = this.db
    .update(observationalMemory)
    .set({ pendingMessageTokens: tokenCount, updatedAt: Date.now() })
    .where(eq(observationalMemory.id, id))
    .run();
  if (result.rowsAffected === 0) throw new Error(`OM record not found: ${id}`);
}

async updateObservationalMemoryConfig(
  input: UpdateObservationalMemoryConfigInput
): Promise<void> {
  // Deep-merge input.config into existing config (matches Mastra semantics).
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
```

Add a `deepMerge` helper near `parseJson`:

```ts
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
```

Add `UpdateObservationalMemoryConfigInput` to the type import.

### Step 4: Run + commit

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-store.test.ts` → PASS.

```bash
git add packages/db/src/observational-memory-store.ts \
        packages/db/src/__tests__/observational-memory-store.test.ts
git commit -m "feat(db): OM storage flags, clear, pending tokens, config merge"
```

---

## Task 5: Async buffered observations — `updateBufferedObservations`, `swapBufferedToActive`

These are the non-trivial ones. `swapBufferedToActive` ports Mastra's chunk-boundary selection math (`stores/libsql/.../memory/index.ts:2254-2386`), but uses `db.transaction()` instead of optimistic concurrency.

**Files:**

- Modify: `packages/db/src/observational-memory-store.ts` (replace 2 stubs)
- Modify: `packages/db/src/__tests__/observational-memory-store.test.ts`

### Step 1: Write failing tests

Add `describe("SqliteObservationalMemoryStorage — buffered observations")`:

- `updateBufferedObservations({ mode: "replace", chunks: [chunkA] })` → `getObservationalMemory().bufferedObservationChunks` equals `[chunkA]`.
- `updateBufferedObservations({ mode: "append", chunks: [chunkB] })` after the above → chunks equal `[chunkA, chunkB]`; `lastBufferedAtTokens` updated when provided.
- `swapBufferedToActive` with two chunks where activation lands mid-way → returns `chunksActivated`, `messagesActivated`, etc.; after swap, `bufferedObservationChunks` holds only the remainder, `activeObservations` grew by the boundary-joined content, `pendingMessageTokens` decremented, `lastObservedAt` advanced.
- `swapBufferedToActive` when there are zero buffered chunks → returns all-zero result, no state change.
- `swapBufferedToActive` unknown id → throws.

(Use chunk fixtures with known `messageTokens`, `tokenCount`, `messageIds` so the boundary math is deterministic. Keep `activationRatio` at e.g. `0.8` and `messageTokensThreshold` at a value that makes `chunksToActivate` predictable; assert the exact remainder.)

### Step 2: Run to verify failure → `not implemented`.

### Step 3: Implement `updateBufferedObservations`

```ts
async updateBufferedObservations(
  input: UpdateBufferedObservationsInput
): Promise<void> {
  this.db.transaction((tx) => {
    const row = tx
      .select({ chunks: observationalMemory.bufferedObservationChunks })
      .from(observationalMemory)
      .where(eq(observationalMemory.id, input.id))
      .get();
    if (!row) throw new Error(`OM record not found: ${input.id}`);
    const existing = parseJson<typeof input.chunks>(row.chunks, []);
    const next =
      input.mode === "append" ? [...existing, ...input.chunks] : input.chunks;
    tx.update(observationalMemory)
      .set({
        bufferedObservationChunks:
          next.length > 0 ? JSON.stringify(next) : null,
        ...(input.lastBufferedAtTokens === undefined
          ? {}
          : { lastBufferedAtTokens: input.lastBufferedAtTokens }),
        ...(input.lastBufferedAtTime === undefined
          ? {}
          : {
              lastBufferedAtTime:
                input.lastBufferedAtTime === null
                  ? null
                  : input.lastBufferedAtTime.getTime(),
            }),
        updatedAt: Date.now(),
      })
      .where(eq(observationalMemory.id, input.id))
      .run();
  });
}
```

### Step 4: Implement `swapBufferedToActive`

Port the boundary-selection algorithm from Mastra (`memory/index.ts:2254-2316`), then apply the swap inside a transaction. Full implementation:

```ts
async swapBufferedToActive(
  input: SwapBufferedToActiveInput
): Promise<SwapBufferedToActiveResult> {
  return this.db.transaction((tx) => {
    const row = tx
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.id, input.id))
      .get();
    if (!row) throw new Error(`OM record not found: ${input.id}`);

    const chunks = parseJson<BufferedObservationChunk[]>(
      row.bufferedObservationChunks,
      []
    );
    const empty: SwapBufferedToActiveResult = {
      chunksActivated: 0,
      messageTokensActivated: 0,
      observationTokensActivated: 0,
      messagesActivated: 0,
      activatedCycleIds: [],
      activatedMessageIds: [],
    };
    if (chunks.length === 0) return empty;

    // Boundary selection (port of Mastra memory/index.ts:2254-2316).
    const retentionFloor =
      input.messageTokensThreshold * (1 - input.activationRatio);
    const targetMessageTokens = Math.max(
      0,
      input.currentPendingTokens - retentionFloor
    );
    let cumulative = 0;
    let bestOverBoundary = 0;
    let bestOverTokens = 0;
    let bestUnderBoundary = 0;
    let bestUnderTokens = 0;
    for (let i = 0; i < chunks.length; i++) {
      cumulative += chunks[i]!.messageTokens ?? 0;
      const boundary = i + 1;
      if (cumulative >= targetMessageTokens) {
        if (bestOverBoundary === 0 || cumulative < bestOverTokens) {
          bestOverBoundary = boundary;
          bestOverTokens = cumulative;
        }
      } else if (cumulative > bestUnderTokens) {
        bestUnderBoundary = boundary;
        bestUnderTokens = cumulative;
      }
    }
    const maxOvershoot = retentionFloor * 0.95;
    const overshoot = bestOverTokens - targetMessageTokens;
    const remainingAfterOver = input.currentPendingTokens - bestOverTokens;
    const remainingAfterUnder = input.currentPendingTokens - bestUnderTokens;
    const minRemaining = Math.min(1000, retentionFloor);
    let chunksToActivate: number;
    if (
      input.forceMaxActivation &&
      bestOverBoundary > 0 &&
      remainingAfterOver >= minRemaining
    ) {
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

    const activated = chunks.slice(0, chunksToActivate);
    const remaining = chunks.slice(chunksToActivate);
    const activatedContent = activated
      .map((c) => c.observations)
      .join("\n\n");
    const activatedTokens = activated.reduce(
      (s, c) => s + c.tokenCount,
      0
    );
    const activatedMessageTokens = activated.reduce(
      (s, c) => s + (c.messageTokens ?? 0),
      0
    );
    const messagesActivated = activated.reduce(
      (s, c) => s + c.messageIds.length,
      0
    );
    const activatedCycleIds = activated
      .map((c) => c.cycleId)
      .filter((x): x is string => !!x);
    const activatedMessageIds = activated.flatMap((c) => c.messageIds);

    const latest = activated[activated.length - 1];
    const lastObservedAt =
      input.lastObservedAt ??
      (latest?.lastObservedAt ? new Date(latest.lastObservedAt) : new Date());

    const existingActive = row.activeObservations || "";
    const boundary = `\n\n--- message boundary (${lastObservedAt.toISOString()}) ---\n\n`;
    const newActive = existingActive
      ? `${existingActive}${boundary}${activatedContent}`
      : activatedContent;
    const newTokenCount = row.observationTokenCount + activatedTokens;
    const newPending = Math.max(
      0,
      row.pendingMessageTokens - activatedMessageTokens
    );

    tx.update(observationalMemory)
      .set({
        activeObservations: newActive,
        observationTokenCount: newTokenCount,
        pendingMessageTokens: newPending,
        bufferedObservationChunks:
          remaining.length > 0 ? JSON.stringify(remaining) : null,
        lastObservedAt: lastObservedAt.getTime(),
        updatedAt: Date.now(),
      })
      .where(eq(observationalMemory.id, input.id))
      .run();

    return {
      chunksActivated: activated.length,
      messageTokensActivated: activatedMessageTokens,
      observationTokensActivated: activatedTokens,
      messagesActivated,
      activatedCycleIds,
      activatedMessageIds,
    };
  });
}
```

Add imports: `BufferedObservationChunk`, `SwapBufferedToActiveInput`, `SwapBufferedToActiveResult`, `UpdateBufferedObservationsInput`.

### Step 5: Run + commit

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-store.test.ts` → PASS.

```bash
git add packages/db/src/observational-memory-store.ts \
        packages/db/src/__tests__/observational-memory-store.test.ts
git commit -m "feat(db): OM storage buffered-observation update + swap-to-active"
```

---

## Task 6: Async reflection — `updateBufferedReflection`, `swapBufferedReflectionToActive`

**Files:**

- Modify: `packages/db/src/observational-memory-store.ts` (replace last 2 stubs)
- Modify: `packages/db/src/__tests__/observational-memory-store.test.ts`

### Step 1: Write failing tests

Add `describe("SqliteObservationalMemoryStorage — buffered reflection")`:

- `updateBufferedReflection({ id, reflection, reflectionTokens, reflectionInputTokens, reflectedObservationLineCount })` → fields persisted.
- `swapBufferedReflectionToActive` → creates a NEW generation (`generationCount+1`, `originType: "reflection"`) whose `activeObservations` is the buffered reflection, `pendingMessageTokens: 0`, `observationTokenCount: tokenCount`, and clears `bufferedReflection` / `bufferedReflectionTokens` / `bufferedReflectionInputTokens` / `reflectedObservationLineCount` on the resulting current record. Assert `getObservationalMemory` returns the new generation.

### Step 2: Run to verify failure → `not implemented`.

### Step 3: Implement

```ts
async updateBufferedReflection(
  input: UpdateBufferedReflectionInput
): Promise<void> {
  const result = this.db
    .update(observationalMemory)
    .set({
      bufferedReflection: input.reflection,
      ...(input.reflectionTokens === undefined
        ? {}
        : { bufferedReflectionTokens: input.reflectionTokens }),
      ...(input.reflectionInputTokens === undefined
        ? {}
        : { bufferedReflectionInputTokens: input.reflectionInputTokens }),
      ...(input.reflectedObservationLineCount === undefined
        ? {}
        : {
            reflectedObservationLineCount: input.reflectedObservationLineCount,
          }),
      updatedAt: Date.now(),
    })
    .where(eq(observationalMemory.id, input.id))
    .run();
  if (result.rowsAffected === 0) throw new Error(`OM record not found: ${input.id}`);
}

async swapBufferedReflectionToActive(
  input: SwapBufferedReflectionToActiveInput
): Promise<ObservationalMemoryRecord> {
  return this.db.transaction((tx) => {
    const row = tx
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.id, input.id))
      .get();
    if (!row) throw new Error(`OM record not found: ${input.id}`);
    const c = input.currentRecord;
    const id = crypto.randomUUID();
    const now = Date.now();
    tx.insert(observationalMemory)
      .values({
        id,
        lookupKey: row.lookupKey,
        scope: row.scope,
        resourceId: row.resourceId,
        threadId: row.threadId,
        activeObservations: row.bufferedReflection ?? "",
        originType: "reflection",
        generationCount: row.generationCount + 1,
        config: row.config,
        pendingMessageTokens: 0,
        totalTokensObserved: row.totalTokensObserved,
        observationTokenCount: input.tokenCount,
        isObserving: false,
        isReflecting: false,
        isBufferingObservation: false,
        isBufferingReflection: false,
        lastBufferedAtTokens: 0,
        lastObservedAt: row.lastObservedAt,
        lastReflectionAt: now,
        observedTimezone: row.observedTimezone,
        metadata: row.metadata,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const created = tx
      .select()
      .from(observationalMemory)
      .where(eq(observationalMemory.id, id))
      .get();
    if (!created) throw new Error(`OM record not found after insert: ${id}`);
    return parseRecord(created);
  });
}
```

Note: the buffered reflection fields live on the _previous_ generation row; the new generation starts clean (matching Mastra, which leaves the old row as history). The `c` (currentRecord) param is used by the caller for context; here we read live row state inside the transaction to stay consistent. Import `UpdateBufferedReflectionInput`, `SwapBufferedReflectionToActiveInput`.

### Step 4: Run + commit

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-store.test.ts` → all PASS.

```bash
git add packages/db/src/observational-memory-store.ts \
        packages/db/src/__tests__/observational-memory-store.test.ts
git commit -m "feat(db): OM storage buffered-reflection update + swap-to-active"
```

---

## Task 7: Finalize — full suite, typecheck both packages, lint

**Files:** none (verification only), unless lint reformats.

### Step 1: Full db suite

Run: `cd packages/db && pnpm test`
Expected: all green (existing tests + all OM storage tests).

### Step 2: Typecheck both packages

Run: `cd packages/db && pnpm typecheck && cd ../agent && pnpm typecheck`
Expected: no errors. Common failure: a stub return type mismatch — ensure `swapBufferedToActive` returns `Promise<SwapBufferedToActiveResult>` and the `transaction` callback returns the result object (Drizzle's `transaction` forwards the callback return).

### Step 3: Lint/format/diagnostics

Run: `pnpm run fix`
Expected: green. Re-stage any reformatted files.

### Step 4: Commit if anything reformatted

```bash
git add -A
git commit -m "style(db): format observational-memory-store"
```

---

## Explicitly OUT of scope (do not do in this plan)

- The OM processor (Observer/Reflector loop, activation state machine) — separate effort.
- Mastra's `listMessages*` / `listMessagesByResourceId` — the processor obtains messages via `SessionStorage.getPathToRoot`. Do NOT add entry-tree querying to this adapter.
- Project/resource scope (`resource:{projectId}`) and any `session_entries` denormalization — deferred.
- Wiring the adapter into `apps/server` routes or `apps/desktop` — none required until the processor exists.
- `InMemoryObservationalMemoryStorage` (test double) — add it next to `InMemorySessionStorage` only when a processor test needs it.

## Definition of done

- `SqliteObservationalMemoryStorage` implements all 17 `ObservationalMemoryStorage` methods against the `observational_memory` table.
- The interface + types live in `packages/agent` and are exported; the impl lives in `packages/db` and is exported.
- Read methods order by `generationCount DESC` (current = latest generation); history returns all rows newest-generation-first.
- Mutations throw on unknown `id` (rowsAffected === 0); flag setters only persist `lastBufferedAtTokens` when turning buffering on.
- Swap operations run inside `db.transaction()` (no optimistic-concurrency guard — `node:sqlite` is sync).
- Timestamps cross the boundary as `Date`; JSON columns cross as objects/arrays; booleans use drizzle's `{ mode: "boolean" }`.
- `pnpm test` (db), `pnpm typecheck` (db + agent), and root `pnpm run fix` are green.

## Reference: method → Mastra source line

| Method                          | Mastra LibSQL line     |
| ------------------------------- | ---------------------- |
| getObservationalMemory          | `memory/index.ts:1536` |
| getObservationalMemoryHistory   | `:1559`                |
| initializeObservationalMemory   | `:1604`                |
| insertObservationalMemoryRecord | `:1685`                |
| updateActiveObservations        | `:1748`                |
| createReflectionGeneration      | `:1799`                |
| setReflectingFlag               | `:1882`                |
| setObservingFlag                | `:1914`                |
| setBufferingObservationFlag     | `:1946`                |
| setBufferingReflectionFlag      | `:1988`                |
| clearObservationalMemory        | `:2020`                |
| setPendingMessageTokens         | `:2040`                |
| updateObservationalMemoryConfig | `:2075`                |
| updateBufferedObservations      | `:2121`                |
| swapBufferedToActive            | `:2207`                |
| updateBufferedReflection        | `:2423`                |
| swapBufferedReflectionToActive  | `:2475`                |
