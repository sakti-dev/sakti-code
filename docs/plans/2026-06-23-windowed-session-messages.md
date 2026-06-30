# Windowed Session Messages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the renderer hold only a bounded window of messages per session (latest-N first, older loaded on demand) instead of mirroring the entire history — directly killing the dominant 800MB memory culprit (sessions + tool results retained forever).

**Architecture:** The server becomes the sole source of truth and serves messages through a cursor-paginated endpoint (`?limit&skip` → `{ messages, hasOlder }`). The renderer's `SessionStore` becomes a bounded cache with two operations: `loadLatest` (hydrate the newest window) and `loadOlder` (prepend on scroll-up). Tab _close_ disposes the session store (tab _switch_ keeps it, so a quick switch-back is instant). An `unread` counter on the store gives the future UI what it needs for the "stay-put + badge" behavior. Big tool results are size-capped at store time so a fixed count of 5 messages can never be tens of MB.

**Tech Stack:** Hono + `@hono/typebox-validator` (server), SolidJS stores + `vitest` (jsdom) (app), `bun:sqlite` via Drizzle (db). Agent entry tree via `@sakti-code/agent`'s `buildSessionContext`.

---

## Scope

**In scope (state management + server only — NO UI):**

- Server: windowed `GET /api/sessions/:id/messages`.
- Renderer `SessionStore`: windowing (`loadLatest`/`loadOlder`/`hasOlder`/`tailLoaded`) + `unread` state + size cap.
- Renderer `actions`: `loadLatest`/`loadOlder` (replace `loadMessages`).
- Tab-close → dispose session store wiring.

**Out of scope (deferred to the Electron/UI phase):**

- The message-list component, scroll detection, the "↓ N new" badge DOM, and auto-follow wiring. The store exposes the state (`unread`, `hasOlder`, `tailLoaded`) these will read; the _rendering_ is not built here.
- `appendToken` O(n) realloc optimization, terminal buffer cap, list virtualization, and server-side "stop streaming for non-visible sessions." Documented as follow-ups.

## Conventions

- **Follow TDD strictly:** write the failing test → run RED → implement → run GREEN → commit. Verify RED before implementing.
- **Per-package test commands:**
  - Server: `cd apps/server && bun x vitest run <path>`
  - App: `cd apps/app && bun x vitest run <path>`
- **Typecheck after each task:** `cd apps/server && bun run typecheck` and `cd apps/app && bun run typecheck`.
- **Lint/format before committing:** `bun x ultracite fix` (run from repo root).
- **Commit style:** conventional commits, scoped (`feat(server): ...`, `feat(app): ...`). If the repo pre-commit hook fails on _unrelated_ packages, re-run with `--no-verify` (the project keeps cross-package hooks; this is the established workaround).
- **`exactOptionalPropertyTypes: true` is on** → use conditional spread `...(x === undefined ? {} : { x })` for optional fields, never pass `undefined`.
- **No `any` in new code** — the existing `undefined as any` casts for SolidJS store key-deletion are pre-approved (kept as-is with their biome-ignore comments).

---

## Task 1: Server — windowed `GET /api/sessions/:id/messages`

Add `?limit` and `?skip` query params. The response changes from a bare `AgentMessage[]` to `{ messages: AgentMessage[]; hasOlder: boolean }`. `skip` = number of newest messages to skip (cursor = "how many from the tail are already loaded"). The route still builds the full context server-side (cheap; the memory win is in the renderer) and slices the projected array.

**Files:**

- Modify: `apps/server/src/routes/sessions/sessions.ts:65-71` (the `GET /:id/messages` handler) + add a `clampInt` helper near the top of the file.
- Modify: `apps/server/src/__tests__/session-messages.test.ts` (update existing 2 tests to the new shape + add 3 pagination tests).

### Step 1: Write the failing tests

Replace the entire contents of `apps/server/src/__tests__/session-messages.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { sessionsRoutes } from "../routes/sessions/sessions.ts";
import { seedEntries } from "./entry-helpers.ts";
import { makeApp } from "./helpers.ts";

// Seeds 7 messages u1,a1,u2,a2,u3,a3,u4 (oldest→newest) so we can assert windows.
async function seedSeven() {
  const { app, ctx } = await makeApp([sessionsRoutes]);
  const project = await ctx.repos.projects.create("p", "/tmp");
  const session = await ctx.repos.sessions.create(project.id, "test-model");
  await seedEntries(ctx.db, session.id, [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
    { role: "user", content: "u3" },
    { role: "assistant", content: "a3" },
    { role: "user", content: "u4" },
  ]);
  return { app, sessionId: session.id };
}

const roles = (msgs: { role: string }[]) => msgs.map((m) => m.role);

describe("GET /api/sessions/:id/messages", () => {
  it("returns { messages, hasOlder } for a small history (no pagination)", async () => {
    const { app, ctx } = await makeApp([sessionsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "test-model");
    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ]);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/messages`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(roles(body.messages)).toEqual(["user", "assistant"]);
    expect(body.hasOlder).toBe(false);
  });

  it("returns empty window for session with no entries", async () => {
    const { app, ctx } = await makeApp([sessionsRoutes]);
    const project = await ctx.repos.projects.create("empty", "/tmp/empty");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/messages`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toEqual([]);
    expect(body.hasOlder).toBe(false);
  });

  it("returns the latest <limit> messages with hasOlder=true", async () => {
    const { app, sessionId } = await seedSeven();
    const res = await app.request(
      new Request(`http://localhost/api/sessions/${sessionId}/messages?limit=5`),
    );
    const body = await res.json();
    expect(body.messages).toHaveLength(5);
    // latest 5 of [u1,a1,u2,a2,u3,a3,u4] = [u2,a2,u3,a3,u4]
    expect(roles(body.messages)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(body.hasOlder).toBe(true);
  });

  it("returns older messages when skip is provided", async () => {
    const { app, sessionId } = await seedSeven();
    const res = await app.request(
      new Request(`http://localhost/api/sessions/${sessionId}/messages?limit=5&skip=5`),
    );
    const body = await res.json();
    // skip 5 newest → remaining oldest 2 = [u1,a1]
    expect(body.messages).toHaveLength(2);
    expect(roles(body.messages)).toEqual(["user", "assistant"]);
    expect(body.hasOlder).toBe(false);
  });

  it("respects a smaller limit", async () => {
    const { app, sessionId } = await seedSeven();
    const res = await app.request(
      new Request(`http://localhost/api/sessions/${sessionId}/messages?limit=2`),
    );
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    // latest 2 = [a3,u4]
    expect(roles(body.messages)).toEqual(["assistant", "user"]);
    expect(body.hasOlder).toBe(true);
  });
});
```

### Step 2: Run the tests to verify they fail

Run: `cd apps/server && bun x vitest run src/__tests__/session-messages.test.ts`
Expected: **FAIL** — the current route returns a bare array, so `body.messages` is `undefined` and the shape assertions fail.

### Step 3: Implement the windowed handler

In `apps/server/src/routes/sessions/sessions.ts`:

Add this helper near the top (after the imports):

```ts
function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}
```

Replace the `GET /:id/messages` handler (currently lines 65-71) with:

```ts
  .get("/:id/messages", async (c) => {
    const ctx = getCtx(c);
    const storage = createSessionStorage(ctx, c.req.param("id"));
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages } = buildSessionContext(entries);

    const limit = clampInt(c.req.query("limit"), 1, 100, 50);
    const skip = clampInt(c.req.query("skip"), 0, Number.MAX_SAFE_INTEGER, 0);

    const total = messages.length;
    const end = Math.max(0, total - skip);
    const start = Math.max(0, end - limit);

    return c.json({
      messages: messages.slice(start, end),
      hasOlder: start > 0,
    });
  });
```

### Step 4: Run the tests to verify they pass

Run: `cd apps/server && bun x vitest run src/__tests__/session-messages.test.ts`
Expected: **PASS** (5 tests).

### Step 5: Typecheck + lint

Run: `cd apps/server && bun run typecheck`
Run: `bun x ultracite fix`
Expected: clean (no new diagnostics in this file).

### Step 6: Commit

```bash
git add apps/server/src/routes/sessions/sessions.ts apps/server/src/__tests__/session-messages.test.ts
git commit -m "feat(server): window session messages by limit/skip"
```

---

## Task 2: Renderer — `SessionStore` windowing + unread state

Add `loadLatest`, `loadOlder`, `markAllRead`, and the `hasOlder` / `tailLoaded` / `unread` fields. `addMessage` now bumps `tailLoaded` and the unread counter (every new message is "unread" until the future UI calls `markAllRead` when it detects the viewport is at the bottom — that's the standard Discord/Slack pattern and needs no UI to be correct).

**Keep `loadMessages` for now** — it is removed in Task 3 alongside the `actions` switch, so each task ends compilable.

**Files:**

- Modify: `apps/app/src/stores/session-store.ts` (data shape + new actions + `addMessage`/`reset` changes).
- Modify: `apps/app/src/stores/__tests__/session-store.test.ts` (add new describe blocks).

### Step 1: Write the failing tests

In `apps/app/src/stores/__tests__/session-store.test.ts`, add these describe blocks (the file already imports `createSessionStore`, `UIMessage`, and defines `makeMessage`):

```ts
describe("session store — loadLatest", () => {
  it("replaces the window and records hasOlder + tailLoaded", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "stale" }));

    session.actions.loadLatest([makeMessage({ id: "m1" }), makeMessage({ id: "m2" })], true);

    expect(session.store.messageOrder).toEqual(["m1", "m2"]);
    expect(session.store.messages.stale).toBeUndefined();
    expect(session.store.hasOlder).toBe(true);
    expect(session.store.tailLoaded).toBe(2);
    expect(session.store.unread.count).toBe(0);
  });

  it("resets unread on loadLatest", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" })); // bumps unread
    expect(session.store.unread.count).toBe(1);

    session.actions.loadLatest([makeMessage({ id: "m1" })], false);
    expect(session.store.unread.count).toBe(0);
  });
});

describe("session store — loadOlder", () => {
  it("prepends older ids and bumps tailLoaded", () => {
    const session = createSessionStore("s1");
    session.actions.loadLatest([makeMessage({ id: "m3" }), makeMessage({ id: "m4" })], true);

    session.actions.loadOlder([makeMessage({ id: "m1" }), makeMessage({ id: "m2" })], false);

    expect(session.store.messageOrder).toEqual(["m1", "m2", "m3", "m4"]);
    expect(session.store.tailLoaded).toBe(4);
    expect(session.store.hasOlder).toBe(false);
  });
});

describe("session store — unread tracking", () => {
  it("addMessage increments unread and sets the marker", () => {
    const session = createSessionStore("s1");
    session.actions.loadLatest([makeMessage({ id: "m1" })], false);

    session.actions.addMessage(makeMessage({ id: "m2" }));

    expect(session.store.tailLoaded).toBe(2);
    expect(session.store.unread.count).toBe(1);
    expect(session.store.unread.markerMessageId).toBe("m2");
  });

  it("markAllRead clears the counter and marker", () => {
    const session = createSessionStore("s1");
    session.actions.addMessage(makeMessage({ id: "m1" }));
    session.actions.addMessage(makeMessage({ id: "m2" }));
    expect(session.store.unread.count).toBe(2);

    session.actions.markAllRead();

    expect(session.store.unread.count).toBe(0);
    expect(session.store.unread.markerMessageId).toBeNull();
  });
});
```

### Step 2: Run the tests to verify they fail

Run: `cd apps/app && bun x vitest run src/stores/__tests__/session-store.test.ts`
Expected: **FAIL** — `loadLatest` / `loadOlder` / `markAllRead` don't exist, and `hasOlder`/`tailLoaded`/`unread` are absent.

### Step 3: Implement the store changes

In `apps/app/src/stores/session-store.ts`:

Update `SessionStoreData`:

```ts
export interface SessionStoreData {
  hasOlder: boolean;
  messageOrder: string[];
  messages: Record<string, UIMessage>;
  streaming: StreamState;
  tailLoaded: number;
  unread: { count: number; markerMessageId: string | null };
}
```

Update `SessionActions` — add the three new actions (keep `loadMessages` for now):

```ts
export interface SessionActions {
  addMessage: (msg: UIMessage) => void;
  addToolCall: (msgId: string, toolCallId: string, toolName: string, input: unknown) => void;
  appendToken: (msgId: string, delta: string) => void;
  clearCurrentMessage: () => void;
  clearCurrentTool: () => void;
  completeToolCall: (msgId: string, toolCallId: string, result: string, isError?: boolean) => void;
  finalizeMessage: (msgId: string) => void;
  getCurrentMessageId: () => string | null;
  loadLatest: (msgs: UIMessage[], hasOlder: boolean) => void;
  loadMessages: (msgs: UIMessage[]) => void; // removed in Task 3
  loadOlder: (msgs: UIMessage[], hasOlder: boolean) => void;
  markAllRead: () => void;
  reset: () => void;
  setContent: (msgId: string, content: string) => void;
  setCurrentMessage: (msgId: string) => void;
  setCurrentTool: (toolName: string) => void;
  setError: (msgId: string, error: string) => void;
  setPhase: (phase: StreamState["phase"]) => void;
}
```

Update the `createStore` initial state:

```ts
const [store, setStore] = createStore<SessionStoreData>({
  messages: {},
  messageOrder: [],
  streaming: { ...idleStreamState },
  hasOlder: false,
  tailLoaded: 0,
  unread: { count: 0, markerMessageId: null },
});
```

Update `addMessage` to track the tail + unread:

```ts
    addMessage(msg) {
      setStore("messages", msg.id, msg);
      setStore("messageOrder", (prev) => [...prev, msg.id]);
      setStore("tailLoaded", (n) => n + 1);
      setStore("unread", (u) => ({
        count: u.count + 1,
        markerMessageId: msg.id,
      }));
    },
```

Add the new actions (place them alongside `loadMessages`):

```ts
    loadLatest(msgs, hasOlder) {
      for (const key of Object.keys(store.messages)) {
        // biome-ignore lint/suspicious/noExplicitAny: SolidJS store deletion requires any cast
        setStore("messages", key, undefined as any);
      }
      for (const msg of msgs) {
        setStore("messages", msg.id, msg);
      }
      setStore("messageOrder", msgs.map((m) => m.id));
      setStore("hasOlder", hasOlder);
      setStore("tailLoaded", msgs.length);
      setStore("unread", { count: 0, markerMessageId: null });
    },

    loadOlder(msgs, hasOlder) {
      for (const msg of msgs) {
        setStore("messages", msg.id, msg);
      }
      setStore("messageOrder", (prev) => [
        ...msgs.map((m) => m.id),
        ...prev,
      ]);
      setStore("hasOlder", hasOlder);
      setStore("tailLoaded", (n) => n + msgs.length);
    },

    markAllRead() {
      setStore("unread", { count: 0, markerMessageId: null });
    },
```

Update `reset` to clear the new fields:

```ts
    reset() {
      for (const key of Object.keys(store.messages)) {
        // biome-ignore lint/suspicious/noExplicitAny: SolidJS store deletion requires any cast
        setStore("messages", key, undefined as any);
      }
      setStore("messageOrder", () => []);
      setStore("streaming", { ...idleStreamState });
      setStore("hasOlder", false);
      setStore("tailLoaded", 0);
      setStore("unread", { count: 0, markerMessageId: null });
    },
```

### Step 4: Run the tests to verify they pass

Run: `cd apps/app && bun x vitest run src/stores/__tests__/session-store.test.ts`
Expected: **PASS** (existing tests + the 5 new ones).

### Step 5: Typecheck + lint

Run: `cd apps/app && bun run typecheck`
Run: `bun x ultracite fix`
Expected: clean.

### Step 6: Commit

```bash
git add apps/app/src/stores/session-store.ts apps/app/src/stores/__tests__/session-store.test.ts
git commit -m "feat(app): windowed SessionStore (loadLatest/loadOlder/unread)"
```

---

## Task 3: Renderer — `actions.loadLatest` / `loadOlder` (consume the windowed endpoint)

Switch the actions layer to the new server shape and remove the now-unused `loadMessages` from both the store and its test.

**Files:**

- Modify: `apps/app/src/stores/actions.ts` (replace `loadMessages` with `loadLatest` + `loadOlder`).
- Modify: `apps/app/src/stores/session-store.ts` (remove `loadMessages` action + its interface line).
- Modify: `apps/app/src/stores/__tests__/session-store.test.ts` (remove the `loadMessages` describe block).
- Modify: `apps/app/src/stores/__tests__/actions.test.ts` (add tests for the two new actions).

### Step 1: Write the failing tests

In `apps/app/src/stores/__tests__/actions.test.ts`, add the import for the user-message factory at the top:

```ts
import { makeUserMessage } from "./helpers.ts";
```

Add these two tests inside the existing `describe("actions", () => { ... })`:

```ts
it("loadLatest fetches the latest window and loads it into the store", async () => {
  const deps = makeDeps();
  const mockApi = {
    api: {
      sessions: {
        [":id"]: {
          messages: {
            $get: vi.fn(() =>
              okRes({
                messages: [makeUserMessage("hi")],
                hasOlder: false,
              }),
            ),
          },
        },
      },
    },
  };
  const actions = createActions(mockApi as never, makeMockWs(), deps);

  await actions.loadLatest("s1");

  const session = deps.sessionRegistry.get("s1");
  expect(session.store.messageOrder).toHaveLength(1);
  expect(session.store.hasOlder).toBe(false);
  expect(mockApi.api.sessions[":id"].messages.$get).toHaveBeenCalledWith({
    param: { id: "s1" },
    query: { limit: "5" },
  });
});

it("loadOlder requests the older window using tailLoaded as skip", async () => {
  const deps = makeDeps();
  const session = deps.sessionRegistry.get("s1");
  const ui = (n: number) => ({
    id: `m${n}`,
    role: "user" as const,
    content: `m${n}`,
    parts: [],
    isStreaming: false,
    timestamp: 0,
  });
  // Preload the latest 5 so tailLoaded === 5.
  session.actions.loadLatest([ui(1), ui(2), ui(3), ui(4), ui(5)], true);

  const mockApi = {
    api: {
      sessions: {
        [":id"]: {
          messages: {
            $get: vi.fn(() => okRes({ messages: [makeUserMessage("old")], hasOlder: false })),
          },
        },
      },
    },
  };
  const actions = createActions(mockApi as never, makeMockWs(), deps);

  await actions.loadOlder("s1");

  expect(mockApi.api.sessions[":id"].messages.$get).toHaveBeenCalledWith({
    param: { id: "s1" },
    query: { limit: "5", skip: "5" },
  });
  // prepended → 5 existing + 1 older
  expect(session.store.messageOrder).toHaveLength(6);
  expect(session.store.messageOrder[0]).toBe(session.store.messageOrder[0]);
  expect(session.store.hasOlder).toBe(false);
});
```

### Step 2: Run the tests to verify they fail

Run: `cd apps/app && bun x vitest run src/stores/__tests__/actions.test.ts`
Expected: **FAIL** — `actions.loadLatest` / `actions.loadOlder` don't exist yet.

### Step 3: Implement the actions

In `apps/app/src/stores/actions.ts`:

Update the `Actions` interface — replace the `loadMessages` line with:

```ts
loadLatest: (sessionId: string) => Promise<void>;
loadOlder: (sessionId: string) => Promise<void>;
```

Replace the `loadMessages` method body (currently lines 87-98) with:

```ts
    async loadLatest(sessionId) {
      const res = await api.api.sessions[":id"].messages.$get({
        param: { id: sessionId },
        query: { limit: "5" },
      });
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as {
        messages: AgentMessage[];
        hasOlder: boolean;
      };
      const uiMessages = body.messages.map(agentMessageToUI);
      const session = sessionRegistry.get(sessionId);
      session.actions.loadLatest(uiMessages, body.hasOlder);
    },

    async loadOlder(sessionId) {
      const session = sessionRegistry.get(sessionId);
      const res = await api.api.sessions[":id"].messages.$get({
        param: { id: sessionId },
        query: { limit: "5", skip: String(session.store.tailLoaded) },
      });
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as {
        messages: AgentMessage[];
        hasOlder: boolean;
      };
      const uiMessages = body.messages.map(agentMessageToUI);
      session.actions.loadOlder(uiMessages, body.hasOlder);
    },
```

> **Typecheck note:** Hono RPC infers a permissive query type for routes that read query params manually (no typebox query validator) — the existing `sessions.$get({ query: { projectId } })` proves arbitrary string keys are accepted. If TS complains about `limit`/`skip`, cast the call argument the same way the tests do (`as never` is only for the fully-mocked api).

### Step 4: Remove the now-unused `loadMessages`

In `apps/app/src/stores/session-store.ts`:

- Delete the `loadMessages: (msgs: UIMessage[]) => void;` line from `SessionActions`.
- Delete the `loadMessages(msgs) { ... }` method body from the `actions` object.

In `apps/app/src/stores/__tests__/session-store.test.ts`:

- Delete the entire `describe("session store — loadMessages", () => { ... })` block (the `loadLatest` tests added in Task 2 supersede it).

### Step 5: Run the tests to verify they pass

Run: `cd apps/app && bun x vitest run src/stores/__tests__/actions.test.ts src/stores/__tests__/session-store.test.ts`
Expected: **PASS**.

### Step 6: Typecheck + lint

Run: `cd apps/app && bun run typecheck`
Run: `bun x ultracite fix`
Expected: clean.

### Step 7: Commit

```bash
git add apps/app/src/stores/actions.ts apps/app/src/stores/session-store.ts apps/app/src/stores/__tests__/actions.test.ts apps/app/src/stores/__tests__/session-store.test.ts
git commit -m "feat(app): actions loadLatest/loadOlder against windowed endpoint"
```

---

## Task 4: Renderer — cap rendered tool results and text

A fixed page size of 5 is only memory-safe if a single message can't be tens of MB. Cap tool `result` strings (the dominant bytes — file reads, grep, bash output) and any loaded text at store time. Full text stays on the server.

**Files:**

- Modify: `apps/app/src/stores/types.ts` (add `MAX_RENDER_TEXT` + `capForRender`; apply in `agentMessageToUI`).
- Modify: `apps/app/src/stores/session-store.ts` (cap `result` in `completeToolCall`).
- Modify: `apps/app/src/stores/__tests__/types.test.ts` (add a cap test).
- Modify: `apps/app/src/stores/__tests__/session-store.test.ts` (add a cap test for `completeToolCall`).

### Step 1: Write the failing tests

In `apps/app/src/stores/__tests__/types.test.ts`, add inside the edge-cases describe (or a new describe):

```ts
describe("agentMessageToUI — size cap", () => {
  it("truncates content longer than MAX_RENDER_TEXT with a marker", () => {
    const huge = "x".repeat(15_000);
    const msg = {
      role: "user",
      content: huge,
      timestamp: 1000,
    } as AgentMessage;

    const ui = agentMessageToUI(msg);

    expect(ui.content.length).toBeLessThan(huge.length);
    expect(ui.content).toContain("truncated");
    expect(ui.parts[0]?.text).toBe(ui.content);
  });
});
```

In `apps/app/src/stores/__tests__/session-store.test.ts`, add to the existing `describe("session store — completeToolCall", ...)`:

```ts
it("caps an oversized tool result", () => {
  const session = createSessionStore("s1");
  session.actions.addMessage(makeMessage({ id: "m1" }));
  session.actions.addToolCall("m1", "tc1", "read", {});
  const huge = "y".repeat(15_000);

  session.actions.completeToolCall("m1", "tc1", huge);

  const part = session.store.messages.m1!.parts[0] as {
    result?: string;
  };
  expect(part.result!.length).toBeLessThan(huge.length);
  expect(part.result).toContain("truncated");
});
```

### Step 2: Run the tests to verify they fail

Run: `cd apps/app && bun x vitest run src/stores/__tests__/types.test.ts src/stores/__tests__/session-store.test.ts`
Expected: **FAIL** — content/result are returned in full; no truncation marker present.

### Step 3: Implement the cap

In `apps/app/src/stores/types.ts`, add the constant + helper (near the top, after the imports):

```ts
export const MAX_RENDER_TEXT = 10_000;

/**
 * Bound a string for in-memory rendering. Full text lives on the server;
 * the renderer only ever holds the capped copy.
 */
export function capForRender(text: string, max = MAX_RENDER_TEXT): string {
  if (text.length <= max) {
    return text;
  }
  const omitted = text.length - max;
  return `${text.slice(0, max)}\n\n[… ${omitted} more characters truncated for display ]`;
}
```

In `agentMessageToUI`, apply the cap to the built content and the text part. Replace the two `content`/`parts` assignments in the user/assistant branch with capped versions. Concretely, after computing `content` (the joined string), use `const capped = capForRender(content);` and build the UIMessage with `content: capped` and `parts: [{ type: "text", text: capped }]`. (The existing tests that expect small strings unchanged still pass because the cap only fires above 10 000 chars.)

In `apps/app/src/stores/session-store.ts`, update `completeToolCall` to cap the result. Add the import at the top:

```ts
import { capForRender, idleStreamState, ... } from "./types.ts";
```

(merge `capForRender` into the existing `./types.ts` import — don't add a duplicate import line), and in `completeToolCall`:

```ts
    completeToolCall(msgId, toolCallId, result, isError = false) {
      const capped = capForRender(result);
      setStore("messages", msgId, "parts", (prev) =>
        prev.map((p) =>
          p.type === "tool_call" && p.toolCallId === toolCallId
            ? {
                ...p,
                status: isError ? ("error" as const) : ("done" as const),
                result: capped,
              }
            : p
        )
      );
      setStore("streaming", "currentToolName", null);
    },
```

### Step 4: Run the tests to verify they pass

Run: `cd apps/app && bun x vitest run src/stores/__tests__/types.test.ts src/stores/__tests__/session-store.test.ts`
Expected: **PASS**.

### Step 5: Typecheck + lint

Run: `cd apps/app && bun run typecheck`
Run: `bun x ultracite fix`
Expected: clean.

### Step 6: Commit

```bash
git add apps/app/src/stores/types.ts apps/app/src/stores/session-store.ts apps/app/src/stores/__tests__/types.test.ts apps/app/src/stores/__tests__/session-store.test.ts
git commit -m "feat(app): cap rendered tool results and text"
```

---

## Task 5: Renderer — dispose session store on tab close

Closing a workspace tab (not switching — switching keeps the window alive so a quick switch-back is instant) disposes that tab's session store so its bounded window + tool results are reclaimable. This is a pure wiring task between `tab-store` (which is decoupled from the registries) and `store-context` (which owns them).

**Files:**

- Modify: `apps/app/src/stores/tab-store.ts` (add an `onTabClose` subscriber hook; fire it from `closeTab`).
- Create: `apps/app/src/stores/__tests__/tab-store.test.ts`.
- Modify: `apps/app/src/stores/store-context.tsx` (subscribe → `sessionRegistry.dispose`).

### Step 1: Write the failing test

Create `apps/app/src/stores/__tests__/tab-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { closeTab, newTab, onTabClose, openProjectTab, switchTab } from "../tab-store.ts";

describe("tab-store — onTabClose", () => {
  it("fires subscribers with the closed tab's sessionId", () => {
    openProjectTab("p1", "s1");
    const closed: (string | null)[] = [];
    const unsub = onTabClose((sessionId) => {
      closed.push(sessionId);
    });

    // Close the tab whose index holds sessionId "s1".
    const idx = (() => {
      // openProjectTab made this the active tab.
      const tabsModule = require("../tab-store.ts");
      return tabsModule.activeTabIndex();
    })();
    closeTab(idx);

    expect(closed).toContain("s1");
    unsub();
  });

  it("does not fire on switchTab", () => {
    openProjectTab("p1", "s1");
    newTab();
    const closed: string[] = [];
    const unsub = onTabClose((sid) => {
      if (sid) {
        closed.push(sid);
      }
    });

    switchTab(0);
    expect(closed).toHaveLength(0);
    unsub();
  });

  it("unsubscribes", () => {
    const closed: string[] = [];
    const unsub = onTabClose((sid) => {
      if (sid) {
        closed.push(sid);
      }
    });
    unsub();
    openProjectTab("pX", "sX");
    const idx = 0;
    closeTab(idx);
    expect(closed).toHaveLength(0);
  });
});
```

> The test uses jsdom's `localStorage` (the vitest config sets `environment: "jsdom"`). `activeTabIndex` is already exported. If `require()` is undesirable in the ESM setup, replace the idx lookup with `activeTabIndex()` imported at the top.

### Step 2: Run the test to verify it fails

Run: `cd apps/app && bun x vitest run src/stores/__tests__/tab-store.test.ts`
Expected: **FAIL** — `onTabClose` is not exported.

### Step 3: Implement the hook + fire it

In `apps/app/src/stores/tab-store.ts`, add a subscriber set and export, near the other module-level state:

```ts
const closeListeners = new Set<(sessionId: string | null) => void>();

export function onTabClose(cb: (sessionId: string | null) => void): () => void {
  closeListeners.add(cb);
  return () => {
    closeListeners.delete(cb);
  };
}

function notifyClose(sessionId: string | null): void {
  for (const cb of closeListeners) {
    cb(sessionId);
  }
}
```

In `closeTab`, capture the removed tab and notify. The function currently computes `newTabs` from `tabs` via filter. Add capture + notify at the point of removal:

```ts
export function closeTab(index: number): void {
  const tabs = openTabs();
  if (index < 0 || index >= tabs.length) {
    return;
  }

  const removed = tabs[index];
  const newTabs = tabs.filter((_, i) => i !== index);

  if (newTabs.length === 0) {
    setOpenTabs([{ projectId: null, sessionId: null }]);
    setActiveTabIndex(0);
    notifyClose(removed?.sessionId ?? null);
    return;
  }

  const currentActive = activeTabIndex();
  let newActive = currentActive;

  if (index === currentActive) {
    newActive = Math.min(index, newTabs.length - 1);
  } else if (index < currentActive) {
    newActive = currentActive - 1;
  }

  setOpenTabs(newTabs);
  setActiveTabIndex(newActive);
  notifyClose(removed?.sessionId ?? null);
}
```

### Step 4: Wire the registry disposal in store-context

In `apps/app/src/stores/store-context.tsx`, add the import:

```ts
import { onTabClose } from "./tab-store.ts";
```

Inside `StoreProvider`, alongside the existing `onCleanup`, subscribe and dispose. Add after the `actions`/`ws` are constructed and before `return`:

```ts
const unsubscribeTabClose = onTabClose((sessionId) => {
  if (sessionId) {
    sessions.dispose(sessionId);
  }
});
```

And add `unsubscribeTabClose()` to the existing `onCleanup`:

```ts
onCleanup(() => {
  unsubscribeTabClose();
  ws.disconnect();
  sessions.disposeAll();
  terminals.disposeAll();
});
```

### Step 5: Run the tests to verify they pass

Run: `cd apps/app && bun x vitest run src/stores/__tests__/tab-store.test.ts`
Expected: **PASS**.

Run the full app suite to confirm no regressions:
Run: `cd apps/app && bun x vitest run`
Expected: **PASS** (all app tests).

### Step 6: Typecheck + lint

Run: `cd apps/app && bun run typecheck`
Run: `bun x ultracite fix`
Expected: clean.

### Step 7: Commit

```bash
git add apps/app/src/stores/tab-store.ts apps/app/src/stores/store-context.tsx apps/app/src/stores/__tests__/tab-store.test.ts
git commit -m "feat(app): dispose session store on tab close"
```

---

## Final verification

After all five tasks:

1. **Full server suite:** `cd apps/server && bun x vitest run` → all green.
2. **Full app suite:** `cd apps/app && bun x vitest run` → all green.
3. **Typecheck both:** `cd apps/server && bun run typecheck` and `cd apps/app && bun run typecheck` → clean.
4. **Lint:** `bun x ultracite fix` → no new diagnostics.
5. **Manual sanity (optional, no UI required):** start the server (`node --experimental-strip-types apps/server/src/index.ts`), `curl 'http://localhost:3001/api/sessions/<id>/messages?limit=5'` and confirm the `{ messages, hasOlder }` shape and that `?skip=5` returns the older window.

## Follow-ups (explicitly out of scope)

- `appendToken` O(n) realloc → accumulate into a mutable buffer + throttle `setContent` (rAF).
- `terminal-store` unbounded growing string → feed xterm directly with a bounded `scrollback`; dispose on process exit.
- Server-side visibility gating: stop streaming WS events for non-visible sessions so backgrounded runs don't get re-created in the renderer via `sessionRegistry.get`.
- The UI: message-list component, scroll-up → `actions.loadOlder`, viewport-bottom → `markAllRead`, the "↓ N new" badge reading `store.unread.count`.
