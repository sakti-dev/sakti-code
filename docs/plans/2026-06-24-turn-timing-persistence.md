# Turn Timing Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist per-turn timing (start/end) in the database so accurate durations survive page reloads, and display "Worked for Xh Ym Zs" in the UI.

**Architecture:** A new `turns` table stores `started_at`/`ended_at` per turn. The server's WS handler creates/finalizes turn rows around `runPrompt`. A REST endpoint serves them. The desktop loads timings alongside messages and attaches them to `ChatTurn`s. No agent package changes — the server manages turns as a side-effect of the agent stream.

**Tech Stack:** Drizzle ORM + node:sqlite (DB), Hono REST + WS (server), SolidJS stores (desktop), Vitest (testing).

---

## Key Design Decisions

1. **`turn_start`/`turn_end` fire multiple times per user prompt** (one per LLM call in the agent loop). Use `agent_start`/`agent_end` instead — they fire once per `harness.prompt()`.
2. **Turns table is server-managed.** The agent package is untouched. The WS handler wraps `runPrompt` with DB writes.
3. **Integer timestamps (ms epoch)** everywhere. No ISO strings.
4. **Timing flows through the store as a parallel array** (`turnTimings: TurnTiming[]`), matched to `ChatTurn[]` by position.
5. **`exactOptionalPropertyTypes` is on** — use conditional spreads, never pass `undefined` explicitly.

---

### Task 1: Add `turns` table to Drizzle schema

**Files:**

- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/src/__tests__/turns-schema.test.ts`

**Step 1: Write the failing test**

```ts
// packages/db/src/__tests__/turns-schema.test.ts
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../init.ts";

describe("turns table schema", () => {
  let tmpDir: string;
  let db: Awaited<ReturnType<typeof initDatabase>>;
  let rawDb: DatabaseSync;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    rawDb = new DatabaseSync(join(tmpDir, "test.db"));
    db = initDatabase(rawDb);
  });

  afterAll(() => {
    rawDb.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the turns table", () => {
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='turns'");
    expect(tables).toHaveLength(1);
  });

  it("has expected columns", () => {
    const cols = db.all("PRAGMA table_info(turns)") as {
      name: string;
      type: string;
      notnull: number;
    }[];
    const colMap = new Map(cols.map((c) => [c.name, c]));
    expect(colMap.get("id")?.type).toBe("text");
    expect(colMap.get("session_id")?.type).toBe("text");
    expect(colMap.get("sequence")?.type).toBe("integer");
    expect(colMap.get("started_at")?.type).toBe("integer");
    expect(colMap.get("ended_at")?.type).toBe("integer");
    expect(colMap.get("created_at")?.type).toBe("integer");
    expect(colMap.get("ended_at")?.notnull).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/db && nub run test -- --reporter=verbose turns-schema 2>&1 | head -20
```

Expected: FAIL — table `turns` does not exist.

**Step 3: Add the table to schema.ts**

Add after the `sessionEntries` definition in `packages/db/src/schema.ts`:

```ts
export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, {
        onDelete: "cascade",
      }),
    sequence: integer("sequence").notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("turns_session_id_sequence_idx").on(table.sessionId, table.sequence)],
);
```

**Step 4: Generate the migration**

```bash
cd packages/db && nub run db:generate
```

Expected: A new migration folder appears under `packages/db/migrations/` with a `CREATE TABLE turns` SQL file.

**Step 5: Run test to verify it passes**

```bash
cd packages/db && nub run test -- turns-schema
```

Expected: PASS

**Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/__tests__/turns-schema.test.ts packages/db/migrations/
git commit -m "feat(db): add turns table for turn timing persistence"
```

---

### Task 2: Implement TurnRepo

**Files:**

- Create: `packages/db/src/repos/turns.ts`
- Test: `packages/db/src/repos/__tests__/turns.test.ts`

**Step 1: Write the failing test**

```ts
// packages/db/src/repos/__tests__/turns.test.ts
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initDatabase } from "../../init.ts";
import { ProjectRepo } from "../index.ts";
import { SessionRepo } from "../index.ts";
import { TurnRepo } from "../turns.ts";

describe("TurnRepo", () => {
  let tmpDir: string;
  let rawDb: DatabaseSync;
  let db: Awaited<ReturnType<typeof initDatabase>>;
  let projects: ProjectRepo;
  let sessions: SessionRepo;
  let turns: TurnRepo;
  let sessionId: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "test-XXXXXX"));
    rawDb = new DatabaseSync(join(tmpDir, "test.db"));
    db = initDatabase(rawDb);
    projects = new ProjectRepo(db);
    sessions = new SessionRepo(db);
    turns = new TurnRepo(db);
    const project = projects.create("p", "/tmp/test");
    const session = sessions.create(project.id, "model-1");
    sessionId = session.id;
  });

  afterAll(() => {
    rawDb.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create inserts a turn with auto-incrementing sequence", () => {
    const turn = turns.create(sessionId, 1000);
    expect(turn.sequence).toBe(0);
    expect(turn.startedAt).toBe(1000);
    expect(turn.endedAt).toBeNull();

    const turn2 = turns.create(sessionId, 2000);
    expect(turn2.sequence).toBe(1);
  });

  it("finalize sets endedAt", () => {
    const turn = turns.create(sessionId, 3000);
    turns.finalize(turn.id, 5000);
    const list = turns.listBySession(sessionId);
    const found = list.find((t) => t.id === turn.id);
    expect(found?.endedAt).toBe(5000);
  });

  it("finalizeLatest only finalizes the last unfinalized turn", () => {
    turns.create(sessionId, 6000);
    turns.finalizeLatest(sessionId, 7000);
    const list = turns.listBySession(sessionId);
    const last = list.at(-1);
    expect(last?.endedAt).toBe(7000);
  });

  it("finalizeLatest is a no-op when last turn is already finalized", () => {
    const before = turns.listBySession(sessionId).at(-1);
    turns.finalizeLatest(sessionId, 99999);
    const after = turns.listBySession(sessionId).at(-1);
    expect(after?.endedAt).toBe(before?.endedAt);
  });

  it("listBySession returns turns ordered by sequence", () => {
    const list = turns.listBySession(sessionId);
    expect(list.length).toBeGreaterThan(0);
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.sequence).toBeGreaterThan(list[i - 1]!.sequence);
    }
  });

  it("listBySession returns empty for unknown session", () => {
    expect(turns.listBySession("nonexistent")).toEqual([]);
  });

  it("copyForFork copies all turns to a new session", () => {
    const project2 = projects.create("p2", "/tmp/test2");
    const session2 = sessions.create(project2.id, "model-1");
    turns.copyForFork(sessionId, session2.id);
    const sourceTurns = turns.listBySession(sessionId);
    const forkedTurns = turns.listBySession(session2.id);
    expect(forkedTurns).toHaveLength(sourceTurns.length);
    expect(forkedTurns[0]!.sequence).toBe(sourceTurns[0]!.sequence);
    expect(forkedTurns[0]!.startedAt).toBe(sourceTurns[0]!.startedAt);
    expect(forkedTurns[0]!.id).not.toBe(sourceTurns[0]!.id);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/db && nub run test -- turns.test
```

Expected: FAIL — module not found.

**Step 3: Implement TurnRepo**

```ts
// packages/db/src/repos/turns.ts
import { eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../init.ts";
import { turns } from "../schema.ts";

export interface TurnRow {
  id: string;
  sessionId: string;
  sequence: number;
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
}

export class TurnRepo {
  constructor(private readonly db: DrizzleDB) {}

  create(sessionId: string, startedAt: number): TurnRow {
    const row = this.db
      .select({ max: sql<number>`coalesce(max(sequence), -1)` })
      .from(turns)
      .where(eq(turns.sessionId, sessionId))
      .get();
    const sequence = (row?.max ?? -1) + 1;
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db.insert(turns).values({ id, sessionId, sequence, startedAt, createdAt }).run();
    return { id, sessionId, sequence, startedAt, endedAt: null, createdAt };
  }

  finalize(id: string, endedAt: number): void {
    this.db.update(turns).set({ endedAt }).where(eq(turns.id, id)).run();
  }

  finalizeLatest(sessionId: string, endedAt: number): void {
    const list = this.listBySession(sessionId);
    const latest = list.at(-1);
    if (latest && latest.endedAt === null) {
      this.finalize(latest.id, endedAt);
    }
  }

  listBySession(sessionId: string): TurnRow[] {
    return this.db
      .select()
      .from(turns)
      .where(eq(turns.sessionId, sessionId))
      .orderBy(turns.sequence)
      .all();
  }

  copyForFork(sourceSessionId: string, targetSessionId: string): void {
    const source = this.listBySession(sourceSessionId);
    for (const turn of source) {
      this.db
        .insert(turns)
        .values({
          id: crypto.randomUUID(),
          sessionId: targetSessionId,
          sequence: turn.sequence,
          startedAt: turn.startedAt,
          ...(turn.endedAt === null ? {} : { endedAt: turn.endedAt }),
          createdAt: Date.now(),
        })
        .run();
    }
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd packages/db && nub run test -- turns.test
```

Expected: PASS

**Step 5: Export from index.ts**

Add to `packages/db/src/index.ts`:

```ts
export { TurnRepo, type TurnRow } from "./repos/turns.ts";
```

**Step 6: Commit**

```bash
git add packages/db/src/repos/turns.ts packages/db/src/repos/__tests__/turns.test.ts packages/db/src/index.ts
git commit -m "feat(db): add TurnRepo for turn timing CRUD"
```

---

### Task 3: Inject TurnRepo into server context

**Files:**

- Modify: `apps/server/src/context.ts`

**Step 1: Add TurnRepo to ServerContext and createContext**

In `apps/server/src/context.ts`:

1. Add import:

```ts
import {
  type DrizzleDB,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
  SqliteSessionStorage,
  TurnRepo,
} from "@sakti-code/db";
```

2. Add to `ServerContext.repos`:

```ts
repos: {
  projects: ProjectRepo;
  sessions: SessionRepo;
  settings: SettingsRepo;
  turns: TurnRepo;
}
```

3. Add to `createContext` return:

```ts
    repos: {
      projects: new ProjectRepo(db),
      sessions: new SessionRepo(db),
      settings: new SettingsRepo(db),
      turns: new TurnRepo(db),
    },
```

**Step 2: Typecheck**

```bash
cd apps/server && nub run typecheck
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/server/src/context.ts
git commit -m "feat(server): inject TurnRepo into server context"
```

---

### Task 4: WS handler creates and finalizes turns

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts:151-173` (the `runAgentStream` function)
- Test: `apps/server/src/agent/__tests__/ws-turn-timing.test.ts`

**Step 1: Write the failing test**

```ts
// apps/server/src/agent/__tests__/ws-turn-timing.test.ts
import { describe, expect, it } from "vitest";
import { makeContext } from "../../__tests__/helpers.ts";
import { seedEntries } from "../../__tests__/entry-helpers.ts";

describe("WS turn timing persistence", () => {
  it("creates a turn row when a prompt stream starts", async () => {
    const ctx = await makeContext();
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    // Simulate: runAgentStream creates a turn before running
    const turn = ctx.repos.turns.create(session.id, Date.now());
    expect(turn.sequence).toBe(0);
    expect(turn.endedAt).toBeNull();

    // After run completes (or errors), finalize
    ctx.repos.turns.finalizeLatest(session.id, Date.now());
    const turns = ctx.repos.turns.listBySession(session.id);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.endedAt).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/server && nub run test -- ws-turn-timing
```

Expected: FAIL — `ctx.repos.turns` does not exist (if Task 3 not yet committed) or test setup issue.

**Step 3: Modify `runAgentStream` to create/finalize turns**

Replace the `runAgentStream` function in `apps/server/src/agent/ws-handler.ts` (lines 151-173):

```ts
async function runAgentStream(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  storage: SessionStorage,
  ws: WsHandle,
) {
  const turn = ctx.repos.turns.create(sessionId, Date.now());
  try {
    await runPrompt(ctx, sessionId, message, storage, (event) => {
      ws.send({
        event,
        sessionId,
        type: "event",
      } satisfies EventFrame);
    });
  } catch (err) {
    ws.send({
      error: err instanceof Error ? err.message : String(err),
      sessionId,
      type: "error",
    } satisfies ErrorFrame);
  } finally {
    ctx.repos.turns.finalizeLatest(sessionId, Date.now());
  }
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/server && nub run test -- ws-turn-timing
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/ws-turn-timing.test.ts
git commit -m "feat(server): persist turn timing in WS handler"
```

---

### Task 5: REST endpoint for turns

**Files:**

- Create: `apps/server/src/routes/sessions/turns.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/__tests__/turns-routes.test.ts`

**Step 1: Write the failing test**

```ts
// apps/server/src/__tests__/turns-routes.test.ts
import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.ts";
import { turnsRoutes } from "../routes/sessions/turns.ts";

describe("GET /api/sessions/:id/turns", () => {
  it("returns turns for a session ordered by sequence", async () => {
    const { app, ctx } = await makeApp([turnsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "m");

    ctx.repos.turns.create(session.id, 1000);
    ctx.repos.turns.create(session.id, 2000);

    const res = await app.request(`http://localhost/api/sessions/${session.id}/turns`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].sequence).toBe(0);
    expect(body[1].sequence).toBe(1);
    expect(body[0].startedAt).toBe(1000);
  });

  it("returns empty array for session with no turns", async () => {
    const { app, ctx } = await makeApp([turnsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "m");

    const res = await app.request(`http://localhost/api/sessions/${session.id}/turns`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/server && nub run test -- turns-routes
```

Expected: FAIL — module not found.

**Step 3: Create the route module**

```ts
// apps/server/src/routes/sessions/turns.ts
import { Hono } from "hono";
import { getCtx } from "../../context.ts";

export const turnsRoutes = new Hono().basePath("/sessions").get("/:id/turns", (c) => {
  const ctx = getCtx(c);
  const turns = ctx.repos.turns.listBySession(c.req.param("id"));
  return c.json(turns);
});
```

**Step 4: Mount in app.ts**

In `apps/server/src/app.ts`:

1. Add import:

```ts
import { turnsRoutes } from "./routes/sessions/turns.ts";
```

2. Add `.route("/", turnsRoutes)` to the `rest` chain (after `statsRoutes` or anywhere in the chain).

**Step 5: Run test to verify it passes**

```bash
cd apps/server && nub run test -- turns-routes
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/server/src/routes/sessions/turns.ts apps/server/src/__tests__/turns-routes.test.ts apps/server/src/app.ts
git commit -m "feat(server): add GET /sessions/:id/turns endpoint"
```

---

### Task 6: Fork copies turns

**Files:**

- Modify: `apps/server/src/routes/sessions/forking.ts:45-50` (after `forkedStorage.forkFrom`)
- Test: `apps/server/src/__tests__/fork-turns.test.ts`

**Step 1: Write the failing test**

```ts
// apps/server/src/__tests__/fork-turns.test.ts
import { describe, expect, it } from "vitest";
import { makeApp } from "./helpers.ts";
import { forkingRoutes } from "../routes/sessions/forking.ts";
import { seedEntries } from "./entry-helpers.ts";

describe("Fork copies turns", () => {
  it("copied session has same turn timings", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "m");

    // Seed a turn
    ctx.repos.turns.create(session.id, 1000);
    ctx.repos.turns.finalizeLatest(session.id, 5000);
    await seedEntries(ctx.db, session.id, [{ role: "user", content: "hi" }]);

    const res = await app.request(`http://localhost/api/sessions/${session.id}/fork`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const forked = await res.json();

    const sourceTurns = ctx.repos.turns.listBySession(session.id);
    const forkedTurns = ctx.repos.turns.listBySession(forked.id);
    expect(forkedTurns).toHaveLength(sourceTurns.length);
    expect(forkedTurns[0]!.startedAt).toBe(sourceTurns[0]!.startedAt);
    expect(forkedTurns[0]!.endedAt).toBe(sourceTurns[0]!.endedAt);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/server && nub run test -- fork-turns
```

Expected: FAIL — forked session has no turns.

**Step 3: Add turn copy to forking route**

In `apps/server/src/routes/sessions/forking.ts`, after `await forkedStorage.forkFrom(id)` (line 46) and before the `return c.json(newSession)`:

```ts
ctx.repos.turns.copyForFork(id, newSession.id);
```

**Step 4: Run test to verify it passes**

```bash
cd apps/server && nub run test -- fork-turns
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/sessions/forking.ts apps/server/src/__tests__/fork-turns.test.ts
git commit -m "feat(server): copy turn timings on session fork"
```

---

### Task 7: Desktop types and session store changes

**Files:**

- Modify: `apps/desktop/src/stores/types.ts` — add `TurnTiming`
- Modify: `apps/desktop/src/stores/session/session-store.ts` — add `turnTimings` + actions
- Test: `apps/desktop/src/stores/session/__tests__/session-store.test.ts`

**Step 1: Write the failing tests**

Add to the bottom of `apps/desktop/src/stores/session/__tests__/session-store.test.ts`:

```ts
describe("session store — turn timings", () => {
  it("startTurn adds a new timing entry", () => {
    const session = createSessionStore();
    session.actions.addMessage(makeMessage({ id: "m1" }));

    session.actions.startTurn(1000);
    expect(session.store.turnTimings).toHaveLength(1);
    expect(session.store.turnTimings[0]).toEqual({
      startedAt: 1000,
      endedAt: null,
    });
  });

  it("finalizeTurn sets endedAt on the last timing", () => {
    const session = createSessionStore();
    session.actions.startTurn(1000);
    session.actions.finalizeTurn(5000);

    expect(session.store.turnTimings).toHaveLength(1);
    expect(session.store.turnTimings[0]?.endedAt).toBe(5000);
  });

  it("finalizeTurn is a no-op when no active turn", () => {
    const session = createSessionStore();
    session.actions.finalizeTurn(9999);
    expect(session.store.turnTimings).toHaveLength(0);
  });

  it("finalizeTurn does not overwrite already-finalized turn", () => {
    const session = createSessionStore();
    session.actions.startTurn(1000);
    session.actions.finalizeTurn(5000);
    session.actions.finalizeTurn(9999);

    expect(session.store.turnTimings[0]?.endedAt).toBe(5000);
  });

  it("loadTurnTimings replaces all timings", () => {
    const session = createSessionStore();
    session.actions.startTurn(1000);
    session.actions.loadTurnTimings([
      { startedAt: 100, endedAt: 200 },
      { startedAt: 300, endedAt: null },
    ]);
    expect(session.store.turnTimings).toHaveLength(2);
    expect(session.store.turnTimings[0]?.startedAt).toBe(100);
  });

  it("reset clears turnTimings", () => {
    const session = createSessionStore();
    session.actions.startTurn(1000);
    session.actions.reset();
    expect(session.store.turnTimings).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/desktop && nub run test -- session-store.test
```

Expected: FAIL — `turnTimings` and `startTurn` do not exist.

**Step 3: Add `TurnTiming` to types.ts**

In `apps/desktop/src/stores/types.ts`, add after `StreamState`:

```ts
export interface TurnTiming {
  endedAt: number | null;
  startedAt: number;
}
```

**Step 4: Add to session-store.ts**

1. Import `TurnTiming`:

```ts
import {
  idleStreamState,
  type MessagePart,
  type StreamState,
  type TurnTiming,
  type UIMessage,
} from "../types.ts";
```

2. Add `turnTimings` to `SessionStoreData`:

```ts
export interface SessionStoreData {
  messageOrder: string[];
  messages: Record<string, UIMessage>;
  proposedSession: ProposedSession | null;
  streaming: StreamState;
  turnTimings: TurnTiming[];
}
```

3. Add actions to `SessionActions`:

```ts
  loadTurnTimings: (timings: TurnTiming[]) => void;
  startTurn: (startedAt: number) => void;
  finalizeTurn: (endedAt: number) => void;
```

4. Initialize `turnTimings: []` in `createStore`.

5. Implement the actions:

```ts
    startTurn(startedAt) {
      setStore("turnTimings", (prev) => [
        ...prev,
        { startedAt, endedAt: null },
      ]);
    },

    finalizeTurn(endedAt) {
      setStore("turnTimings", (prev) => {
        const last = prev.at(-1);
        if (last === undefined || last.endedAt !== null) {
          return prev;
        }
        return [
          ...prev.slice(0, -1),
          { ...last, endedAt },
        ];
      });
    },

    loadTurnTimings(timings) {
      setStore("turnTimings", timings);
    },
```

6. Add `s.turnTimings = [];` to the `reset()` action's `produce` callback.

**Step 5: Run test to verify it passes**

```bash
cd apps/desktop && nub run test -- session-store.test
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/stores/types.ts apps/desktop/src/stores/session/session-store.ts apps/desktop/src/stores/session/__tests__/session-store.test.ts
git commit -m "feat(desktop): add turn timing state to session store"
```

---

### Task 8: Wire turn timing into event reducer and WS client

**Files:**

- Modify: `apps/desktop/src/stores/session/event-reducer.ts` — `agent_start`/`agent_end`/`abort` cases
- Modify: `apps/desktop/src/stores/server/ws-client.ts` — error frame handler
- Test: `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`

**Step 1: Write the failing tests**

Add to the bottom of `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`:

```ts
describe("event reducer — turn timing", () => {
  it("agent_start starts a turn", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeAgentStartEvent());
    expect(session.store.turnTimings).toHaveLength(1);
    expect(session.store.turnTimings[0]?.endedAt).toBeNull();
  });

  it("turn_end does NOT finalize (only agent_end does)", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeAgentStartEvent());
    dispatchEvent(session.actions, batcher, makeTurnEndEvent(makeAssistantMessage("done")));
    expect(session.store.turnTimings[0]?.endedAt).toBeNull();
  });

  it("agent_end finalizes the turn", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeAgentStartEvent());
    const before = Date.now();
    dispatchEvent(session.actions, batcher, makeAgentEndEvent());
    const after = Date.now();
    const endedAt = session.store.turnTimings[0]?.endedAt;
    expect(endedAt).not.toBeNull();
    expect(endedAt!).toBeGreaterThanOrEqual(before);
    expect(endedAt!).toBeLessThanOrEqual(after);
  });

  it("abort finalizes the turn", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeAgentStartEvent());
    dispatchEvent(session.actions, batcher, makeAbortEvent());
    expect(session.store.turnTimings[0]?.endedAt).not.toBeNull();
  });

  it("multiple agent_start/agent_end cycles create multiple timings", () => {
    const { session, batcher } = setup();
    dispatchEvent(session.actions, batcher, makeAgentStartEvent());
    dispatchEvent(session.actions, batcher, makeAgentEndEvent());
    dispatchEvent(session.actions, batcher, makeAgentStartEvent());
    dispatchEvent(session.actions, batcher, makeAgentEndEvent());
    expect(session.store.turnTimings).toHaveLength(2);
    expect(session.store.turnTimings[0]?.endedAt).not.toBeNull();
    expect(session.store.turnTimings[1]?.endedAt).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/desktop && nub run test -- event-reducer.test
```

Expected: FAIL — `turnTimings` not modified by events.

**Step 3: Modify event-reducer.ts**

In the `agent_start` case:

```ts
    case "agent_start":
      actions.setPhase("thinking");
      actions.startTurn(Date.now());
      break;
```

In the `agent_end` and `abort` case:

```ts
    case "agent_end":
    case "abort":
      actions.setPhase("idle");
      actions.clearCurrentMessage();
      actions.clearCurrentTool();
      actions.finalizeTurn(Date.now());
      break;
```

**Step 4: Modify ws-client.ts error handler**

In `apps/desktop/src/stores/server/ws-client.ts`, in the `"error"` case of `handleFrame`, add `finalizeTurn`:

```ts
      case "error": {
        if (!(data.sessionId && data.error)) {
          break;
        }
        const session = sessionRegistry.get(data.sessionId);
        const msgId = session.store.streaming.currentMessageId;
        if (msgId) {
          session.actions.setError(msgId, data.error);
        }
        session.actions.finalizeTurn(Date.now());
        break;
      }
```

**Step 5: Run test to verify it passes**

```bash
cd apps/desktop && nub run test -- event-reducer.test
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/stores/session/event-reducer.ts apps/desktop/src/stores/server/ws-client.ts apps/desktop/src/stores/session/__tests__/event-reducer.test.ts
git commit -m "feat(desktop): wire turn timing into event reducer"
```

---

### Task 9: Attach timing to ChatTurn via buildChatTurns

**Files:**

- Modify: `apps/desktop/src/stores/session/turn-projection.ts`
- Test: `apps/desktop/src/stores/session/__tests__/turn-projection.test.ts`

**Step 1: Write the failing tests**

Add to the bottom of `apps/desktop/src/stores/session/__tests__/turn-projection.test.ts`:

```ts
describe("buildChatTurns — turn timing", () => {
  it("attaches turn timings by sequence position", () => {
    const userMsg: UIMessage = {
      id: "u1",
      role: "user",
      content: "hi",
      parts: [{ type: "text", text: "hi" }],
      isStreaming: false,
      timestamp: 1000,
    };
    const asstMsg: UIMessage = {
      id: "a1",
      role: "assistant",
      content: "hello",
      parts: [{ type: "text", text: "hello" }],
      isStreaming: false,
      timestamp: 2000,
    };

    const turns = buildChatTurns(["u1", "a1"], { u1: userMsg, a1: asstMsg }, "idle", [
      { startedAt: 1000, endedAt: 5000 },
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.startedAt).toBe(1000);
    expect(turns[0]!.endedAt).toBe(5000);
  });

  it("handles missing timings gracefully (null)", () => {
    const userMsg: UIMessage = {
      id: "u1",
      role: "user",
      content: "hi",
      parts: [{ type: "text", text: "hi" }],
      isStreaming: false,
      timestamp: 1000,
    };

    const turns = buildChatTurns(["u1"], { u1: userMsg }, "idle", []);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.startedAt).toBeNull();
    expect(turns[0]!.endedAt).toBeNull();
  });

  it("handles more turns than timings (partial hydration)", () => {
    const userMsg1: UIMessage = {
      id: "u1",
      role: "user",
      content: "a",
      parts: [],
      isStreaming: false,
      timestamp: 1000,
    };
    const userMsg2: UIMessage = {
      id: "u2",
      role: "user",
      content: "b",
      parts: [],
      isStreaming: false,
      timestamp: 2000,
    };

    const turns = buildChatTurns(["u1", "u2"], { u1: userMsg1, u2: userMsg2 }, "idle", [
      { startedAt: 1000, endedAt: 1500 },
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]!.startedAt).toBe(1000);
    expect(turns[0]!.endedAt).toBe(1500);
    expect(turns[1]!.startedAt).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/desktop && nub run test -- turn-projection.test
```

Expected: FAIL — `buildChatTurns` doesn't accept 4th arg, `ChatTurn` has no timing fields.

**Step 3: Modify turn-projection.ts**

1. Import `TurnTiming`:

```ts
import type { MessagePart, TurnTiming, UIMessage } from "../types.ts";
```

2. Add timing fields to `ChatTurn`:

```ts
export interface ChatTurn {
  assistantMessages: UIMessage[];
  endedAt: number | null;
  error: string | null;
  id: string;
  startedAt: number | null;
  userMessage: UIMessage | null;
  working: boolean;
}
```

3. Update `newTurn`:

```ts
function newTurn(userMessage: UIMessage | null, id: string): ChatTurn {
  return {
    id,
    userMessage,
    assistantMessages: [],
    working: false,
    error: null,
    startedAt: null,
    endedAt: null,
  };
}
```

4. Add `turnTimings` parameter to `buildChatTurns` and attach:

```ts
export function buildChatTurns(
  messageOrder: string[],
  messages: Record<string, UIMessage>,
  streamingPhase: string,
  turnTimings: TurnTiming[] = [],
): ChatTurn[] {
  // ... existing turn-building logic unchanged ...

  // Attach timing by sequence position
  const count = Math.min(turns.length, turnTimings.length);
  for (let i = 0; i < count; i++) {
    turns[i]!.startedAt = turnTimings[i]!.startedAt;
    turns[i]!.endedAt = turnTimings[i]!.endedAt;
  }

  return turns;
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/desktop && nub run test -- turn-projection.test
```

Expected: PASS

**Step 5: Update callers to pass turnTimings**

In `apps/desktop/src/components/chat/task-chat-view.tsx`, update the `turns` memo:

```ts
const turns = createMemo(() => {
  const session = sessionStore();
  if (!session) {
    return [];
  }
  return buildChatTurns(
    session.store.messageOrder,
    session.store.messages,
    session.store.streaming.phase,
    session.store.turnTimings,
  );
});
```

Also update `apps/desktop/src/components/onboarding/onboarding-panel.tsx` if it calls `buildChatTurns` — pass `session.store.turnTimings` or `[]`.

**Step 6: Typecheck + test**

```bash
cd apps/desktop && nub run typecheck && nub run test
```

Expected: PASS (all tests)

**Step 7: Commit**

```bash
git add apps/desktop/src/stores/session/turn-projection.ts apps/desktop/src/stores/session/__tests__/turn-projection.test.ts apps/desktop/src/components/chat/task-chat-view.tsx
git commit -m "feat(desktop): attach turn timing to ChatTurn in buildChatTurns"
```

---

### Task 10: Load turn timings on message hydration

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts` — `loadMessages` function

**Step 1: Modify `loadMessages` to also fetch turns**

In `apps/desktop/src/stores/server/actions.ts`, replace the `loadMessages` action:

```ts
    async loadMessages(sessionId) {
      try {
        const [messagesRes, turnsRes] = await Promise.all([
          api.api.sessions[":id"].messages.$get({
            param: { id: sessionId },
          }),
          api.api.sessions[":id"].turns.$get({
            param: { id: sessionId },
          }),
        ]);

        if (!messagesRes.ok) {
          return;
        }
        const messages = (await messagesRes.json()) as AgentMessage[];
        const uiMessages = hydrateSessionMessages(messages);
        const session = sessionRegistry.get(sessionId);
        session.actions.loadMessages(uiMessages);

        if (turnsRes.ok) {
          const turns = (await turnsRes.json()) as Array<{
            startedAt: number;
            endedAt: number | null;
          }>;
          session.actions.loadTurnTimings(
            turns.map((t) => ({
              startedAt: t.startedAt,
              endedAt: t.endedAt,
            }))
          );
        }
      } catch (error) {
        setLastError(
          error instanceof Error ? error.message : "Failed to load messages"
        );
      }
    },
```

**Step 2: Typecheck**

```bash
cd apps/desktop && nub run typecheck
```

Expected: PASS (the `App` type from server includes the turns route automatically via Hono RPC)

**Step 3: Commit**

```bash
git add apps/desktop/src/stores/server/actions.ts
git commit -m "feat(desktop): load turn timings alongside messages"
```

---

### Task 11: SessionTurn UI — "Worked for" header with live timer

**Files:**

- Modify: `apps/desktop/src/components/chat/timeline/session-turn.tsx`
- Test: `apps/desktop/src/components/chat/parts/__tests__/session-turn-timing.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/desktop/src/components/chat/parts/__tests__/session-turn-timing.test.tsx
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { SessionTurn } from "../../timeline/session-turn";
import type { ChatTurn } from "~/stores/session/turn-projection";
import { createSignal } from "solid-js";

function makeTurn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: "t1",
    userMessage: null,
    assistantMessages: [],
    working: false,
    error: null,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

describe("SessionTurn timing header", () => {
  it("shows 'Worked for' when turn has startedAt and endedAt", () => {
    const [turn] = createSignal<ChatTurn>(makeTurn({ startedAt: 1000, endedAt: 62000 }));
    const [streaming] = createSignal(false);
    const div = document.createElement("div");
    render(() => <SessionTurn turn={turn} isStreaming={streaming} />, div);
    expect(div.textContent).toContain("Worked for");
    expect(div.textContent).toContain("1m 2s");
  });

  it("does not show timing when startedAt is null", () => {
    const [turn] = createSignal<ChatTurn>(makeTurn());
    const [streaming] = createSignal(false);
    const div = document.createElement("div");
    render(() => <SessionTurn turn={turn} isStreaming={streaming} />, div);
    expect(div.textContent).not.toContain("Worked for");
    expect(div.textContent).not.toContain("Working for");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/desktop && nub run test -- session-turn-timing
```

Expected: FAIL — no timing header rendered.

**Step 3: Implement the timing header in SessionTurn**

In `apps/desktop/src/components/chat/timeline/session-turn.tsx`:

1. Add imports:

```ts
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
```

2. Add duration formatter:

```ts
function formatWorkDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
```

3. Add live timer + duration memo inside the component:

```ts
export function SessionTurn(props: SessionTurnProps): JSX.Element {
  const turn = props.turn;
  const [liveMs, setLiveMs] = createSignal(0);

  createEffect(() => {
    const startedAt = turn().startedAt;
    const endedAt = turn().endedAt;
    if (startedAt === null || endedAt !== null) {
      setLiveMs(0);
      return;
    }
    setLiveMs(Math.max(0, Date.now() - startedAt));
    const timer = setInterval(() => {
      setLiveMs(Math.max(0, Date.now() - startedAt));
    }, 1000);
    onCleanup(() => clearInterval(timer));
  });

  const durationLabel = createMemo(() => {
    const { startedAt, endedAt } = turn();
    if (startedAt === null) {
      return null;
    }
    if (endedAt !== null) {
      return formatWorkDuration(endedAt - startedAt);
    }
    return formatWorkDuration(liveMs());
  });
```

4. Add the timing header JSX between the user message `<Show>` and the assistant messages `<Show>`:

```tsx
<Show when={durationLabel()}>
  <div class="flex items-center gap-2 border-border/50 border-b px-3 py-1.5 text-muted-foreground text-xs">
    <Show when={turn().endedAt === null}>
      <div class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
    </Show>
    <span>
      {turn().endedAt !== null ? "Worked for " : "Working for "}
      {durationLabel()}
    </span>
  </div>
</Show>
```

5. Remove the old "Waiting for response…" block:

```tsx
// DELETE this entire Show block:
// <Show when={turn().assistantMessages.length === 0 && turn().working}>
//   <div class="flex items-center justify-center py-8 ...">
//     Waiting for response…
//   </div>
// </Show>
```

**Step 4: Run test to verify it passes**

```bash
cd apps/desktop && nub run test -- session-turn-timing
```

Expected: PASS

**Step 5: Full typecheck + all tests**

```bash
cd apps/desktop && nub run typecheck && nub run test
```

Expected: ALL PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/components/chat/timeline/session-turn.tsx apps/desktop/src/components/chat/parts/__tests__/session-turn-timing.test.tsx
git commit -m "feat(desktop): add 'Worked for' timing header with live timer"
```

---

### Task 12: Final verification

**Step 1: Run all tests across all packages**

```bash
nub run typecheck
cd packages/db && nub run test
cd packages/agent && nub run test
cd packages/tools && nub run test
cd apps/server && nub run test
cd apps/desktop && nub run test
```

**Step 2: Format + lint**

```bash
nubx ultracite fix
```

**Step 3: Final commit if anything changed**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```

---

## Summary

| Task | Package | What                                                                         |
| ---- | ------- | ---------------------------------------------------------------------------- |
| 1    | db      | `turns` table + migration                                                    |
| 2    | db      | TurnRepo (create, finalize, listBySession, copyForFork)                      |
| 3    | server  | Inject TurnRepo into context                                                 |
| 4    | server  | WS handler creates/finalizes turns around `runPrompt`                        |
| 5    | server  | REST `GET /sessions/:id/turns`                                               |
| 6    | server  | Fork copies turns                                                            |
| 7    | desktop | TurnTiming type + session store actions                                      |
| 8    | desktop | Event reducer: `agent_start` → startTurn, `agent_end`/`abort` → finalizeTurn |
| 9    | desktop | buildChatTurns attaches timing by sequence                                   |
| 10   | desktop | loadMessages fetches `/turns` alongside `/messages`                          |
| 11   | desktop | SessionTurn "Worked for" header with live timer                              |
| 12   | all     | Final verification                                                           |
