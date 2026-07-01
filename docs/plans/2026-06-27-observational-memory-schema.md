# Observational Memory Schema Readiness — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the `observational_memory` table (session-scoped) to `packages/db` so the database is ready to host Observational Memory state — without renaming any existing tables.

**Architecture:** Keep sakti's descriptive core schema (`projects`, `sessions`, `session_entries`) untouched. Add one new table that speaks **Mastra's vocabulary at the boundary**: its `resource_id`/`thread_id` columns foreign-key into `projects.id`/`sessions.id`. A glossary comment in `schema.ts` documents the mapping. This is the minimal, additive, no-data-loss path; the OM storage adapter and processor are a separate later effort.

**Scope (decided upfront):**

- Session-scoped only (`lookupKey = thread:{sessionId}`). Project/resource scope is deferred and will be a purely additive change later.
- DB readiness only — schema + migration + glossary + tests. No repo class, no OM adapter, no processor.

**Tech Stack:** `node:sqlite`, Drizzle ORM + drizzle-kit (sqlite dialect), vitest, pnpm.

**Key references in the Mastra source of truth:**

- Shape: `openspec/references/mastra/packages/core/src/storage/constants.ts:472` (`OBSERVATIONAL_MEMORY_SCHEMA`)
- Record type: `openspec/references/mastra/packages/core/src/storage/types.ts:1129` (`ObservationalMemoryRecord`)
- Adapter contract (next effort): `openspec/references/mastra/packages/core/src/storage/domains/memory/base.ts:175`

---

## Design decisions baked into this plan

1. **Vocabulary at the boundary.** OM table columns use Mastra names (`resource_id`, `thread_id`, `observed_message_ids`) even though they FK into sakti tables. The glossary explains the mapping. This makes the future OM adapter a near-direct port of Mastra's code.
2. **History, not unique.** `lookup_key` is a **regular index, not unique** — Mastra keeps previous generations as history rows; the "current" record is the latest by `updatedAt`. (See `base.ts` `getObservationalMemory` / `getObservationalMemoryHistory`.)
3. **No deprecated columns.** Mastra's `bufferedObservations` / `bufferedObservationTokens` / `bufferedMessageIds` are marked `@deprecated` (legacy). We skip them and use only `buffered_observation_chunks`.
4. **Timestamps = epoch-ms integers**, consistent with every other timestamp in `schema.ts` (`projects`, `sessions`, `turns` all use `integer`). Cursors compare on `session_entries.created_at` (also integer epoch-ms).
5. **JSON = `text` columns** storing stringified JSON. SQLite has no native `jsonb`; this matches how `session_entries.content` already stores JSON.
6. **Cascade deletes.** `thread_id` and `resource_id` FKs use `onDelete: "cascade"` — delete a session/project, its OM state goes too.

---

## Task 1: Add glossary + `observationalMemory` table (TDD — existence)

**Files:**

- Modify: `packages/db/src/schema.ts` (add `index` to imports; add glossary block; add `observationalMemory` table after `turns`)
- Create: `packages/db/src/__tests__/observational-memory-schema.test.ts`
- Generated: `packages/db/migrations/<new-timestamped-folder>/migration.sql` (via `pnpm db:generate`)

### Step 1: Write the failing test

Create `packages/db/src/__tests__/observational-memory-schema.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initDatabase } from "../init";

describe("observational_memory table", () => {
  let db: DatabaseSync;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "om-db-XXXXXX"));
    db = new DatabaseSync(join(tmpDir, "test.db"));
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("table exists after migration", async () => {
    await initDatabase(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain("observational_memory");
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-schema.test.ts`
Expected: FAIL — `expected […] to contain "observational_memory"` (table not yet in `sqlite_master`).

### Step 3: Add glossary + table to `schema.ts`

In `packages/db/src/schema.ts`, update the drizzle import (top of file) to include `index`:

```ts
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
```

Append this block **after** the `turns` table definition (so `projects` and `sessions`, which it references, are already declared):

```ts
// =============================================================================
// Observational Memory (OM) — vocabulary glossary
// -----------------------------------------------------------------------------
// This table stores Observational Memory state, porting Mastra's
// `mastra_observational_memory` shape. OM is a separate concern from the core
// transcript and is keyed by Mastra's vocabulary AT THIS BOUNDARY:
//
//   Mastra "resource"  ==  sakti `projects`        (the codebase being worked on)
//   Mastra "thread"    ==  sakti `sessions`        (one conversation)
//   Mastra "messages"  ==  sakti `session_entries` (rows with kind = "message")
//
// Column mapping at this boundary:
//   observational_memory.resource_id        ->  projects.id
//   observational_memory.thread_id           ->  sessions.id
//   observational_memory.observed_message_ids -> session_entries.id (message kind)
//
// v1 scope: SESSION-scoped (thread) only. lookupKey = `thread:{sessionId}`.
// Project/resource scope is DEFERRED — when added it will use
// `resource:{projectId}` and is a purely additive change (no rewrites).
//
// lookup_key is a REGULAR (non-unique) index: Mastra keeps previous generations
// as history rows; the "current" record is the latest by updatedAt.
//
// Source of truth for the shape:
//   openspec/references/mastra/packages/core/src/storage/constants.ts:472
//   openspec/references/mastra/packages/core/src/storage/types.ts:1129
// =============================================================================
export const observationalMemory = sqliteTable(
  "observational_memory",
  {
    id: text("id").primaryKey(),
    lookupKey: text("lookup_key").notNull(),
    scope: text("scope").notNull(), // 'thread' | 'resource'
    resourceId: text("resource_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    threadId: text("thread_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),

    // content
    activeObservations: text("active_observations").notNull(),
    activeObservationsPendingUpdate: text("active_observations_pending_update"),
    bufferedObservationChunks: text("buffered_observation_chunks"), // JSON
    bufferedReflection: text("buffered_reflection"),
    bufferedReflectionTokens: integer("buffered_reflection_tokens"),
    bufferedReflectionInputTokens: integer("buffered_reflection_input_tokens"),
    reflectedObservationLineCount: integer("reflected_observation_line_count"),
    observedMessageIds: text("observed_message_ids"), // JSON array of session_entries.id
    observedTimezone: text("observed_timezone"),

    // generation
    originType: text("origin_type").notNull(), // 'initialization' | 'observation' | 'reflection'
    generationCount: integer("generation_count").notNull(),
    config: text("config").notNull(), // JSON snapshot of OM config

    // token accounting
    pendingMessageTokens: integer("pending_message_tokens").notNull(),
    totalTokensObserved: integer("total_tokens_observed").notNull(),
    observationTokenCount: integer("observation_token_count").notNull(),

    // state flags
    isObserving: integer("is_observing", { mode: "boolean" }).notNull().default(false),
    isReflecting: integer("is_reflecting", { mode: "boolean" }).notNull().default(false),
    isBufferingObservation: integer("is_buffering_observation", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    isBufferingReflection: integer("is_buffering_reflection", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    lastBufferedAtTokens: integer("last_buffered_at_tokens").notNull().default(0),

    // cursors / timestamps (epoch-ms integers, consistent with the schema)
    lastObservedAt: integer("last_observed_at"),
    lastReflectionAt: integer("last_reflection_at"),
    lastBufferedAtTime: integer("last_buffered_at_time"),
    metadata: text("metadata"), // JSON
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("observational_memory_lookup_key_idx").on(table.lookupKey)],
);
```

### Step 4: Generate the migration

Run: `cd packages/db && pnpm db:generate`
Expected: a new timestamped folder under `packages/db/migrations/` containing `migration.sql` (a `CREATE TABLE \`observational_memory\` …`+`CREATE INDEX … observational_memory_lookup_key_idx …`) and an updated `snapshot.json`. Note the folder name for the commit.

Verify the generated SQL actually creates the table and index (open `migration.sql` and eyeball it). If drizzle emitted a drop/recreate of existing tables instead of a clean additive `CREATE TABLE`, stop — that means the snapshot drifted; do not commit a destructive migration.

### Step 5: Run test to verify it passes

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-schema.test.ts`
Expected: PASS.

### Step 6: Commit

```bash
git add packages/db/src/schema.ts \
        packages/db/src/__tests__/observational-memory-schema.test.ts \
        packages/db/migrations/
git commit -m "feat(db): add observational_memory table (session-scoped)"
```

---

## Task 2: Behavior — full round-trip + history-by-lookupKey

Validates that every column type (JSON-in-text, boolean-mode flags, epoch-ms, nullable FKs) persists correctly, and that multiple rows may share a `lookup_key` (history) with latest-by-`generationCount` semantics (matching Mastra and the storage adapter — not `updatedAt`).

**Files:**

- Modify: `packages/db/src/__tests__/observational-memory-schema.test.ts` (add tests inside the existing `describe`)

### Step 1: Extend imports in the test file

Add to the top of `packages/db/src/__tests__/observational-memory-schema.test.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import { observationalMemory } from "../schema";
```

Capture the drizzle handle from `initDatabase` by changing the `beforeAll` to store it:

```ts
let drizzleDb: Awaited<ReturnType<typeof initDatabase>>;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(import.meta.dirname!, "om-db-XXXXXX"));
  db = new DatabaseSync(join(tmpDir, "test.db"));
  drizzleDb = await initDatabase(db);
});
```

(Remove the `await initDatabase(db)` line from the "table exists" test body since it now runs in `beforeAll`.)

### Step 2: Write the round-trip + history test

Add inside the same `describe`:

```ts
test("round-trips a fully-populated record (JSON, booleans, epoch-ms) and keeps history by lookupKey", () => {
  // FK parents
  db.prepare("INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?,?,?,?,?)").run(
    "proj1",
    "P",
    "/tmp/p",
    1,
    1,
  );
  db.prepare(
    "INSERT INTO sessions (id, project_id, kind, thinking_level, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run("sess1", "proj1", "task", "off", 1, 1);

  const now = Date.now();
  const config = { observation: { messageTokens: 30000 } };

  drizzleDb
    .insert(observationalMemory)
    .values({
      id: "om1",
      lookupKey: "thread:sess1",
      scope: "thread",
      resourceId: "proj1",
      threadId: "sess1",
      activeObservations: "observed: user wants X",
      bufferedObservationChunks: JSON.stringify([{ text: "chunk", tokens: 10 }]),
      observedMessageIds: JSON.stringify(["e1", "e2"]),
      observedTimezone: "America/Los_Angeles",
      originType: "observation",
      generationCount: 1,
      config: JSON.stringify(config),
      pendingMessageTokens: 1234,
      totalTokensObserved: 5678,
      observationTokenCount: 90,
      isObserving: false,
      isReflecting: true, // boolean-mode flag must round-trip as true
      isBufferingObservation: false,
      isBufferingReflection: false,
      lastBufferedAtTokens: 0,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = drizzleDb
    .select()
    .from(observationalMemory)
    .where(eq(observationalMemory.id, "om1"))
    .get();

  expect(row).toBeDefined();
  expect(row!.scope).toBe("thread");
  expect(row!.threadId).toBe("sess1");
  expect(row!.resourceId).toBe("proj1");
  expect(row!.isReflecting).toBe(true); // boolean mode
  expect(row!.isObserving).toBe(false);
  expect(JSON.parse(row!.config)).toEqual(config);
  expect(JSON.parse(row!.observedMessageIds!)).toEqual(["e1", "e2"]);
  expect(row!.lastObservedAt).toBe(now);

  // history: a second row with the SAME lookup_key is allowed
  drizzleDb
    .insert(observationalMemory)
    .values({
      id: "om2",
      lookupKey: "thread:sess1",
      scope: "thread",
      resourceId: "proj1",
      threadId: "sess1",
      activeObservations: "reflected summary",
      originType: "reflection",
      generationCount: 2,
      config: JSON.stringify(config),
      pendingMessageTokens: 0,
      totalTokensObserved: 6000,
      observationTokenCount: 40,
      isObserving: false,
      isReflecting: false,
      isBufferingObservation: false,
      isBufferingReflection: false,
      lastBufferedAtTokens: 0,
      createdAt: now + 1000,
      updatedAt: now + 1000,
    })
    .run();

  // "current" = latest generationCount DESC (NOT updatedAt). Mastra orders by
  // generationCount; the storage adapter follows the same convention so that
  // "current record" means the same thing at every layer.
  const latest = drizzleDb
    .select()
    .from(observationalMemory)
    .where(eq(observationalMemory.lookupKey, "thread:sess1"))
    .orderBy(desc(observationalMemory.generationCount))
    .all()[0];

  expect(latest!.id).toBe("om2");
  expect(latest!.generationCount).toBe(2);
});
```

### Step 3: Run the tests

Run: `cd packages/db && pnpm test src/__tests__/observational-memory-schema.test.ts`
Expected: both tests PASS. If the boolean assertions fail with `expected 1 to be true`, the column wasn't declared with `{ mode: "boolean" }` — fix the schema, not the test.

### Step 4: Commit

```bash
git add packages/db/src/__tests__/observational-memory-schema.test.ts
git commit -m "test(db): cover observational_memory round-trip and history"
```

---

## Task 3: Canonicalize the table list + finalize

Update the canonical "tables exist" assertion so the new table is part of the documented contract, then run the full verification suite.

**Files:**

- Modify: `packages/db/src/__tests__/init.test.ts` (one line)

### Step 1: Add the new table to the canonical list

In `packages/db/src/__tests__/init.test.ts`, inside the "creates all tables…" test, add after the `session_entries` assertion (around line 49):

```ts
expect(names).toContain("observational_memory");
```

### Step 2: Run the full db test suite

Run: `cd packages/db && pnpm test`
Expected: all tests PASS (existing `repos`, `session-entry-store`, `turns`, `init`, plus the two new OM tests).

### Step 3: Typecheck

Run: `cd packages/db && pnpm typecheck`
Expected: no errors. Common failure: `Property 'observationalMemory' does not exist` — means the export isn't picked up; confirm it's `export const` in `schema.ts` (re-exported via `index.ts`'s `export * from "./schema.ts"`).

### Step 4: Lint/format/diagnostics (root)

Run: `pnpm run fix`
Expected: green, or only pre-existing diagnostics. If biome reformats the new schema/test files, re-stage them.

### Step 5: Commit

```bash
git add packages/db/src/__tests__/init.test.ts
git commit -m "test(db): list observational_memory in canonical table set"
```

---

## Explicitly OUT of scope (do not do in this plan)

- Any rename of `projects` / `sessions` / `session_entries`.
- A repo class for `observationalMemory` — that is the OM storage adapter's job.
- The ~18-method `MemoryStorage` OM contract (`base.ts:175`) — next effort.
- The OM processor (Observer/Reflector loop, buffering/activation state machine).
- Project/resource scope (`resource:{projectId}`), the `project_id` denormalization on `session_entries`, and the leaf-path message query — deferred to a later additive plan.
- Changes to `apps/server` or `apps/desktop` — none required; the table is dormant until the adapter is built.

## Definition of done

- `observational_memory` table exists after `initDatabase`, with the glossary mapping it to Mastra's resource/thread/message vocabulary.
- One additive, non-destructive migration is committed.
- Round-trip + history tests pass; the canonical table list includes it.
- `pnpm test` (db), `pnpm typecheck` (db), and root `pnpm run fix` are green.
- No existing table or test was modified destructively.
