# Unify Persistence on SqliteSessionStorage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the legacy `messages` table / `MessageRepo` / `SqliteSessionStore` so all session data flows through the entry-tree (`session_entries`) via `SqliteSessionStorage`, matching pi's architecture where stats are derived on-demand from assistant message usage and forking copies entry-tree paths.

**Architecture:** Pi derives stats from `AssistantMessage.usage` fields at read time — no costs table needed. Read routes use `buildSessionContext()` (already ported) to project the entry tree to a flat message list. Bash injection writes an entry via `Session.appendMessage()`. Forking copies `session_entries` rows preserving the tree. The legacy `messages` table, `MessageRepo`, `SqliteSessionStore`, and `CostRepo` are deleted.

**Tech Stack:** Bun + Elysia (REST server), bun:sqlite + Drizzle ORM (`packages/db`), Vitest (agent/tools tests), bun:test (db/server tests), `@sakti-code/agent` (Session, buildSessionContext, AgentMessage types).

---

## Context for the implementer

### The problem

After porting pi's agent (the `AgentHarness`), two persistence layers coexist:

1. **`SqliteSessionStorage`** (entry-tree, `session_entries` table) — used by `AgentHarness` via `Session`. This is where all real agent conversations live now.
2. **`SqliteSessionStore` / `MessageRepo`** (message-level, `messages` table) — legacy. Six REST routes still read/write here.

The `messages` table is **blind to real agent traffic**. Stats always returns 0. Forking copies an empty table. Bash inject writes data the agent can't see. Export produces empty HTML.

### Pi's proven approach (from `openspec/references/pi/`)

- **No costs table.** Stats are derived by walking assistant messages and summing `usage.*` (`agent-session.ts:2935-2978`).
- **`buildSessionContext(pathEntries)`** projects the entry tree to a flat `AgentMessage[]` list, handling compaction windowing. Already ported at `packages/agent/src/harness/session.ts:26-103`.
- **Forking** copies path entries (`getEntriesToFork` at `repo-utils.ts:32-50`).
- **Never store flattened messages** — rich `AgentMessage` types round-trip through storage.

### Key types and interfaces

**`AgentMessage`** (from `@sakti-code/agent`) — discriminated union:
- `{ role: "user", content: string | Content[], timestamp: number }`
- `{ role: "assistant", content: ContentBlock[], usage: Usage, stopReason: string, provider: string, model: string, api: string, timestamp: number }`
- `{ role: "toolResult", content: Content[], toolCallId: string, toolName: string, isError: boolean, timestamp: number }`

**`Usage`** shape (from pi-ai):
```ts
{ input: number, output: number, cacheRead: number, cacheWrite: number, totalTokens: number,
  cost: { input: number, output: number, cacheRead: number, cacheWrite: number, total: number } }
```

**`SessionTreeEntry`** — discriminated union of entry kinds (`message`, `compaction`, `branch_summary`, `custom_message`, `leaf`, `label`, etc.). The `message` kind has a `message: AgentMessage` field.

**`SqliteSessionStorage`** (`packages/db/src/session-entry-store.ts`) — implements `SessionStorage` from `@sakti-code/agent`. Stores each entry as a JSON blob in `session_entries.content`. Key methods:
- `getEntries()` — all entries for the session, ordered by sequence
- `getPathToRoot(leafId)` — walks parent chain from leaf to root, returns root-to-leaf order
- `getLeafId()` / `setLeafId()` — reads/writes `sessions.leafId` column
- `appendEntry(entry)` — inserts a row, updates leaf for non-leaf types

### How to seed entries in tests

**Pattern** (from `apps/server/src/__tests__/compaction.test.ts:28-48`):
```ts
import { SqliteSessionStorage } from "@sakti-code/db";

const storage = new SqliteSessionStorage(db, sessionId, {
  id: sessionId,
  createdAt: new Date().toISOString(),
});
let parentId: string | null = null;

// Append a user message entry
const userEntryId = crypto.randomUUID();
await storage.appendEntry({
  id: userEntryId,
  parentId,
  timestamp: new Date().toISOString(),
  type: "message",
  message: { role: "user", content: "Hello", timestamp: Date.now() },
});
parentId = userEntryId;

// Append an assistant message entry (with usage for stats)
const asstEntryId = crypto.randomUUID();
await storage.appendEntry({
  id: asstEntryId,
  parentId,
  timestamp: new Date().toISOString(),
  type: "message",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "Hi there!" }],
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
             cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } },
    stopReason: "stop",
    provider: "openai",
    model: "gpt-4o",
    api: "responses",
    timestamp: Date.now(),
  },
});
parentId = asstEntryId;
```

### Test conventions

- Server tests use `bun:test` (`describe`, `it`, `expect`), NOT vitest.
- The test helper `makeApp(routes)` at `apps/server/src/__tests__/helpers.ts` creates an in-memory DB and composed Elysia app.
- Run server tests: `cd apps/server && bun run test`
- Run agent tests: `bun vitest run packages/agent/`
- Run db tests: `cd packages/db && bun test`
- Typecheck: `bun typecheck`
- Lint+format: `bun x ultracite fix`

### `exactOptionalPropertyTypes: true` is ON

Use conditional spread `...(value !== undefined ? { key: value } : {})` instead of passing `undefined` to optional props.

### `noUncheckedIndexedAccess: true` is ON

Array indexing returns `T | undefined`. Use `!` assertion or guards after `.find()`, `[0]`, `pop()`, etc.

---

## Task 1: Export `buildSessionContext` from agent barrel

**Files:**
- Modify: `packages/agent/src/index.ts:22`

**Step 1: Write a test verifying the export exists**

Create `packages/agent/src/__tests__/barrel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSessionContext, Session } from "@sakti-code/agent";

describe("agent barrel exports", () => {
  it("buildSessionContext is exported", () => {
    expect(typeof buildSessionContext).toBe("function");
  });

  it("Session is exported", () => {
    expect(typeof Session).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run packages/agent/src/__tests__/barrel.test.ts`
Expected: FAIL — `buildSessionContext` is not exported from barrel.

**Step 3: Add the export**

In `packages/agent/src/index.ts`, change line 22 from:

```ts
export { Session } from "./harness/session.ts";
```

to:

```ts
export { buildSessionContext, Session } from "./harness/session.ts";
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run packages/agent/src/__tests__/barrel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/index.ts packages/agent/src/__tests__/barrel.test.ts
git commit -m "feat(agent): export buildSessionContext from barrel"
```

---

## Task 2: Create test helper for seeding entry-tree sessions

**Files:**
- Create: `apps/server/src/__tests__/entry-helpers.ts`

**Step 1: Write the helper**

Create `apps/server/src/__tests__/entry-helpers.ts`:

```ts
import { SqliteSessionStorage } from "@sakti-code/db";
import type { DrizzleDB } from "@sakti-code/db";

export interface SeedMessage {
  role: "user" | "assistant" | "toolResult";
  content: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  toolCallId?: string;
  toolName?: string;
}

/**
 * Seed a session with message entries in the entry tree.
 * Returns the storage instance for further operations.
 */
export async function seedEntries(
  db: DrizzleDB,
  sessionId: string,
  messages: SeedMessage[]
): Promise<SqliteSessionStorage> {
  const storage = new SqliteSessionStorage(db, sessionId, {
    id: sessionId,
    createdAt: new Date().toISOString(),
  });
  let parentId: string | null = null;

  for (const msg of messages) {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    if (msg.role === "user") {
      await storage.appendEntry({
        id,
        parentId,
        timestamp: new Date(timestamp).toISOString(),
        type: "message",
        message: { role: "user", content: msg.content, timestamp },
      });
    } else if (msg.role === "assistant") {
      await storage.appendEntry({
        id,
        parentId,
        timestamp: new Date(timestamp).toISOString(),
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: msg.content }],
          usage: msg.usage ?? {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          provider: "openai",
          model: "test-model",
          api: "responses",
          timestamp,
        },
      });
    } else {
      await storage.appendEntry({
        id,
        parentId,
        timestamp: new Date(timestamp).toISOString(),
        type: "message",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: msg.content }],
          toolCallId: msg.toolCallId ?? "test-call",
          toolName: msg.toolName ?? "test-tool",
          isError: false,
          timestamp,
        },
      });
    }
    parentId = id;
  }

  return storage;
}

/**
 * Create a SqliteSessionStorage for a session, useful in route tests.
 */
export function makeStorage(
  db: DrizzleDB,
  sessionId: string
): SqliteSessionStorage {
  return new SqliteSessionStorage(db, sessionId, {
    id: sessionId,
    createdAt: new Date().toISOString(),
  });
}
```

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && bun typecheck`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add apps/server/src/__tests__/entry-helpers.ts
git commit -m "test(server): add entry-tree test helpers for seeding sessions"
```

---

## Task 3: Migrate stats route to derive from entry tree

**Files:**
- Modify: `apps/server/src/routes/stats.ts` (complete rewrite)
- Modify: `apps/server/src/__tests__/stats.test.ts` (complete rewrite)

**Step 1: Write the failing test**

Replace `apps/server/src/__tests__/stats.test.ts` entirely:

```ts
import { describe, expect, it } from "bun:test";
import { SqliteSessionStorage } from "@sakti-code/db";
import { seedEntries } from "./entry-helpers.ts";
import { statsRoutes } from "../routes/stats.ts";
import { makeApp } from "./helpers.ts";

describe("stats routes", () => {
  it("GET /api/sessions/:id/stats derives messageCount and costs from entries", async () => {
    const { app, ctx } = await makeApp([statsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: "hi there",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 10,
          cacheWrite: 5,
          totalTokens: 165,
          cost: {
            input: 0.001,
            output: 0.002,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.003,
          },
        },
      },
    ]);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/stats`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messageCount).toBe(2);
    expect(body.createdAt).toBe(session.createdAt);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.totalInputTokens).toBe(100);
    expect(body.totalOutputTokens).toBe(50);
    expect(body.totalCostUsd).toBeCloseTo(0.003);
  });

  it("returns zeros for session with no entries", async () => {
    const { app, ctx } = await makeApp([statsRoutes]);
    const project = await ctx.repos.projects.create("empty", "/tmp/empty");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/stats`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messageCount).toBe(0);
    expect(body.totalInputTokens).toBe(0);
    expect(body.totalOutputTokens).toBe(0);
    expect(body.totalCostUsd).toBe(0);
  });

  it("GET /api/sessions/nope/stats returns 404", async () => {
    const { app } = await makeApp([statsRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/stats")
    );
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run test src/__tests__/stats.test.ts`
Expected: FAIL — `body.totalInputTokens` is 0 (reads from legacy `messages`/`costs` which are empty).

**Step 3: Implement the new stats route**

Replace `apps/server/src/routes/stats.ts` entirely:

```ts
import { buildSessionContext } from "@sakti-code/agent";
import type { AgentMessage } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

function deriveStats(messages: AgentMessage[]): {
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
} {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.usage) {
      totalInputTokens += msg.usage.input;
      totalOutputTokens += msg.usage.output;
      totalCostUsd += msg.usage.cost.total;
    }
  }

  return {
    messageCount: messages.length,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
  };
}

export const statsRoutes = new Elysia({ name: "routes.stats" }).get(
  "/api/sessions/:id/stats",
  async ({ params, store }): Promise<Response> => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const storage = new SqliteSessionStorage(ctx.db, params.id, {
      id: params.id,
      createdAt: new Date(session.createdAt).toISOString(),
    });
    const entries = await storage.getPathToRoot(
      await storage.getLeafId()
    );
    const { messages } = buildSessionContext(entries);
    const stats = deriveStats(messages);

    return Response.json({
      ...stats,
      createdAt: session.createdAt,
      durationMs: Date.now() - session.createdAt,
    });
  },
  {
    response: t.Object({
      messageCount: t.Number(),
      totalInputTokens: t.Number(),
      totalOutputTokens: t.Number(),
      totalCostUsd: t.Number(),
      createdAt: t.Number(),
      durationMs: t.Number(),
    }),
  }
);
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && bun run test src/__tests__/stats.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/stats.ts apps/server/src/__tests__/stats.test.ts
git commit -m "feat(server): derive stats from entry tree instead of legacy messages table"
```

---

## Task 4: Migrate sessions/:id/messages route to entry tree

**Files:**
- Modify: `apps/server/src/routes/sessions.ts:66-68` (the `GET /:id/messages` endpoint)

**Step 1: Write the failing test**

Add this test to a new file `apps/server/src/__tests__/session-messages.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { seedEntries } from "./entry-helpers.ts";
import { sessionsRoutes } from "../routes/sessions.ts";
import { makeApp } from "./helpers.ts";

describe("GET /api/sessions/:id/messages", () => {
  it("returns messages from the entry tree", async () => {
    const { app, ctx } = await makeApp([sessionsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/messages`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].role).toBe("user");
    expect(body[1].role).toBe("assistant");
  });

  it("returns empty array for session with no entries", async () => {
    const { app, ctx } = await makeApp([sessionsRoutes]);
    const project = await ctx.repos.projects.create("empty", "/tmp/empty");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/messages`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run test src/__tests__/session-messages.test.ts`
Expected: FAIL — returns empty (reads from legacy `messages` table).

**Step 3: Implement the migration**

In `apps/server/src/routes/sessions.ts`, change the last route (lines 66-68) from:

```ts
  .get("/api/sessions/:id/messages", ({ params, store }) =>
    getCtx(store).repos.messages.loadBySession(params.id)
  );
```

to:

```ts
  .get(
    "/api/sessions/:id/messages",
    async ({ params, store }) => {
      const ctx = getCtx(store);
      const storage = new SqliteSessionStorage(ctx.db, params.id, {
        id: params.id,
        createdAt: new Date().toISOString(),
      });
      const entries = await storage.getPathToRoot(
        await storage.getLeafId()
      );
      const { messages } = buildSessionContext(entries);
      return messages;
    }
  );
```

Also add imports at the top of `sessions.ts`:

```ts
import { buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && bun run test src/__tests__/session-messages.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/sessions.ts apps/server/src/__tests__/session-messages.test.ts
git commit -m "feat(server): read session messages from entry tree"
```

---

## Task 5: Migrate last-assistant-text route to entry tree

**Files:**
- Modify: `apps/server/src/routes/last-assistant-text.ts` (complete rewrite)
- Modify: `apps/server/src/__tests__/last-assistant-text.test.ts` (rewrite tests)

**Step 1: Write the failing test**

Replace `apps/server/src/__tests__/last-assistant-text.test.ts` entirely:

```ts
import { describe, expect, it } from "bun:test";
import { seedEntries } from "./entry-helpers.ts";
import { lastAssistantTextRoutes } from "../routes/last-assistant-text.ts";
import { makeApp } from "./helpers.ts";

describe("last assistant text route", () => {
  it("returns text for session with assistant messages", async () => {
    const { app, ctx } = await makeApp([lastAssistantTextRoutes]);
    const project = await ctx.repos.projects.create("test", "/tmp/test-last");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ]);

    const res = await app.handle(
      new Request(
        `http://localhost/api/sessions/${session.id}/last-assistant-text`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("Hi there!");
  });

  it("returns null for session with no assistant messages", async () => {
    const { app, ctx } = await makeApp([lastAssistantTextRoutes]);
    const project = await ctx.repos.projects.create("test2", "/tmp/test-last-2");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    await seedEntries(ctx.db, session.id, [{ role: "user", content: "Hello" }]);

    const res = await app.handle(
      new Request(
        `http://localhost/api/sessions/${session.id}/last-assistant-text`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBeNull();
  });

  it("unknown session returns 404", async () => {
    const { app } = await makeApp([lastAssistantTextRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/last-assistant-text")
    );
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run test src/__tests__/last-assistant-text.test.ts`
Expected: FAIL — returns `null` because legacy table is empty.

**Step 3: Implement the new route**

Replace `apps/server/src/routes/last-assistant-text.ts` entirely:

```ts
import { buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia } from "elysia";
import { getCtx } from "../context.ts";

function extractAssistantText(
  messages: Array<{ role: string; content: unknown }>
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") {
      continue;
    }
    const content = msg.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (c): c is { type: "text"; text: string } => c.type === "text"
        )
        .map((c) => c.text)
        .join("");
      return text.length > 0 ? text : null;
    }
    return null;
  }
  return null;
}

export const lastAssistantTextRoutes = new Elysia({
  name: "routes.lastAssistantText",
}).get("/api/sessions/:id/last-assistant-text", async ({ params, store }) => {
  const ctx = getCtx(store);
  const session = ctx.repos.sessions.findById(params.id);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  const storage = new SqliteSessionStorage(ctx.db, params.id, {
    id: params.id,
    createdAt: new Date(session.createdAt).toISOString(),
  });
  const entries = await storage.getPathToRoot(await storage.getLeafId());
  const { messages } = buildSessionContext(entries);

  return Response.json({ text: extractAssistantText(messages) });
});
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && bun run test src/__tests__/last-assistant-text.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/last-assistant-text.ts apps/server/src/__tests__/last-assistant-text.test.ts
git commit -m "feat(server): read last-assistant-text from entry tree"
```

---

## Task 6: Migrate export-html route to entry tree

**Files:**
- Modify: `apps/server/src/routes/export.ts:115-139` (the route handler only)
- Modify: `apps/server/src/__tests__/forking.test.ts:222-307` (the export tests)

**Step 1: Write the failing test**

In `apps/server/src/__tests__/forking.test.ts`, replace the `describe("export route", ...)` block (lines 222-307). Change the seeding from `ctx.repos.messages.append(...)` to `seedEntries(...)`. Add the import at top:

```ts
import { seedEntries } from "./entry-helpers.ts";
```

Replace the export test block:

```ts
describe("export route", () => {
  it("returns HTML with messages rendered", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create("export-test", "/tmp/export");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o", {
      title: "ExportMe",
    });

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "World" },
    ]);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("ExportMe");
    expect(html).toContain("Hello");
    expect(html).toContain("World");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("empty session returns HTML with no messages", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create("export-empty", "/tmp/export-empty");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`)
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No messages in this session");
  });

  it("unknown session returns 404", async () => {
    const { app } = await makeApp([exportRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/export-html")
    );
    expect(res.status).toBe(404);
  });

  it("W7: each assistant message emits a copy button", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create("w7", "/tmp/w7");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    await seedEntries(ctx.db, session.id, [{ role: "assistant", content: "hi" }]);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`)
    );
    const html = await res.text();
    const matches = html.match(/class="copy-btn"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
  });

  it("W8: header shows the session creation date, not today", async () => {
    const { app, ctx } = await makeApp([exportRoutes]);
    const project = await ctx.repos.projects.create("w8", "/tmp/w8");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
    const created = new Date(session.createdAt).toISOString().slice(0, 10);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/export-html`)
    );
    const html = await res.text();
    expect(html).toContain(created);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run test src/__tests__/forking.test.ts`
Expected: FAIL — export HTML shows "No messages" because legacy table is empty.

**Step 3: Implement the migration**

In `apps/server/src/routes/export.ts`, add imports at the top:

```ts
import { buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
```

Then change the route handler (lines 115-139) from:

```ts
export const exportRoutes = new Elysia({ name: "routes.export" }).get(
  "/api/sessions/:id/export-html",
  ({ params, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const project = ctx.repos.projects.findById(session.projectId);
    const projectName = project?.name ?? "Unknown";

    const messagesData = ctx.repos.messages.loadBySession(params.id);
    const html = renderHtmlExport(
      session.title,
      projectName,
      session.createdAt,
      messagesData
    );

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
);
```

to:

```ts
function flattenContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: "text"; text: string } => c.type === "text"
      )
      .map((c) => c.text)
      .join("");
  }
  return "";
}

export const exportRoutes = new Elysia({ name: "routes.export" }).get(
  "/api/sessions/:id/export-html",
  async ({ params, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const project = ctx.repos.projects.findById(session.projectId);
    const projectName = project?.name ?? "Unknown";

    const storage = new SqliteSessionStorage(ctx.db, params.id, {
      id: params.id,
      createdAt: new Date(session.createdAt).toISOString(),
    });
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages: agentMessages } = buildSessionContext(entries);

    const messagesData = agentMessages.map((m) => ({
      role: m.role,
      content: flattenContent(
        (m as { content: unknown }).content
      ),
      createdAt:
        (m as { timestamp: number }).timestamp ?? session.createdAt,
    }));

    const html = renderHtmlExport(
      session.title,
      projectName,
      session.createdAt,
      messagesData
    );

    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
);
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && bun run test src/__tests__/forking.test.ts`
Expected: PASS (the export tests within forking.test.ts pass; fork tests still fail — those are migrated in Task 8).

**Step 5: Commit**

```bash
git add apps/server/src/routes/export.ts apps/server/src/__tests__/forking.test.ts
git commit -m "feat(server): read export-html from entry tree"
```

---

## Task 7: Migrate bash inject-to-context to entry tree

**Files:**
- Modify: `apps/server/src/routes/bash.ts:137-148` (the inject block)
- Modify: `apps/server/src/__tests__/bash.test.ts:54-72` (the inject test)

**Step 1: Write the failing test**

In `apps/server/src/__tests__/bash.test.ts`, change the inject test (lines 54-72). Add the import at top:

```ts
import { SqliteSessionStorage } from "@sakti-code/db";
import { buildSessionContext } from "@sakti-code/agent";
```

Replace the test body:

```ts
  it("POST /api/sessions/:id/bash with injectToContext appends a toolResult entry", async () => {
    const { app, ctx } = await makeApp([bashRoutes]);
    const project = await ctx.repos.projects.create("bash-inject", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/bash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "echo hello", injectToContext: true }),
      })
    );

    // Verify the entry was written to session_entries
    const storage = new SqliteSessionStorage(ctx.db, session.id, {
      id: session.id,
      createdAt: new Date().toISOString(),
    });
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages } = buildSessionContext(entries);

    const toolMsg = messages.find((m) => m.role === "toolResult");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolName).toBe("user_bash");
    const text = toolMsg!.content
      .filter(
        (c): c is { type: "text"; text: string } => c.type === "text"
      )
      .map((c) => c.text)
      .join("");
    expect(text).toContain("hello");
  });
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run test src/__tests__/bash.test.ts`
Expected: FAIL on the inject test — entry tree is empty (writes to legacy `messages` table).

**Step 3: Implement the migration**

In `apps/server/src/routes/bash.ts`, add imports at the top:

```ts
import { Session } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
```

Change the inject block (lines 137-148) from:

```ts
      if (body.injectToContext) {
        const content = JSON.stringify({
          command: body.command,
          exitCode: result.exitCode,
          output: result.output,
        });
        await ctx.repos.messages.append(session.id, {
          content,
          role: "tool",
          toolCallId: crypto.randomUUID(),
          toolName: "user_bash",
        });
      }
```

to:

```ts
      if (body.injectToContext) {
        const content = JSON.stringify({
          command: body.command,
          exitCode: result.exitCode,
          output: result.output,
        });
        const storage = new SqliteSessionStorage(ctx.db, session.id, {
          id: session.id,
          createdAt: new Date(session.createdAt).toISOString(),
        });
        const sessionInstance = new Session(storage);
        await sessionInstance.appendMessage({
          role: "toolResult",
          content: [{ type: "text", text: content }],
          toolCallId: crypto.randomUUID(),
          toolName: "user_bash",
          isError: false,
          timestamp: Date.now(),
        });
      }
```

**Step 4: Run test to verify it passes**

Run: `cd apps/server && bun run test src/__tests__/bash.test.ts`
Expected: PASS (all bash tests pass)

**Step 5: Commit**

```bash
git add apps/server/src/routes/bash.ts apps/server/src/__tests__/bash.test.ts
git commit -m "feat(server): inject bash results into entry tree via Session"
```

---

## Task 8: Implement entry-tree forking in SqliteSessionStorage

**Files:**
- Modify: `packages/db/src/session-entry-store.ts` (add `fork` method)
- Create: `packages/db/src/__tests__/session-entry-store-fork.test.ts`

**Step 1: Write the failing test**

Create `packages/db/src/__tests__/session-entry-store-fork.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { initDatabase, SqliteSessionStorage } from "@sakti-code/db";
import { SessionRepo } from "@sakti-code/db";

async function seedConversation(
  storage: SqliteSessionStorage,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  let parentId: string | null = null;
  for (const msg of messages) {
    const id = crypto.randomUUID();
    await storage.appendEntry({
      id,
      parentId,
      timestamp: new Date().toISOString(),
      type: "message",
      message: {
        role: msg.role,
        content: msg.content,
        timestamp: Date.now(),
      } as any,
    });
    parentId = id;
  }
}

describe("SqliteSessionStorage.fork", () => {
  it("forks all entries to a new session", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const sessionRepo = new SessionRepo(db);

    const project = await new (class {
      async create(db: any) {
        const id = crypto.randomUUID();
        const now = Date.now();
        await db
          .insert({} as any)
          .values({} as any);
        return id;
      }
    })().create(db).catch(async () => {
      const { ProjectRepo } = await import("@sakti-code/db");
      return new ProjectRepo(db).create("test", "/tmp");
    });

    const sourceSession = await sessionRepo.create(
      project.id,
      "test-model"
    );

    const sourceStorage = new SqliteSessionStorage(db, sourceSession.id, {
      id: sourceSession.id,
      createdAt: new Date().toISOString(),
    });
    await seedConversation(sourceStorage, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "How are you?" },
    ]);

    const forkedSession = await sessionRepo.create(
      project.id,
      "test-model",
      { parentSessionId: sourceSession.id }
    );

    const forkedStorage = new SqliteSessionStorage(db, forkedSession.id, {
      id: forkedSession.id,
      createdAt: new Date().toISOString(),
    });

    await forkedStorage.forkFrom(sourceSession.id);

    const sourceEntries = await sourceStorage.getEntries();
    const forkedEntries = await forkedStorage.getEntries();

    expect(forkedEntries).toHaveLength(sourceEntries.length);
    expect(forkedEntries[0]!.type).toBe(sourceEntries[0]!.type);

    // Verify the tree structure is preserved
    const forkedLeaf = await forkedStorage.getLeafId();
    expect(forkedLeaf).not.toBeNull();
    const forkedPath = await forkedStorage.getPathToRoot(forkedLeaf);
    expect(forkedPath.length).toBe(sourceEntries.length);
  });

  it("forks partial entries up to a specific entry id", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const sessionRepo = new SessionRepo(db);
    const { ProjectRepo } = await import("@sakti-code/db");
    const project = await new ProjectRepo(db).create("test2", "/tmp2");
    const sourceSession = await sessionRepo.create(project.id, "test-model");

    const sourceStorage = new SqliteSessionStorage(db, sourceSession.id, {
      id: sourceSession.id,
      createdAt: new Date().toISOString(),
    });

    // Seed 3 messages
    let parentId: string | null = null;
    const entryIds: string[] = [];
    for (const content of ["A", "B", "C"]) {
      const id = crypto.randomUUID();
      entryIds.push(id);
      await sourceStorage.appendEntry({
        id,
        parentId,
        timestamp: new Date().toISOString(),
        type: "message",
        message: { role: "user", content, timestamp: Date.now() } as any,
      });
      parentId = id;
    }

    const forkedSession = await sessionRepo.create(project.id, "test-model");
    const forkedStorage = new SqliteSessionStorage(db, forkedSession.id, {
      id: forkedSession.id,
      createdAt: new Date().toISOString(),
    });

    // Fork up to entryIds[1] (include first 2 entries)
    await forkedStorage.forkFrom(sourceSession.id, entryIds[1]);

    const forkedEntries = await forkedStorage.getEntries();
    expect(forkedEntries).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/db && bun test src/__tests__/session-entry-store-fork.test.ts`
Expected: FAIL — `forkFrom` method does not exist.

**Step 3: Implement `forkFrom`**

Add this method to `SqliteSessionStorage` in `packages/db/src/session-entry-store.ts`, right before the closing `}` of the class (after `getNextSequence`, before `parseEntry`):

```ts
  /**
   * Copy entries from a source session into this session, preserving the tree.
   * If upToEntryId is provided, only copies entries up to and including that entry.
   */
  async forkFrom(
    sourceSessionId: string,
    upToEntryId?: string
  ): Promise<void> {
    // Load source entries
    const sourceRows = this.db
      .select()
      .from(sessionEntries)
      .where(eq(sessionEntries.sessionId, sourceSessionId))
      .orderBy(sessionEntries.sequence)
      .all();

    let entriesToCopy = sourceRows;
    if (upToEntryId) {
      const cutIndex = sourceRows.findIndex((r) => r.id === upToEntryId);
      if (cutIndex >= 0) {
        entriesToCopy = sourceRows.slice(0, cutIndex + 1);
      }
    }

    if (entriesToCopy.length === 0) {
      return;
    }

    // Build a mapping from old entry IDs to new entry IDs
    const idMap = new Map<string, string>();
    for (const row of entriesToCopy) {
      idMap.set(row.id, crypto.randomUUID());
    }

    // Get the source session's leaf to know the effective leaf entry
    const sourceSessionRow = this.db
      .select({ leafId: sessions.leafId })
      .from(sessions)
      .where(eq(sessions.id, sourceSessionId))
      .get();
    const sourceLeafId = sourceSessionRow?.leafId ?? null;

    // Insert copied entries with re-chained parentId
    for (const row of entriesToCopy) {
      const newId = idMap.get(row.id)!;
      const newParentId = row.parentId
        ? (idMap.get(row.parentId) ?? null)
        : null;

      // Parse the entry to update its internal id/parentId
      const entry = JSON.parse(row.content) as SessionTreeEntry;
      const forkedEntry = {
        ...entry,
        id: newId,
        parentId: newParentId,
      } as SessionTreeEntry;

      const sequence = await this.getNextSequence();
      await this.db.insert(sessionEntries).values({
        id: newId,
        sessionId: this.sessionId,
        parentId: newParentId,
        sequence,
        kind: row.kind,
        content: JSON.stringify(forkedEntry),
        timestamp: row.timestamp,
        createdAt: Date.now(),
      });
    }

    // Set the leaf to the copied equivalent of the source leaf
    // (or the last copied entry if the source leaf was beyond the cut point)
    let newLeafId: string | null = null;
    if (sourceLeafId && idMap.has(sourceLeafId)) {
      newLeafId = idMap.get(sourceLeafId)!;
    } else {
      // Source leaf was beyond the cut; use the last copied entry
      const lastSourceRow = entriesToCopy[entriesToCopy.length - 1]!;
      newLeafId = idMap.get(lastSourceRow.id) ?? null;
    }
    await this.setLeafId(newLeafId);
  }
```

**Step 4: Run test to verify it passes**

Run: `cd packages/db && bun test src/__tests__/session-entry-store-fork.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/session-entry-store.ts packages/db/src/__tests__/session-entry-store-fork.test.ts
git commit -m "feat(db): add forkFrom to SqliteSessionStorage for entry-tree forking"
```

---

## Task 9: Migrate forking route to entry tree

**Files:**
- Modify: `apps/server/src/routes/forking.ts` (complete rewrite)
- Modify: `apps/server/src/__tests__/forking.test.ts:1-171` (the fork and fork-messages tests)

**Step 1: Write the failing test**

In `apps/server/src/__tests__/forking.test.ts`, replace the first two `describe` blocks (fork routes + fork-messages route, lines 1-171). Keep the export tests (already migrated in Task 6). The file already imports `seedEntries` from Task 6.

Replace the top of the file (imports + first two describe blocks):

```ts
import { describe, expect, it } from "bun:test";
import { SqliteSessionStorage } from "@sakti-code/db";
import { buildSessionContext } from "@sakti-code/agent";
import { seedEntries } from "./entry-helpers.ts";
import { exportRoutes } from "../routes/export.ts";
import { forkingRoutes } from "../routes/forking.ts";
import { namingRoutes } from "../routes/naming.ts";
import { makeApp } from "./helpers.ts";

describe("fork routes", () => {
  it("POST /api/sessions/:id/fork creates a forked session with all entries", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fork-test", "/tmp/fork");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/fork`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const forked = await res.json();
    expect(forked).toHaveProperty("parentSessionId", session.id);
    expect(forked).toHaveProperty("id");
    expect(forked.id).not.toBe(session.id);

    // Verify entries were copied to the fork
    const forkedStorage = new SqliteSessionStorage(ctx.db, forked.id, {
      id: forked.id,
      createdAt: new Date().toISOString(),
    });
    const entries = await forkedStorage.getPathToRoot(
      await forkedStorage.getLeafId()
    );
    const { messages } = buildSessionContext(entries);
    expect(messages).toHaveLength(2);
    expect((messages[0] as { content: unknown }).content).toBe("Hello");
  });

  it("POST /api/sessions/nope/fork returns 404", async () => {
    const { app } = await makeApp([forkingRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(404);
  });
});

describe("fork-messages route", () => {
  it("returns user/assistant messages with entryIndex and textPreview", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fm-test", "/tmp/fm");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "toolResult", content: "result", toolCallId: "t1", toolName: "bash" },
    ]);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/fork-messages`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Tool messages excluded, only user + assistant
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty("role", "user");
    expect(body[0]).toHaveProperty("textPreview", "Hello");
    expect(body[1]).toHaveProperty("role", "assistant");
  });

  it("empty session returns []", async () => {
    const { app, ctx } = await makeApp([forkingRoutes]);
    const project = await ctx.repos.projects.create("fm-empty", "/tmp/fm-empty");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/fork-messages`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("unknown session returns 404", async () => {
    const { app } = await makeApp([forkingRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/fork-messages")
    );
    expect(res.status).toBe(404);
  });
});
```

The `naming` describe block (lines 173-220) stays unchanged. The `export` describe block was already updated in Task 6.

**Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run test src/__tests__/forking.test.ts`
Expected: FAIL — fork tests fail because route still uses legacy `SqliteSessionStore`.

**Step 3: Implement the new forking route**

Replace `apps/server/src/routes/forking.ts` entirely:

```ts
import { buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

function flattenContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: "text"; text: string } => c.type === "text"
      )
      .map((c) => c.text)
      .join("");
  }
  return "";
}

export const forkingRoutes = new Elysia({ name: "routes.forking" })
  .post(
    "/api/sessions/:id/fork",
    async ({ params, body, store }) => {
      const ctx = getCtx(store);
      const session = ctx.repos.sessions.findById(params.id);
      if (!session) {
        return new Response("Not found", { status: 404 });
      }

      const forkedTitle = session.title
        ? `Fork of ${session.title}`
        : "Fork";

      const newSession = await ctx.repos.sessions.create(
        session.projectId,
        session.modelId,
        {
          title: forkedTitle,
          thinkingLevel: session.thinkingLevel,
          parentSessionId: params.id,
        }
      );

      const forkedStorage = new SqliteSessionStorage(ctx.db, newSession.id, {
        id: newSession.id,
        createdAt: new Date(newSession.createdAt).toISOString(),
      });

      await forkedStorage.forkFrom(params.id);

      return Response.json(newSession);
    },
    {
      body: t.Optional(
        t.Object({
          messageIndex: t.Optional(t.Number()),
        })
      ),
    }
  )
  .get("/api/sessions/:id/fork-messages", async ({ params, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const storage = new SqliteSessionStorage(ctx.db, params.id, {
      id: params.id,
      createdAt: new Date(session.createdAt).toISOString(),
    });
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages } = buildSessionContext(entries);

    const forkable = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role,
        textPreview: flattenContent(
          (m as { content: unknown }).content
        ).slice(0, 200),
      }));

    return Response.json(forkable);
  });
```

Note: the `messageIndex` body parameter is kept in the schema for API compatibility but the new entry-tree fork uses `forkFrom(sessionId)` without a message index (the entry tree doesn't have flat indices). If partial fork is needed, the client should pass an `entryId` instead — but for now, full fork is the default and the `messageIndex` is ignored.

**Step 4: Run test to verify it passes**

Run: `cd apps/server && bun run test src/__tests__/forking.test.ts`
Expected: PASS (all fork, fork-messages, naming, and export tests pass)

**Step 5: Commit**

```bash
git add apps/server/src/routes/forking.ts apps/server/src/__tests__/forking.test.ts
git commit -m "feat(server): fork sessions via entry tree (forkFrom)"
```

---

## Task 10: Remove MessageRepo and SqliteSessionStore from context

**Files:**
- Modify: `apps/server/src/context.ts` (remove `messages` and `costs` from repos)
- Modify: `apps/server/src/index.ts:10` (remove costsRoutes from default routes)
- Modify: `apps/server/src/routes/costs.ts` (delete file)

**Step 1: Write the failing test**

Add a test to `apps/server/src/__tests__/wiring.test.ts` (or create it if it doesn't exist):

```ts
import { describe, expect, it } from "bun:test";
import { createContext } from "../context.ts";
import { initDatabase } from "@sakti-code/db";
import { Database } from "bun:sqlite";

describe("ServerContext", () => {
  it("does not have messages or costs repos", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(db);
    expect(ctx.repos).not.toHaveProperty("messages");
    expect(ctx.repos).not.toHaveProperty("costs");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/server && bun run test src/__tests__/wiring.test.ts`
Expected: FAIL — `ctx.repos` still has `messages` and `costs`.

**Step 3: Remove from context**

In `apps/server/src/context.ts`, change the imports (lines 1-9) from:

```ts
import {
  CostRepo,
  type DrizzleDB,
  MessageRepo,
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
} from "@sakti-code/db";
```

to:

```ts
import {
  type DrizzleDB,
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
} from "@sakti-code/db";
```

Change the `repos` interface (lines 14-21) from:

```ts
  repos: {
    projects: ProjectRepo;
    sessions: SessionRepo;
    messages: MessageRepo;
    costs: CostRepo;
    settings: SettingsRepo;
    models: ModelConfigRepo;
  };
```

to:

```ts
  repos: {
    projects: ProjectRepo;
    sessions: SessionRepo;
    settings: SettingsRepo;
    models: ModelConfigRepo;
  };
```

Change the `createContext` body (lines 28-35) from:

```ts
    repos: {
      projects: new ProjectRepo(db),
      sessions: new SessionRepo(db),
      messages: new MessageRepo(db),
      costs: new CostRepo(db),
      settings: new SettingsRepo(db),
      models: new ModelConfigRepo(db),
    },
```

to:

```ts
    repos: {
      projects: new ProjectRepo(db),
      sessions: new SessionRepo(db),
      settings: new SettingsRepo(db),
      models: new ModelConfigRepo(db),
    },
```

Delete `apps/server/src/routes/costs.ts`.

In `apps/server/src/index.ts`, remove:
- Line 10: `import { costsRoutes } from "./routes/costs.ts";`
- Line 41: `costsRoutes,` from the `defaultRoutes` array.

**Step 4: Fix any compilation errors**

Search for any remaining references to `repos.messages` or `repos.costs` in `apps/server/src/`:

Run: `grep -rn "repos\.messages\|repos\.costs\|costsRoutes" apps/server/src/`

Fix any remaining references. The stats route (Task 3) and bash route (Task 7) should already be migrated. If any test files still reference `ctx.repos.messages`, update them.

Run: `bun typecheck`
Expected: PASS

**Step 5: Run all server tests**

Run: `cd apps/server && bun run test`
Expected: PASS (0 failures)

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(server): remove MessageRepo, CostRepo, and costs route from context"
```

---

## Task 11: Delete legacy db code and update exports

**Files:**
- Delete: `packages/db/src/session-store.ts`
- Delete: `packages/db/src/__tests__/session-store.test.ts`
- Modify: `packages/db/src/repos/index.ts` (remove `MessageRepo` class, lines 147-242; remove `CostRepo` class, lines 244-293)
- Modify: `packages/db/src/index.ts` (remove `MessageRepo`, `CostRepo`, `SqliteSessionStore` exports)

**Step 1: Verify no code depends on the deleted exports**

Run: `grep -rn "SqliteSessionStore\|MessageRepo\|CostRepo" --include="*.ts" packages/ apps/ | grep -v "__tests__" | grep -v "openspec/" | grep -v "node_modules"`

If any production code still imports them, fix those first.

**Step 2: Delete the legacy files**

```bash
rm packages/db/src/session-store.ts
rm packages/db/src/__tests__/session-store.test.ts
```

**Step 3: Remove MessageRepo and CostRepo from repos/index.ts**

In `packages/db/src/repos/index.ts`:
- Remove the `MessageRepo` class (lines 147-242)
- Remove the `CostRepo` class (lines 244-293)
- Remove the `messages` import if it's no longer used (keep `costs` import if referenced elsewhere — check first)
- Update the `init.ts` raw SQL if needed (the `messages` and `tool_executions` tables can stay in the schema for now — they're harmless empty tables)

**Step 4: Update db barrel exports**

In `packages/db/src/index.ts`, change from:

```ts
export { type DrizzleDB, initDatabase } from "./init.ts";
export {
  CostRepo,
  MessageRepo,
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
} from "./repos/index.ts";
export * from "./schema.ts";
export { SqliteSessionStorage } from "./session-entry-store.ts";
export { SqliteSessionStore } from "./session-store.ts";
```

to:

```ts
export { type DrizzleDB, initDatabase } from "./init.ts";
export {
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
} from "./repos/index.ts";
export * from "./schema.ts";
export { SqliteSessionStorage } from "./session-entry-store.ts";
```

**Step 5: Verify everything compiles and tests pass**

Run: `bun typecheck && bun x ultracite check`
Expected: PASS

Run: `cd packages/db && bun test`
Expected: PASS (32 tests minus deleted legacy store tests)

Run: `cd apps/server && bun run test`
Expected: PASS

Run: `bun vitest run packages/agent/ packages/tools/`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(db): delete legacy SqliteSessionStore, MessageRepo, and CostRepo"
```

---

## Task 12: Run full verification and update specs

**Files:**
- Modify: `openspec/specs/session-utils/spec.md` (update stats spec)
- Modify: `openspec/specs/server-rest-api/spec.md` (remove MessageRepo from requirements)
- Modify: `AGENTS.md` (update route table, remove costs route)

**Step 1: Run full verification**

```bash
bun typecheck && \
bun x ultracite check && \
bun vitest run packages/agent/ packages/tools/ && \
(cd packages/db && bun test) && \
(cd apps/server && bun run test)
```

Expected: ALL PASS, 0 errors, 0 failures.

**Step 2: Update specs**

In `openspec/specs/session-utils/spec.md`, update the "Session stats route" requirement to say stats are **derived from the entry tree** (walk assistant messages, sum `usage.*`), not from `MessageRepo.countBySession` or `CostRepo.aggregateBySession`.

In `openspec/specs/server-rest-api/spec.md`, remove any requirement mentioning `MessageRepo`.

In `AGENTS.md`, update the route modules table:
- Remove the `costsRoutes` row
- Update `statsRoutes` notes to say "derived from entry tree"
- Update `forkingRoutes` notes to say "entry-tree fork via `SqliteSessionStorage.forkFrom`"

**Step 3: Commit**

```bash
git add openspec/ AGENTS.md
git commit -m "docs: update specs and AGENTS.md for unified entry-tree persistence"
```

---

## Summary of changes

| Before | After |
|---|---|
| `messages` table (legacy, flat) | **deleted** — all data in `session_entries` |
| `MessageRepo` | **deleted** |
| `SqliteSessionStore` | **deleted** |
| `CostRepo` / `costs` table | **deleted** — stats derived from `usage` fields |
| Stats reads `messages` + `costs` | Stats derives from `buildSessionContext` + `usage` |
| Forking copies `messages` rows | Forking copies entries via `forkFrom()` |
| Bash inject writes `messages` | Bash inject writes entry via `Session.appendMessage()` |
| Export/messages/last-text read `messages` | All read via `buildSessionContext(entries)` |
