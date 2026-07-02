# Lazy Turn Rehydration + Session Memory Budget Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cap renderer memory by making persisted chat history lazy — only each turn's user message + summary message are resident; the intermediate steps (tool calls, thinking, partial assistant messages) load on expand and evict on collapse — plus bound how many session stores stay resident via LRU eviction.

**Architecture:** Turns become first-class and persisted-linked to their messages. Server stamps each appended `session_entry` with `turnId` (set on the storage at run start) and marks the turn's final assistant entry as `isTurnSummary` at finalize. Two new endpoints serve a _summaries-only_ view (`GET /sessions/:id/chat`) and one turn's _intermediates_ (`GET /sessions/:id/turns/:turnId/intermediates`). The client keeps a single unified Solid store (WS-live and HTTP-history share it) but structures turns as summary-resident + lazy-intermediates. `SessionRegistry` becomes an LRU that disposes the least-recently-used session store beyond a cap (default 3). Forking is consolidated so entries and turns copy atomically with shared id-maps. Per-text truncation (Level 2) is explicitly out of scope.

**Tech Stack:** Drizzle ORM + node:sqlite (schema/migrations), Hono (REST), Effect (storage layer), SolidJS stores + `createEffect` (renderer), vitest (TDD).

---

## Design decisions (locked)

| Decision                      | Choice                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Residency philosophy          | LRU of N=3 session stores                                                                            |
| Intermediate eviction trigger | Collapse-only (fetch on expand, evict on collapse)                                                   |
| Per-text truncation           | Deferred (Level 1 only — no capping of bash/thinking strings)                                        |
| Data fetching                 | Hand-rolled unified Solid store (NOT TanStack Query) — WS-live and HTTP-history share one store      |
| Turn attribution              | Stamp `turnId` at append time (storage holds `currentTurnId`); mark `isTurnSummary` at turn finalize |
| Compaction / OM integration   | Updated so their appends carry the correct `turnId`                                                  |

## Blast-radius findings (from knowledge graph)

- **`appendEntry` is shared by the agent loop, compaction, and OM** (`packages/agent/src/session/session.ts` `PromiseSession.append*`, `compaction.ts`, `observational-memory/engine.ts`). It's part of the agent's `SessionStorage` interface — turn attribution must be done inside the DB storage impl (`SqliteSessionStorage`), NOT by changing `appendEntry`'s signature (turns are a server/DB concept; the agent must not learn about them).
- **`buildChatTurns` has 2 callers** (`OnboardingPanel`, `TaskChatView`) but the `ChatTurn` type ripples into `message-timeline.tsx`, `session-turn.tsx`, `estimate-turn-height.ts`.
- **`copyForFork` has 1 caller** (`forking.ts:49`), called separately from `forkFrom` (`forking.ts:48`) — they don't share id-maps. Must be consolidated.
- **`estimateTurnHeight` reads `turn.assistantMessages` content** — expanding a turn changes its height; the virtualizer's cached size must be invalidated on expand.
- **`SessionRegistry.get` callers**: `ChatInput`, `OnboardingPanel`, `Sidebar`, `TaskChatView`, `WorkspaceLayout`, `ws-client`, `actions`, `token-batcher`. LRU eviction must re-create on miss and tolerate background-tab eviction.

## Key Files Reference

| File                                                                  | Role                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/db/src/schema.ts:34-52`                                     | `sessionEntries` table — add `turnId`, `isTurnSummary`                                 |
| `packages/db/src/repos/turns.ts`                                      | `TurnRepo` — add `getLatest`, `markSummary`                                            |
| `packages/db/src/session-entry-store.ts`                              | `SqliteSessionStorage` — add `currentTurnId`, stamp on `appendEntry`, consolidate fork |
| `apps/server/src/agent/ws-handler.ts:226-276`                         | `runAgentStream` — capture turn id, set on storage, mark summary on finalize           |
| `apps/server/src/routes/sessions/chat.ts`                             | NEW — `GET /sessions/:id/chat` (summaries)                                             |
| `apps/server/src/routes/sessions/turn-intermediates.ts`               | NEW — `GET /sessions/:id/turns/:turnId/intermediates`                                  |
| `apps/server/src/routes/sessions/forking.ts:47-53`                    | consolidate fork copy                                                                  |
| `apps/desktop/src/stores/session/session-store.ts`                    | turn-aware lazy structure                                                              |
| `apps/desktop/src/stores/session/session-registry.ts`                 | LRU eviction                                                                           |
| `apps/desktop/src/stores/server/actions.ts`                           | `loadChat`, `loadIntermediates`, `evictIntermediates`                                  |
| `apps/desktop/src/stores/session/turn-projection.ts`                  | retire positional timing zip                                                           |
| `apps/desktop/src/components/chat-area/timeline/session-turn.tsx`     | fetch-on-expand, evict-on-collapse, re-measure                                         |
| `apps/desktop/src/components/chat-area/timeline/message-timeline.tsx` | expose `bumpMeasure` for height invalidation                                           |

---

## Phase 0: Schema migration

### Task 0.1: Add `turnId` + `isTurnSummary` columns to `session_entries`

**Files:**

- Modify: `packages/db/src/schema.ts:34-52`

**Step 1: Add the columns (TDD — write the schema change first)**

In `packages/db/src/schema.ts`, extend the `sessionEntries` table definition. Replace the `(table) => [...]` index block and add the two columns + FK + partial unique index:

```ts
export const sessionEntries = sqliteTable(
  "session_entries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    timestamp: text("timestamp").notNull(),
    createdAt: integer("created_at").notNull(),
    // NEW: which turn this entry belongs to (null for entries appended
    // outside a run, e.g. command-compaction with no active turn).
    turnId: text("turn_id").references(() => turns.id, { onDelete: "cascade" }),
    // NEW: this entry is the turn's final assistant message (the "summary").
    // At most one per turn — enforced by the partial unique index below.
    isTurnSummary: integer("is_turn_summary", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("session_entries_session_id_sequence_idx").on(table.sessionId, table.sequence),
    index("session_entries_session_id_kind_idx").on(table.sessionId, table.kind),
    index("session_entries_turn_id_idx").on(table.turnId),
    // At most one summary per turn.
    uniqueIndex("session_entries_turn_id_summary_idx")
      .on(table.turnId)
      .where(sql`is_turn_summary = 1`),
  ],
);
```

Add `uniqueIndex` and `sql` to the imports at the top of `schema.ts` if not present (the file already imports `index, integer, sqliteTable, text, uniqueIndex`; add `sql` from `drizzle-orm`).

**Step 2: Generate the migration SQL**

Run:

```
vp run '@sakti-code/db#db:generate'
```

Expected: a new `packages/db/migrations/<timestamp>_<name>/migration.sql` is created containing `ALTER TABLE session_entries ADD COLUMN turn_id TEXT` and `... ADD COLUMN is_turn_summary INTEGER NOT NULL DEFAULT 0`, plus the new indexes. Note the generated folder path.

**Step 3: Append the backfill SQL to the generated migration**

Open the new `migration.sql` and append (this derives `turn_id` + `is_turn_summary` for existing rows by replaying the user-message-starts-a-turn grouping):

```sql
-- Backfill: group existing entries into turns by user-message boundaries.
-- A user message (kind='message', content role='user') starts a new turn.
-- We walk entries in sequence order, creating turn rows and stamping entries.
-- Note: prior data has no turn timings; backfilled turns get startedAt/endedAt NULL.
INSERT INTO turns (id, session_id, sequence, started_at, ended_at, created_at)
SELECT
  ('backfill-' || session_id || '-' || (
    SELECT COUNT(*) FROM session_entries e2
    WHERE e2.session_id = session_entries.session_id
      AND e2.sequence <= session_entries.sequence
      AND e2.kind = 'message'
      AND json_extract(e2.content, '$.message.role') = 'user'
  ) - 1),
  session_id,
  (SELECT COUNT(*) FROM session_entries e3
   WHERE e3.session_id = session_entries.session_id
     AND e3.sequence < session_entries.sequence
     AND e3.kind = 'message'
     AND json_extract(e3.content, '$.message.role') = 'user'),
  0,
  NULL,
  0
FROM session_entries
WHERE kind = 'message'
  AND json_extract(content, '$.message.role') = 'user';

-- Stamp turn_id on every message entry = the turn that began at/-before it.
UPDATE session_entries
SET turn_id = (
  SELECT t.id FROM turns t
  WHERE t.session_id = session_entries.session_id
    AND t.sequence = (
      SELECT COUNT(*) FROM session_entries e2
      WHERE e2.session_id = session_entries.session_id
        AND e2.sequence <= session_entries.sequence
        AND e2.kind = 'message'
        AND json_extract(e2.content, '$.message.role') = 'user'
    ) - 1
)
WHERE kind = 'message';

-- Mark the summary = last assistant message of each backfilled turn.
UPDATE session_entries
SET is_turn_summary = 1
WHERE id IN (
  SELECT last_assistant.id FROM (
    SELECT
      turn_id,
      MAX(sequence) AS max_seq
    FROM session_entries
    WHERE turn_id IS NOT NULL
      AND json_extract(content, '$.message.role') = 'assistant'
    GROUP BY turn_id
  ) s
  JOIN session_entries last_assistant
    ON last_assistant.turn_id = s.turn_id
   AND last_assistant.sequence = s.max_seq
);
```

> **Verify the JSON path first.** The `$.message.role` path assumes the entry `content` JSON nests the message under `message`. Before committing the backfill, run a one-off query against a real session DB to confirm the actual shape (it may be `$.role` or nested differently — `appendEntry` stores `JSON.stringify(entry)` where `entry` is a `SessionTreeEntry`). Adjust the `json_extract` paths to match. This is the single most fragile part of the migration — test it on `~/.sakti/sessions.db` (copy first) before relying on it.

**Step 4: Run the migration (auto-applies on next server/desktop start)**

`init.ts:17` runs `migrate(...)` on `initDatabase`, so migrations apply automatically. For an immediate check, run the db test suite:

```
vp run '@sakti-code/db#test'
```

Expected: PASS (existing repo tests still pass; new columns are nullable/defaulted).

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations/
git commit -m "feat(db): add turnId + isTurnSummary to session_entries with backfill"
```

---

## Phase 1: DB layer — turn stamping, summary marking, fork consolidation

### Task 1.1: `SqliteSessionStorage` stamps `turnId` on append

**Files:**

- Modify: `packages/db/src/session-entry-store.ts:16-85`
- Test: `packages/db/src/__tests__/session-entry-store.test.ts` (add case)

**Step 1: Write the failing test**

Add to the entry-store test file (create it if absent, mirroring `packages/db/src/repos/__tests__/turns.test.ts` setup):

```ts
it("appendEntry stamps currentTurnId when set", () => {
  const { storage, sessionId } = makeStorage(); // helper: in-memory db + SqliteSessionStorage
  const turn = turnRepo.create(sessionId, 1000);
  storage.setCurrentTurnId(turn.id);

  storage.appendEntrySync({
    id: "e1",
    parentId: null,
    type: "message",
    message: userMsg,
    timestamp: "1",
  });

  const row = db.select().from(sessionEntries).where(eq(sessionEntries.id, "e1")).get();
  expect(row?.turnId).toBe(turn.id);
  expect(row?.isTurnSummary).toBe(false);
});

it("appendEntry leaves turnId null when no current turn", () => {
  const { storage } = makeStorage();
  storage.appendEntrySync({
    id: "e2",
    parentId: null,
    type: "message",
    message: userMsg,
    timestamp: "2",
  });
  const row = db.select().from(sessionEntries).where(eq(sessionEntries.id, "e2")).get();
  expect(row?.turnId).toBeNull();
});
```

> `appendEntry` is wrapped in `Effect.sync`. The tests can use `Effect.runPromise(storage.appendEntry(...))` instead of a sync variant — match the existing repo test style. The key assertion is `row.turnId`.

**Step 2: Run to verify it fails**

```
vp run '@sakti-code/db#test' -- session-entry-store
```

Expected: FAIL — `setCurrentTurnId` is not a function / `turnId` undefined.

**Step 3: Implement**

In `SqliteSessionStorage`, add a mutable field + setter, and stamp it in `appendEntry`:

```ts
export class SqliteSessionStorage<TMetadata extends SessionMetadata = SessionMetadata> {
  private readonly db: DrizzleDB;
  private readonly sessionId: string;
  private readonly metadata: TMetadata;
  private currentTurnId: string | null = null;

  setCurrentTurnId(turnId: string | null): void {
    this.currentTurnId = turnId;
  }

  // ... existing methods ...

  appendEntry(entry: SessionTreeEntry): Effect.Effect<void, SessionError> {
    return Effect.sync(() => {
      const content = JSON.stringify(entry);
      this.db.transaction((tx) => {
        const row = tx
          .select({ max: sql<number>`coalesce(max(sequence), -1)` })
          .from(sessionEntries)
          .where(eq(sessionEntries.sessionId, this.sessionId))
          .get();
        const sequence = (row?.max ?? -1) + 1;

        tx.insert(sessionEntries)
          .values({
            id: entry.id,
            sessionId: this.sessionId,
            parentId: entry.parentId,
            sequence,
            kind: entry.type,
            content,
            timestamp: entry.timestamp,
            createdAt: Date.now(),
            turnId: this.currentTurnId, // NEW
          })
          .run();

        if (entry.type !== "leaf") {
          tx.update(sessions)
            .set({ leafId: entry.id })
            .where(eq(sessions.id, this.sessionId))
            .run();
        }
      });
    });
  }
```

**Step 4: Run to verify it passes**

```
vp run '@sakti-code/db#test' -- session-entry-store
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/db/src/session-entry-store.ts packages/db/src/__tests__/session-entry-store.test.ts
git commit -m "feat(db): stamp currentTurnId on appended session entries"
```

---

### Task 1.2: `TurnRepo.markSummary` — mark the turn's final assistant entry

**Files:**

- Modify: `packages/db/src/repos/turns.ts`
- Test: `packages/db/src/repos/__tests__/turns.test.ts`

**Step 1: Write the failing test**

```ts
it("markSummary sets isTurnSummary on the turn's last assistant entry", () => {
  const { db, sessionId } = setup();
  const turn = turns.create(sessionId, 1000);
  seedMessageEntry(db, sessionId, { id: "u1", turnId: turn.id, role: "user", sequence: 0 });
  seedMessageEntry(db, sessionId, { id: "a1", turnId: turn.id, role: "assistant", sequence: 1 });
  seedMessageEntry(db, sessionId, { id: "a2", turnId: turn.id, role: "assistant", sequence: 2 });

  turns.markSummary(turn.id);

  const summary = db
    .select()
    .from(sessionEntries)
    .where(eq(sessionEntries.isTurnSummary, true))
    .all();
  expect(summary).toHaveLength(1);
  expect(summary[0]!.id).toBe("a2");
});
```

**Step 2: Run to verify it fails**

```
vp run '@sakti-code/db#test' -- turns
```

Expected: FAIL — `markSummary` is not a function.

**Step 3: Implement**

In `TurnRepo`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { sessionEntries } from "../schema.ts";

// inside TurnRepo:

/** Mark the turn's final assistant message entry as the summary. */
markSummary(turnId: string): void {
  const entries = this.db
    .select()
    .from(sessionEntries)
    .where(eq(sessionEntries.turnId, turnId))
    .orderBy(desc(sessionEntries.sequence))
    .all();
  const lastAssistant = entries.find((e) => {
    try {
      const parsed = JSON.parse(e.content) as { message?: { role?: string } };
      return parsed.message?.role === "assistant";
    } catch {
      return false;
    }
  });
  if (lastAssistant) {
    this.db
      .update(sessionEntries)
      .set({ isTurnSummary: true })
      .where(eq(sessionEntries.id, lastAssistant.id))
      .run();
  }
}

getLatest(sessionId: string): TurnRow | null {
  return this.listBySession(sessionId).at(-1) ?? null;
}
```

> The content-shape parse mirrors what `parseEntry` does. Confirm `message.role` nesting matches the actual `SessionTreeEntry` (see Task 0.1 Step 3 caveat) — adjust the path if needed.

**Step 4: Run to verify it passes** → `vp run '@sakti-code/db#test' -- turns` → PASS.

**Step 5: Commit**

```bash
git add packages/db/src/repos/turns.ts packages/db/src/repos/__tests__/turns.test.ts
git commit -m "feat(db): add TurnRepo.markSummary + getLatest"
```

---

### Task 1.3: Consolidate fork — copy entries + turns atomically with shared id-maps

**Files:**

- Modify: `packages/db/src/session-entry-store.ts:163-245` (`forkFrom`)
- Modify: `packages/db/src/repos/turns.ts` (`copyForFork` → accept id-map, or remove)
- Modify: `apps/server/src/routes/sessions/forking.ts:47-53`
- Test: `packages/db/src/__tests__/session-entry-store.test.ts`

**Why:** `forking.ts` calls `forkFrom` (copies entries, remaps entry ids) and `copyForFork` (copies turns, creates NEW turn ids) separately. Once entries carry `turnId`, the forked entries would point at non-existent turn ids. The fix: copy turns inside `forkFrom`'s transaction, build a `turnIdMap`, and stamp the remapped `turnId` on forked entries.

**Step 1: Write the failing test**

```ts
it("forkFrom remaps turnId on copied entries", () => {
  const { db, sourceStorage, sourceSessionId } = setupWithTurns();
  const turn = turnRepo.create(sourceSessionId, 1000);
  sourceStorage.setCurrentTurnId(turn.id);
  sourceStorage.appendEntrySync({
    id: "a1",
    parentId: null,
    type: "message",
    message: assistantMsg,
    timestamp: "1",
  });

  const forkedStorage = makeStorage(forkedSessionId);
  forkedStorage.forkFromSync(sourceSessionId);

  const forkedEntry = db
    .select()
    .from(sessionEntries)
    .where(eq(sessionEntries.sessionId, forkedSessionId))
    .all();
  expect(forkedEntry).toHaveLength(1);
  const forkedTurn = db.select().from(turns).where(eq(turns.sessionId, forkedSessionId)).all();
  expect(forkedTurn).toHaveLength(1);
  expect(forkedEntry[0]!.turnId).toBe(forkedTurn[0]!.id); // remapped, not stale
});
```

**Step 2: Run to verify it fails** → expected FAIL (turnId points at source turn id, or no forked turn exists).

**Step 3: Implement — fold turn-copying into `forkFrom`**

In `SqliteSessionStorage.forkFromSync`, inside the existing transaction (after building `idMap` for entries), add turn copying with a `turnIdMap`, and stamp remapped `turnId` on each inserted entry:

```ts
private forkFromSync(sourceSessionId: string, upToEntryId?: string): void {
  // ... existing: load sourceRows, build entriesToCopy, build entry idMap ...

  // NEW: load source turns, build turn idMap
  const sourceTurns = this.db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sourceSessionId))
    .orderBy(turns.sequence)
    .all();
  const turnIdMap = new Map<string, string>();
  for (const t of sourceTurns) {
    turnIdMap.set(t.id, crypto.randomUUID());
  }

  this.db.transaction((tx) => {
    // ... existing: compute nextSequence, insert entries (stamp remapped turnId) ...
    for (const src of entriesToCopy) {
      // ... existing entry insert, but add:
      turnId: src.turnId ? (turnIdMap.get(src.turnId) ?? null) : null,
      isTurnSummary: src.isTurnSummary, // preserve
      // ...
    }

    // NEW: copy turns with remapped ids
    for (const t of sourceTurns) {
      tx.insert(turns)
        .values({
          id: turnIdMap.get(t.id)!,
          sessionId: this.sessionId,
          sequence: t.sequence,
          startedAt: t.startedAt,
          endedAt: t.endedAt,
          createdAt: Date.now(),
        })
        .run();
    }

    // ... existing: set newLeafId ...
  });
}
```

Then update `copyForFork` to a no-op/deprecated (or remove) and update `forking.ts`:

```ts
// forking.ts — replace the two-call block:
try {
  await Effect.runPromise(forkedStorage.forkFrom(id));
  // turns now copied inside forkFrom — do NOT call ctx.repos.turns.copyForFork
} catch (err) {
  await ctx.repos.sessions.delete(newSession.id);
  throw err;
}
```

Remove `TurnRepo.copyForFork` (or keep as deprecated wrapper) and its test, since forking now owns it.

**Step 4: Run to verify it passes** → `vp run '@sakti-code/db#test'` → PASS, and `vp run '@sakti-code/server#test' -- forking` → PASS (forking tests still pass).

**Step 5: Commit**

```bash
git add packages/db/src/session-entry-store.ts packages/db/src/repos/turns.ts apps/server/src/routes/sessions/forking.ts packages/db/src/__tests__/
git commit -m "refactor(db): copy turns inside forkFrom with shared turnIdMap

Entries now carry turnId, so forked entries must point at forked turn
ids. Folding turn-copying into forkFrom's transaction keeps the maps
consistent and removes the separate copyForFork call."
```

---

## Phase 2: Server wiring — stamp on run, new endpoints

### Task 2.1: `runAgentStream` sets `currentTurnId` + marks summary on finalize

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts:226-276`
- Test: `apps/server/src/__tests__/session-messages.test.ts` (or a new ws run test)

**Step 1: Write the failing test** (integration-level: run a tiny prompt through a test agent, assert the assistant entry has `turnId` + `isTurnSummary`).

Add to `apps/server/src/__tests__/session-messages.test.ts`:

```ts
it("entries appended during a run carry the run's turnId, and last assistant is summary", async () => {
  const { ctx, sessionId, storage } = await setupRunWithMockAgent(); // helper that runs one prompt turn
  await runAgentStream(ctx, sessionId, "hello", storage, fakeWs);

  const rows = await Effect.runPromise(storage.getEntries());
  const turnRows = ctx.repos.turns.listBySession(sessionId);
  expect(turnRows).toHaveLength(1);
  const stamped = rows.filter((r) => /* read row turnId via a storage accessor */);
  // assert: at least one entry has turnId === turnRows[0].id
  // assert: exactly one entry has isTurnSummary, and it's the last assistant
});
```

> This may require a small storage accessor to read `turnId`/`isTurnSummary` on entries (the existing `getEntries` returns parsed `SessionTreeEntry` which loses the columns). Add `getEntriesWithMeta()` to `SqliteSessionStorage` returning `{ entry, turnId, isTurnSummary }[]` — it's needed by the new endpoints anyway (Task 2.2).

**Step 2: Run to verify it fails** → FAIL (turnId null, no summary marked).

**Step 3: Implement**

In `apps/server/src/agent/ws-handler.ts`, modify `runAgentStream`:

```ts
async function runAgentStream(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  storage: SessionStorageShape,
  ws: WsHandle,
) {
  const log = ctx.log?.server;
  const turn = ctx.repos.turns.create(sessionId, Date.now()); // capture
  storage.setCurrentTurnId(turn.id); // NEW
  log?.info("agent run started", { sessionId, turnId: turn.id, messageLength: message.length });
  try {
    await runPrompt(ctx, sessionId, message, storage /* ...existing callbacks... */);
    log?.info("agent run finished", { sessionId });
  } catch (err) {
    log?.error("agent run failed", err, { sessionId });
    ws.send({
      error: err instanceof Error ? err.message : String(err),
      sessionId,
      type: "error",
    } satisfies ErrorFrame);
  } finally {
    ctx.repos.turns.finalize(turn.id, Date.now()); // finalize THIS turn, not "latest"
    ctx.repos.turns.markSummary(turn.id); // NEW
    storage.setCurrentTurnId(null); // NEW — clear so any post-run append is unattributed
    log?.debug("turn finalized + summary marked", { sessionId, turnId: turn.id });
  }
}
```

> Switch from `finalizeLatest` to `finalize(turn.id)` + `markSummary(turn.id)` since we now have the exact turn id. `markSummary` must run after all entries are appended (in `finally`, after `runPrompt` resolves) — correct.

**Step 2.2 handle compaction-as-command:** audit `handleCompactCommand` (ws-handler.ts:286+) and the compaction route. If they append entries outside a run, they should `storage.setCurrentTurnId(null)` (the default) — which they already are since runs clear it. No change needed unless they create turns; verify and document.

**Step 4: Run to verify it passes** → `vp run '@sakti-code/server#test' -- session-messages` → PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/__tests__/session-messages.test.ts
git commit -m "feat(server): stamp turnId on run entries + mark summary at finalize"
```

---

### Task 2.2: `GET /sessions/:id/chat` — summaries-only view

**Files:**

- Create: `apps/server/src/routes/sessions/chat.ts`
- Modify: `apps/server/src/app.ts` (register route)
- Modify: `packages/db/src/session-entry-store.ts` (add `getEntriesWithMeta`)
- Test: `apps/server/src/__tests__/chat.test.ts`

**Step 1: Write the failing test**

```ts
describe("GET /api/sessions/:id/chat", () => {
  it("returns turns with only user + summary messages, no intermediates", async () => {
    const { app, ctx, sessionId } = await setupSessionWithTurns(); // seeds 1 turn: user, assistant(toolCall), toolResult, assistant(text=summary)
    const res = await app.request(`/api/sessions/${sessionId}/chat`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.turns).toHaveLength(1);
    const turn = body.turns[0];
    expect(turn.summaryMessage.role).toBe("assistant");
    expect(turn.userMessage.role).toBe("user");
    expect(turn.intermediateCount).toBe(2); // assistant(toolCall) + toolResult, NOT included in payload
    // no intermediate content shipped:
    expect(turn.intermediateIds).toHaveLength(2);
  });
});
```

**Step 2: Run to verify it fails** → FAIL (route 404).

**Step 3: Implement**

Add to `SqliteSessionStorage`:

```ts
getEntriesWithMeta(): Effect.Effect<
  Array<{ entry: SessionTreeEntry; turnId: string | null; isTurnSummary: boolean; sequence: number }>,
  SessionError
> {
  return Effect.sync(() => {
    const rows = this.db
      .select({
        content: sessionEntries.content,
        turnId: sessionEntries.turnId,
        isTurnSummary: sessionEntries.isTurnSummary,
        sequence: sessionEntries.sequence,
      })
      .from(sessionEntries)
      .where(eq(sessionEntries.sessionId, this.sessionId))
      .orderBy(sessionEntries.sequence)
      .all();
    return rows.map((r) => ({
      entry: parseEntry(r.content),
      turnId: r.turnId,
      isTurnSummary: r.isTurnSummary,
      sequence: r.sequence,
    }));
  });
}
```

Create `apps/server/src/routes/sessions/chat.ts`:

```ts
import { buildSessionContextFromEntries } from "@sakti-code/agent";
import { Effect } from "effect";
import { Hono } from "hono";
import { createSessionStorage, getCtx } from "../../context.ts";

interface ChatTurnDTO {
  id: string;
  sequence: number;
  startedAt: number;
  endedAt: number | null;
  userMessage: unknown | null;
  summaryMessage: unknown | null;
  intermediateIds: string[];
}

export const chatRoutes = new Hono().basePath("/sessions").get("/:id/chat", async (c) => {
  const ctx = getCtx(c);
  const sessionId = c.req.param("id");
  const storage = createSessionStorage(ctx, sessionId);

  const turnRows = ctx.repos.turns.listBySession(sessionId);
  const entriesWithMeta = await Effect.runPromise(storage.getEntriesWithMeta());

  // Build per-turn payloads: ship only user + summary content; list intermediate ids.
  const byTurn = new Map<
    string,
    { user: unknown | null; summary: unknown | null; intermediateIds: string[] }
  >();
  for (const e of entriesWithMeta) {
    if (!e.turnId) continue;
    const parsed = e.entry as { message?: { role?: string } };
    const role = parsed.message?.role;
    const slot = byTurn.get(e.turnId) ?? { user: null, summary: null, intermediateIds: [] };
    if (role === "user" && !slot.user) {
      slot.user = parsed;
    } else if (e.isTurnSummary) {
      slot.summary = parsed;
    } else {
      slot.intermediateIds.push(e.entry.id);
    }
    byTurn.set(e.turnId, slot);
  }

  const turns: ChatTurnDTO[] = turnRows.map((t) => {
    const slot = byTurn.get(t.id) ?? { user: null, summary: null, intermediateIds: [] };
    return {
      id: t.id,
      sequence: t.sequence,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      userMessage: slot.user,
      summaryMessage: slot.summary,
      intermediateIds: slot.intermediateIds,
    };
  });

  return c.json({ turns });
});
```

> `intermediateCount` = `intermediateIds.length` — clients derive it; no need to ship it separately (the test checks `.length`).

Register in `apps/server/src/app.ts` alongside the other session routes (follow the existing `.route("/", turnsRoutes)` pattern).

**Step 4: Run to verify it passes** → `vp run '@sakti-code/server#test' -- chat` → PASS.

**Step 5: Commit**

```bash
git add apps/server/src/routes/sessions/chat.ts apps/server/src/app.ts packages/db/src/session-entry-store.ts apps/server/src/__tests__/chat.test.ts
git commit -m "feat(server): add GET /sessions/:id/chat summaries-only endpoint"
```

---

### Task 2.3: `GET /sessions/:id/turns/:turnId/intermediates`

**Files:**

- Create: `apps/server/src/routes/sessions/turn-intermediates.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/__tests__/turn-intermediates.test.ts`

**Step 1: Write the failing test**

```ts
it("returns the turn's non-summary, non-user entries in sequence order", async () => {
  const { app, sessionId, turnId } = await setupTurnWithIntermediates();
  const res = await app.request(`/api/sessions/${sessionId}/turns/${turnId}/intermediates`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.entries.map((e: { id: string }) => e.id)).toEqual(["a-toolcall", "toolresult-1"]);
});
```

**Step 2: Run to verify it fails** → FAIL (404).

**Step 3: Implement**

```ts
import { Effect } from "effect";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { sessionEntries } from "@sakti-code/db/schema"; // or re-export
import { createSessionStorage, getCtx } from "../../context.ts";

export const turnIntermediatesRoutes = new Hono()
  .basePath("/sessions")
  .get("/:id/turns/:turnId/intermediates", async (c) => {
    const ctx = getCtx(c);
    const sessionId = c.req.param("id");
    const turnId = c.req.param("turnId");
    const storage = createSessionStorage(ctx, sessionId);
    const entries = await Effect.runPromise(storage.getEntriesWithMeta());
    const intermediates = entries
      .filter((e) => e.turnId === turnId && !e.isTurnSummary)
      .map((e) => e.entry);
    return c.json({ entries: intermediates });
  });
```

> Filter out `isTurnSummary` (the summary is already shipped via `/chat`) and rely on `turnId` equality. User messages for a turn are shipped via `/chat`'s `userMessage` — but to be safe, the client can also skip role=user when rendering intermediates. Confirm by test.

Register in `apps/server/src/app.ts`.

**Step 4: Run to verify it passes** → `vp run '@sakti-code/server#test' -- turn-intermediates` → PASS.

**Step 5: Commit**

```bash
git add apps/server/src/routes/sessions/turn-intermediates.ts apps/server/src/app.ts apps/server/src/__tests__/turn-intermediates.test.ts
git commit -m "feat(server): add GET /sessions/:id/turns/:turnId/intermediates"
```

---

## Phase 3: Client store — turn-aware lazy structure + LRU registry

### Task 3.1: `SessionRegistry` LRU eviction

**Files:**

- Modify: `apps/desktop/src/stores/session/session-registry.ts`
- Test: `apps/desktop/src/stores/session/__tests__/session-registry.test.ts`

**Step 1: Write the failing test**

```ts
it("evicts the least-recently-used store beyond the cap", () => {
  const registry = new SessionRegistry({ cap: 2 });
  registry.get("a");
  registry.get("b");
  registry.get("c"); // exceeds cap of 2 → "a" evicted
  expect(registry.has("a")).toBe(false);
  expect(registry.has("b")).toBe(true);
  expect(registry.has("c")).toBe(true);
});

it("re-getting a session refreshes its recency", () => {
  const registry = new SessionRegistry({ cap: 2 });
  registry.get("a");
  registry.get("b");
  registry.get("a"); // refresh "a"
  registry.get("c"); // now "b" is LRU → evicted
  expect(registry.has("a")).toBe(true);
  expect(registry.has("b")).toBe(false);
});
```

**Step 2: Run to verify it fails** → FAIL (no `cap` option; never evicts).

**Step 3: Implement**

```ts
const DEFAULT_LRU_CAP = 3;

export class SessionRegistry {
  private readonly stores = new Map<string, SessionStore>(); // Map preserves insertion order = LRU order
  private readonly disposers = new Map<string, () => void>();
  private readonly cap: number;

  constructor(opts: { cap?: number } = {}) {
    this.cap = opts.cap ?? DEFAULT_LRU_CAP;
  }

  get(sessionId: string): SessionStore {
    const existing = this.stores.get(sessionId);
    if (existing) {
      // refresh recency: delete + re-insert moves it to most-recent.
      this.stores.delete(sessionId);
      this.stores.set(sessionId, existing);
      return existing;
    }
    const store = createRoot((dispose) => {
      this.disposers.set(sessionId, dispose);
      return createSessionStore();
    });
    this.stores.set(sessionId, store);
    this.evictIfNeeded();
    return store;
  }

  private evictIfNeeded(): void {
    while (this.stores.size > this.cap) {
      const oldestId = this.stores.keys().next().value;
      if (oldestId === undefined) break;
      this.dispose(oldestId);
    }
  }

  // has / dispose / disposeAll unchanged
}
```

> **`ws-client` consideration:** `ws-client.ts` calls `registry.get(sessionId)` to dispatch live events. After eviction + re-`get`, it creates a fresh empty store. The caller (the view) is responsible for re-loading on access (see Task 4.1). Document this in a code comment on `get`.

**Step 4: Run to verify it passes** → `vp run desktop#test -- session-registry` → PASS, and the full desktop suite still passes (`vp run desktop#test`) — watch for anything assuming stores never evict.

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/session/session-registry.ts apps/desktop/src/stores/session/__tests__/session-registry.test.ts
git commit -m "feat(desktop): SessionRegistry LRU eviction (cap 3)"
```

---

### Task 3.2: `loadChat` action — fetch summaries into the unified store

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts` (add `loadChat`, keep `loadMessages` for now)
- Modify: `apps/desktop/src/stores/session/session-store.ts` (add `loadChatTurns` action)
- Test: `apps/desktop/src/stores/server/__tests__/actions.test.ts`

**Step 1: Write the failing test**

```ts
it("loadChat hydrates turn summaries into the store (intermediates absent)", async () => {
  const { actions, sessionRegistry, mocks } = setupActions();
  mocks.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        turns: [
          {
            id: "t1",
            sequence: 0,
            startedAt: 1000,
            endedAt: 2000,
            userMessage: { message: { role: "user", content: "hi" } },
            summaryMessage: {
              message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
            },
            intermediateIds: ["x1", "x2"],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  await actions.loadChat("sess-1");
  const store = sessionRegistry.get("sess-1").store;
  expect(store.messageOrder.length).toBeGreaterThan(0);
  // intermediates NOT present
  expect(store.turns["t1"]?.intermediatesLoaded).toBe(false);
});
```

**Step 2: Run to verify it fails** → FAIL (`loadChat` not a function).

**Step 3: Implement**

Add to `session-store.ts` a `turns` slice tracking per-turn intermediate residency:

```ts
// in SessionStoreData:
turns: Record<string, { intermediatesLoaded: boolean; intermediateIds: string[] }>;

// action:
loadChatTurns(turns: Array<{ id: string; intermediateIds: string[]; startedAt: number; endedAt: number | null }>, messages: UIMessage[]): void;
```

Add `loadChat` to `actions.ts`:

```ts
async loadChat(sessionId) {
  try {
    const res = await api.api.sessions[":id"].chat.$get({ param: { id: sessionId } });
    if (!res.ok) return;
    const body = await res.json() as { turns: ChatTurnDTO[] };
    const { messages, turnMeta } = hydrateChatSummaries(body.turns); // new hydrator (Task 3.3)
    const session = sessionRegistry.get(sessionId);
    session.actions.loadChatTurns(turnMeta, messages);
  } catch (error) {
    setLastError(error instanceof Error ? error.message : "Failed to load chat");
  }
},
```

> Keep `loadMessages` (the old full-fetch path) intact for now — it's still used by tests/replay. Migrate the two view callers (`TaskChatView`, `OnboardingPanel`) to `loadChat` in Phase 4.

**Step 4: Run to verify it passes** → PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/server/actions.ts apps/desktop/src/stores/session/session-store.ts apps/desktop/src/stores/server/__tests__/actions.test.ts
git commit -m "feat(desktop): loadChat action hydrates turn summaries"
```

---

### Task 3.3: `hydrateChatSummaries` + `hydrateIntermediates` (client hydrators)

**Files:**

- Create: `apps/desktop/src/stores/session/hydrate-chat.ts`
- Test: `apps/desktop/src/stores/session/__tests__/hydrate-chat.test.ts`

**Step 1: Write the failing test** — covers: user+summary hydration (reuse `convertAssistantMessage` logic from `hydrate-messages.ts`), and a separate `hydrateIntermediates(turnDto, entries)` that produces the intermediate UIMessages and merges toolResults into preceding assistant tool_call parts (port `mergeToolResult`).

**Step 2: Run to verify it fails** → FAIL (module missing).

**Step 3: Implement** — extract the shared `convertAssistantMessage` / `mergeToolResult` / `extractText` helpers from `hydrate-messages.ts` into a shared module both hydrators import (DRY). `hydrateChatSummaries` produces only user + summary UIMessages + turn metadata. `hydrateIntermediates` produces the middle UIMessages for one turn.

**Step 4: Run to verify it passes** → PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/session/hydrate-chat.ts apps/desktop/src/stores/session/__tests__/hydrate-chat.test.ts
git commit -m "feat(desktop): hydrateChatSummaries + hydrateIntermediates"
```

---

### Task 3.4: `loadIntermediates` + `evictIntermediates` actions

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts`
- Modify: `apps/desktop/src/stores/session/session-store.ts`
- Test: `apps/desktop/src/stores/server/__tests__/actions.test.ts`

**Step 1: Write the failing test** — `loadIntermediates(sessionId, turnId)` fetches `/turns/:turnId/intermediates`, hydrates, inserts into the store at the correct position (before the summary), sets `intermediatesLoaded=true`. `evictIntermediates(sessionId, turnId)` removes them and sets `intermediatesLoaded=false`.

**Step 2: Run to verify it fails** → FAIL.

**Step 3: Implement** — store needs an action that splices intermediate UIMessages into `messageOrder` before the summary id and tracks them per-turn for eviction. Store intermediate ids per turn so eviction knows what to remove.

**Step 4: Run to verify it passes** → PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/server/actions.ts apps/desktop/src/stores/session/session-store.ts apps/desktop/src/stores/server/__tests__/actions.test.ts
git commit -m "feat(desktop): loadIntermediates + evictIntermediates actions"
```

---

## Phase 4: Client UI — fetch-on-expand, evict-on-collapse, retire positional zip

### Task 4.1: `SessionTurn` fetches on expand, evicts on collapse

**Files:**

- Modify: `apps/desktop/src/components/chat-area/timeline/session-turn.tsx:74,90-97,153`
- Test: `apps/desktop/src/components/chat-area/timeline/__tests__/session-turn.test.tsx`

**Step 1: Write the failing test**

```tsx
it("loads intermediates on expand, evicts on collapse", async () => {
  const loadIntermediates = vi.fn();
  const evictIntermediates = vi.fn();
  const { getByRole } = render(() => (
    <SessionTurn
      turn={() => collapsedFinishedTurn()}
      isStreaming={() => false}
      /* inject actions via mocked store */
    />
  ));
  // initial: collapsed, intermediates not loaded
  await fireEvent.click(getByRole("button"));
  expect(loadIntermediates).toHaveBeenCalledWith("sess-1", "t1");
  await fireEvent.click(getByRole("button"));
  expect(evictIntermediates).toHaveBeenCalledWith("sess-1", "t1");
});
```

**Step 2: Run to verify it fails** → FAIL.

**Step 3: Implement**

In `SessionTurn`, replace the auto-collapse `createEffect` (lines 90-97) and the toggle handler (line 153). The expand/collapse now also drives fetch/evict:

```tsx
const { actions } = useStore();
const sessionId = /* passed via props or context — add sessionId to SessionTurnProps */;

const handleToggle = () => {
  setExpanded((e) => {
    const next = !e;
    const turnId = turn().id;
    if (next) {
      void actions.loadIntermediates(sessionId, turnId); // fetch on expand
    } else {
      actions.evictIntermediates(sessionId, turnId); // evict on collapse
    }
    return next;
  });
};
```

> `SessionTurn` needs `sessionId`. `MessageTimeline` has access to the active session via context — thread it through `SessionTurnProps`. Update `message-timeline.tsx` to pass it.

The auto-collapse-on-finalize effect stays (so a finished turn collapses and evicts), but eviction on auto-collapse should also fire — call `actions.evictIntermediates` in that effect when transitioning to collapsed.

**Step 4: Run to verify it passes** → PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/chat-area/timeline/session-turn.tsx apps/desktop/src/components/chat-area/timeline/__tests__/session-turn.test.tsx
git commit -m "feat(desktop): SessionTurn fetches intermediates on expand, evicts on collapse"
```

---

### Task 4.2: Re-measure turn height when intermediates load

**Files:**

- Modify: `apps/desktop/src/components/chat-area/timeline/message-timeline.tsx` (expose `bumpMeasure` via context or callback)
- Modify: `apps/desktop/src/components/chat-area/timeline/session-turn.tsx` (call it when intermediates arrive)

**Step 1: Write the failing test** — after `loadIntermediates` resolves, a `onHeightChanged`/`bumpMeasure` callback fires for that turn.

**Step 2: Run to verify it fails** → FAIL.

**Step 3: Implement**

`createVirtualList` exposes `bumpMeasure()` (already used at `message-timeline.tsx:69`). Thread a callback from `MessageTimeline` down to `SessionTurn` (e.g. via props or a small context) that calls `virtual.bumpMeasure()` after intermediates load. Use a `createEffect(on(() => store.turns[turnId]?.intermediatesLoaded, ...))` inside `SessionTurn` to trigger it.

**Step 4: Run to verify it passes** → PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/chat-area/timeline/message-timeline.tsx apps/desktop/src/components/chat-area/timeline/session-turn.tsx
git commit -m "fix(desktop): re-measure turn height when intermediates load"
```

---

### Task 4.3: Migrate view callers to `loadChat`; retire positional timing zip

**Files:**

- Modify: `apps/desktop/src/components/chat-area/task-chat-view.tsx:17`
- Modify: `apps/desktop/src/components/onboarding/onboarding-panel.tsx` (the `loadMessages` call added in the prior fix)
- Modify: `apps/desktop/src/stores/session/turn-projection.ts:66-79`
- Test: `apps/desktop/src/stores/session/__tests__/turn-projection.test.ts`

**Step 1: Write the failing test** — `buildChatTurns` no longer zips timings positionally; it reads per-turn `startedAt`/`endedAt` from the turn metadata embedded by `loadChatTurns`.

**Step 2: Run to verify it fails** → FAIL.

**Step 3: Implement**

- Swap `actions.loadMessages(id)` → `actions.loadChat(id)` in both view `onMount`/effect sites.
- In `turn-projection.ts`, replace the positional zip (lines 66-79) with a join on turn id: turns built from the store's `turns` metadata carry their own `startedAt`/`endedAt`; messages are grouped under the matching turn.

**Step 4: Run to verify it passes** → `vp run desktop#test` → PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/chat-area/task-chat-view.tsx apps/desktop/src/components/onboarding/onboarding-panel.tsx apps/desktop/src/stores/session/turn-projection.ts apps/desktop/src/stores/session/__tests__/turn-projection.test.ts
git commit -m "refactor(desktop): views load via loadChat; retire positional turn-timing zip"
```

---

## Phase 5: Verification

### Task 5.1: Full suite + typecheck + lint

**Step 1:** `vp run -r test` — all packages pass.
**Step 2:** `vp run desktop#typecheck` and `vp run '@sakti-code/server#typecheck'` — no errors.
**Step 3:** `vp check` — clean (run `vp check --fix` if formatting drift, then re-run).

### Task 5.2: Manual memory + behavior smoke test

```
vp run desktop#dev
```

1. Open a project with a long build session (many tool calls). Confirm: only summaries render; "Worked for…" collapses by default.
2. Expand a turn → intermediates load and render; collapse → intermediates evicted (verify via devtools memory or a debug log).
3. Switch between 4+ session tabs → confirm the oldest is evicted (LRU) and returning to it re-loads summaries (snappy, in-process SQLite).
4. Fork a session (`POST /fork` via UI if available) → confirm forked history renders with turns intact.
5. Trigger compaction + an OM cycle mid-session → confirm those entries attribute to the current turn and render correctly.

---

## Out of scope (explicit)

- **Per-text truncation (Level 2):** capping bash/thinking strings + fetch-full-on-demand. Deferred.
- **Infinite scroll (WhatsApp-style):** older-turn pagination on scroll-up. Deferred; the unified store makes prepend-to-store the natural future shape.
- **Migrating the whole data layer to TanStack Query:** rejected — WS-push + streaming fits the unified Solid store better.
- **Removing the legacy `GET /sessions/:id/messages` endpoint:** kept for replay/other consumers; not deprecated in this plan.
