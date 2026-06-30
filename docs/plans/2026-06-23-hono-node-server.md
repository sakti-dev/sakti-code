# Hono + Node.js Server Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert `apps/server` from an Elysia-on-Bun app to an idiomatic Hono app running on Node.js, replacing all Bun-specific runtime APIs with Node equivalents (except `bun:sqlite`, which is deferred).

**Architecture:** Hono routes composed via `createFactory<AppEnv>()` + chained `.route()`, served by `@hono/node-server`. Each route module is a bare `factory.createApp()` mounted with its prefix. Context injected via one `createMiddleware` that sets `c.var.ctx`. WebSocket via `@hono/node-server`'s `upgradeWebSocket` + `ws`. Process spawning via `node:child_process`; file I/O via `node:fs/promises`; terminals via `node-pty`. Runtime validation via `@hono/typebox-validator` over the existing `typebox` package. Tests migrated from `bun:test` to `vitest`.

**Tech Stack:** Hono, `@hono/node-server`, `ws`, `@hono/typebox-validator`, `typebox` (existing), `node-pty`, `node:child_process`, `node:fs/promises`, `vitest`. Removed: `elysia`, `@elysiajs/eden`, `bun-pty`.

---

## Scope

**In scope:** Everything in `apps/server/src/` except the database layer.
**Out of scope (DEFERRED — do NOT touch):** `bun:sqlite` and `@sakti-code/db`. The files `create-server.ts` and `__tests__/helpers.ts` keep their `import { Database } from "bun:sqlite"` + `initDatabase(...)` calls untouched. A later, separate change (after `packages/*` is Node-ready) will re-wire `bun:sqlite` → `better-sqlite3` across server + db. Until then the server still boots under Bun _only because_ of that one import; everything else is Node-native.

**Test runner:** Migrate `bun:test` → `vitest` imports. Because `bun:sqlite` is deferred, the suite runs via **`bun x vitest run`** during this phase (vitest API, Bun runtime). After the DB re-wire, the command becomes plain `vitest run`.

**Known behavior changes (intentional, idiomatic Hono):**

1. Validation-failure status changes from **422 → 400** (Hono default; Elysia used 422). Tests asserting 422 must change to 400.
2. Error response bodies change from plain text (`new Response("Not found",{404})`) to **JSON** (`c.json({error:"Not found"},404)`) so Hono RPC can infer status-typed responses. Tests reading error `.text()` become `.json()`.
3. Elysia response schemas (`.model()` / `response: t.Object(...)`) are **dropped** — Hono has no response-validation concept; `c.json()` return-type inference replaces it for RPC. Repo rows may expose a few extra columns on some endpoints.
4. TypeBox query-param numeric coercion (`t.Numeric()`/`t.Integer()`) is **gone** — query params validate as strings and are parsed manually in handlers.

---

## Pre-flight (read before starting)

- Hono best practices: handlers inline + chained; `createFactory` for Env; `app.route(prefix, subApp)` for composition; `export type App = typeof app` for RPC. @best-practices, @rpc, @factory, @validation, @websocket.
- Workspace TypeBox is `typebox@1.2.18` (root dep), used by `packages/agent` + `packages/tools` via `import { Type } from "typebox"`. `@hono/typebox-validator` is built on this same package.
- `AGENTS.md` rules: `exactOptionalPropertyTypes: true` (use conditional spread `...(x !== undefined ? { x } : {})`); `bun x ultracite fix` before commit; arrow fns for callbacks; `for...of`; no `any` (prefer `unknown`); throw `Error` objects.

---

## Task 1: Dependencies

**Files:**

- Modify: `apps/server/package.json`

**Step 1: Swap deps**

```bash
cd apps/server
bun remove elysia @elysiajs/eden bun-pty
bun add hono @hono/node-server @hono/typebox-validator ws node-pty vitest
bun add -d @types/ws @types/node
```

**Step 2: Update scripts**

In `apps/server/package.json`, set:

```json
"scripts": {
  "start": "bun run src/index.ts",
  "dev": "bun run --hot src/index.ts",
  "test": "bun x vitest run",
  "typecheck": "tsc --noEmit"
}
```

**Step 3: Add `vitest.config.ts`** (root of `apps/server`):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 15000,
  },
});
```

**Step 4: Commit**

```bash
git add apps/server/package.json apps/server/vitest.config.ts bun.lock
git commit -m "chore(server): swap elysia/bun-pty for hono/node-server/node-pty/vitest"
```

---

## Task 2: Hono foundation — factory + context

**Files:**

- Create: `apps/server/src/factory.ts`
- Modify: `apps/server/src/context.ts`

**Step 1: Create `src/factory.ts`**

Single source of the app Env type (factory doc: "declare Env once"):

```ts
import { createFactory } from "hono/factory";
import type { ServerContext } from "./context.ts";

export type AppEnv = { Variables: { ctx: ServerContext } };

export const factory = createFactory<AppEnv>();
```

**Step 2: Rewrite `src/context.ts`**

Keep `ServerContext`, `createContext`, `createSessionStorage` **unchanged**. Replace the Elysia `getCtx(store)` with a Hono-typed middleware factory + a `getCtx(c)` helper:

Replace the existing `getCtx` function (and its doc-comment) with:

```ts
import type { Context } from "hono";
import { factory } from "./factory.ts";

/** Middleware that injects ServerContext into c.var.ctx for all downstream routes. */
export function ctxMiddleware(ctx: ServerContext) {
  return factory.createMiddleware(async (c, next) => {
    c.set("ctx", ctx);
    await next();
  });
}

/** Read the injected ServerContext from a Hono context. */
export function getCtx(c: Context): ServerContext {
  const ctx = (c.get("ctx") ?? c.var.ctx) as ServerContext | undefined;
  if (!ctx) {
    throw new Error("ServerContext not injected");
  }
  return ctx;
}
```

Keep the `import { factory } from "./factory.ts"` added at the top with the other imports.

**Step 3: Typecheck**

```bash
cd apps/server && bun run typecheck
```

Expected: errors in route files still importing `getCtx(store)` — that's fine, fixed in Task 6. The foundation files themselves must be internally consistent.

**Step 4: Commit**

```bash
git add apps/server/src/factory.ts apps/server/src/context.ts
git commit -m "feat(server): add Hono createFactory<AppEnv> + ctx middleware"
```

---

## Task 3: Bootstrap + app composition

**Files:**

- Modify: `apps/server/src/create-server.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`

**Step 1: Rewrite `src/app.ts`**

Idiomatic composition: chained `.route()` so `type App` infers for RPC. WS app is mounted **outside** the ctx middleware (it closes over `ctx` itself, and avoids the WS-helper + header-mutating-middleware conflict).

```ts
import type { ServerContext } from "./context.ts";
import { ctxMiddleware } from "./context.ts";
import { factory } from "./factory.ts";
import { buildWsApp } from "./agent/ws.ts";
import { createApiKeyRoutes } from "./routes/api-keys.ts";
import { dialogRoutes } from "./routes/dialog.ts";
import { healthRoutes } from "./routes/health.ts";
import { availableModelsRoutes } from "./routes/models/available-models.ts";
import { modelConfigRoutes } from "./routes/models/models.ts";
import { gitRoutes } from "./routes/projects/git.ts";
import { projectsRoutes } from "./routes/projects/projects.ts";
import { searchFilesRoutes } from "./routes/projects/search-files.ts";
import { compactionRoutes } from "./routes/sessions/compaction.ts";
import { exportRoutes } from "./routes/sessions/export.ts";
import { forkingRoutes } from "./routes/sessions/forking.ts";
import { lastAssistantTextRoutes } from "./routes/sessions/last-assistant-text.ts";
import { sessionSettingsRoutes } from "./routes/sessions/session-settings.ts";
import { sessionsRoutes } from "./routes/sessions/sessions.ts";
import { statsRoutes } from "./routes/sessions/stats.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { terminalRoutes } from "./routes/workspace/terminals.ts";
import { workspaceRoutes } from "./routes/workspace/workspace.ts";

export function buildApp(ctx: ServerContext) {
  const rest = factory
    .createApp()
    .route("/health", healthRoutes)
    .route("/projects", projectsRoutes)
    .route("/projects", gitRoutes)
    .route("/projects", searchFilesRoutes)
    .route("/sessions", sessionsRoutes)
    .route("/sessions", compactionRoutes)
    .route("/sessions", statsRoutes)
    .route("/sessions", forkingRoutes)
    .route("/sessions", exportRoutes)
    .route("/sessions", lastAssistantTextRoutes)
    .route("/sessions", sessionSettingsRoutes)
    .route("/settings", settingsRoutes)
    .route("/models", modelConfigRoutes)
    .route("/models", availableModelsRoutes)
    .route("/workspace", workspaceRoutes)
    .route("/workspace", terminalRoutes)
    .route("/dialog", dialogRoutes);

  return factory
    .createApp()
    .use(ctxMiddleware(ctx))
    .route("/api", rest)
    .route("/", buildWsApp(ctx))
    .route("/", createApiKeyRoutes(ctx.apiKeys));
}

export type App = ReturnType<typeof buildApp>;
```

> Note: multiple `.route("/projects", ...)` chaining merges sub-apps at the same prefix (Hono supports this). Each route module below is built with **bare** paths (`"/"`, `"/:id"`) — NO `basePath` (prefix lives in the mount, per best-practices doc).

**Step 2: Rewrite `src/create-server.ts`**

Replace `Bun.serve`/Elysia `.listen()` with `@hono/node-server` `serve()` + `serveStatic`. Keep `initDatabase(new Database(dbPath))` **unchanged** (DB deferred).

```ts
import { Database } from "bun:sqlite";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { initDatabase } from "@sakti-code/db";
import { buildApp } from "./app.ts";
import { createContext } from "./context.ts";
import { createApiKeyStore } from "./lib/api-key-store.ts";

export interface ServerHooks {
  onOpenFolderDialog?: () => Promise<string | null>;
}

export interface CreateServerOptions {
  dbPath?: string;
  hooks?: ServerHooks;
  hostname?: string;
  migrationsFolder?: string;
  port?: number;
  staticDir?: string | null;
}

export interface SaktiServer {
  hostname: string;
  port: number;
  stop(): Promise<void>;
  url: string;
}

export async function createServer(options?: CreateServerOptions): Promise<SaktiServer> {
  const {
    port = Number(process.env.SAKTI_PORT ?? 3001),
    hostname = process.env.SAKTI_HOST ?? "localhost",
    dbPath = process.env.SAKTI_DB_PATH ?? "sakti-code.db",
    staticDir = null,
    hooks = {},
    migrationsFolder,
  } = options ?? {};

  const db = await initDatabase(new Database(dbPath), {
    ...(migrationsFolder === undefined ? {} : { migrationsFolder }),
  });
  const apiKeys = createApiKeyStore(process.env.SAKTI_KEYS_PATH ?? undefined);
  apiKeys.loadIntoEnv();
  const ctx = createContext(db, hooks, apiKeys);

  const app = buildApp(ctx);

  if (staticDir) {
    const indexHtml = join(resolve(staticDir), "index.html");
    app.use(
      "*",
      serveStatic({
        root: resolve(staticDir),
        onNotFound: () => {},
      }),
    );
    // SPA fallback: unknown routes serve index.html
    app.get("*", (c) => {
      const file = Bun.file(indexHtml);
      return new Response(file);
    });
  }

  const server = serve({ fetch: app.fetch, port, hostname });

  const actualPort = server.port ?? port;
  const actualHostname = server.hostname ?? hostname;

  return {
    port: actualPort,
    hostname: actualHostname,
    url: `http://${actualHostname}:${actualPort}`,
    stop: () =>
      new Promise<void>((resolveStop) => {
        server.close(() => resolveStop());
      }),
  };
}
```

> Two notes:
>
> - `serveStatic` from `@hono/node-server/serve-static` handles path-traversal internally; the hand-rolled guard is removed.
> - The SPA fallback still uses `Bun.file` (Bun runtime is required during this phase due to deferred DB anyway). After DB re-wire, replace with `return c.body(createReadStream(indexHtml))` or read the file via `node:fs`.

**Step 3: Rewrite `src/index.ts`** (graceful shutdown per node-server doc):

```ts
import { createServer } from "./create-server.ts";

const sakti = await createServer();

console.log(`sakti-code server on ${sakti.url}`);

function shutdown(signal: string): void {
  console.log(`\n${signal} received — shutting down...`);
  sakti.stop().finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

**Step 4: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/create-server.ts apps/server/src/index.ts
git commit -m "feat(server): Hono app composition + @hono/node-server bootstrap"
```

---

## Task 4: WebSocket port

**Files:**

- Modify: `apps/server/src/agent/ws.ts`
- Modify: `apps/server/src/agent/ws-handler.ts`

**Step 1: Rewrite `src/agent/ws-handler.ts`**

Keep ALL the TS interfaces (`PromptMessage`, `WsIn`, `WsOut`, `WsHandle`, etc.) and `handleMessage` **unchanged**. Only the TypeBox import changes and the response schema is kept for type reference only (no runtime enforcement).

Change the import at the top:

```ts
// was: import { t } from "elysia";
import { Type as t } from "typebox";
```

Keep `wsBodySchema` (used for inbound validation). Keep `wsResponseSchema` definition but add a comment that it's the type-level reference only (Hono does no outbound runtime validation). No other changes to this file.

**Step 2: Rewrite `src/agent/ws.ts`**

Replace Elysia `.ws()` with `@hono/node-server` `upgradeWebSocket`. The module-level connection registries (`wsConnections`, `connectionStores`, `pushToConnection`, `hasWsConnection`, `registerTestConnection`, `unregisterTestConnection`, `wireTerminalCallbacks`, `getOrCreateStorage`, `clearStorageForConnection`, `getWsId`, `createWelcomeFrame`, `SERVER_VERSION`) all **stay unchanged** — they're framework-agnostic.

Replace the `buildWsApp` function with:

```ts
import { upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
// ...existing imports...

export function buildWsApp(ctx: ServerContext): Hono {
  let terminalCallbacksWired = false;

  return new Hono().get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(ws) {
        const wsId = getWsId(ws);
        wsConnections.set(wsId, ws);
        if (!terminalCallbacksWired) {
          wireTerminalCallbacks(ctx);
          terminalCallbacksWired = true;
        }
        ws.send(createWelcomeFrame());
      },
      async onMessage(ev, ws) {
        const wsId = getWsId(ws);
        let msg: unknown;
        try {
          msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        } catch {
          ws.send({ error: "Invalid JSON", sessionId: "", type: "error" });
          return;
        }
        // Inbound validation against wsBodySchema (TypeBox Check)
        if (!wsBodySchema = undefined ? false : true) {
          // (see below — replaced by a real Check)
        }
        const parsed = msg as { sessionId?: string };
        if (!parsed.sessionId) {
          ws.send({ error: "Missing sessionId", sessionId: "", type: "error" });
          return;
        }
        const storage = getOrCreateStorage(wsId, ctx, parsed.sessionId);
        handleMessage(ctx, storage, ws, msg as Parameters<typeof handleMessage>[3]);
      },
      onClose(ws) {
        const wsId = getWsId(ws);
        clearStorageForConnection(wsId);
        wsConnections.delete(wsId);
        ctx.terminalManager.closeByConnection(wsId);
      },
    }))
  );
}
```

Clean inbound validation block (replace the placeholder above):

```ts
import { Check } from "typebox/compile"; // or use Value.Errors

// inside onMessage, after JSON.parse:
if (!Check(wsBodySchema, msg)) {
  ws.send({ error: "Invalid message shape", sessionId: "", type: "error" });
  return;
}
```

> `Check` is imported from `"typebox/compile"` (confirmed: `node_modules/typebox/build/compile/index.d.mts` exports `Check`). If the named import differs, use `import { Compile } from "typebox/compile"` then `Compile(schema)(value)`. Verify with `bun run typecheck`.

> WS handle: the `WsHandle` interface is `{ send(data: unknown): void }`. Hono's `ws` arg in `upgradeWebSocket` callbacks matches this shape (`.send()`). The `wsIdMap = new WeakMap<object, string>()` keys on the Hono ws object — same identity across onOpen/onMessage/onClose. `getWsId(ws)` works unchanged.

**Step 3: Update WS server wiring in `create-server.ts`**

`@hono/node-server` `serve()` needs the `ws` `WebSocketServer`. Add to `createServer` (before `serve()`):

```ts
import { WebSocketServer } from "ws";
// ...
const wss = new WebSocketServer({ noServer: true });
const server = serve({
  fetch: app.fetch,
  port,
  hostname,
  websocket: { server: wss },
});
```

(Merge into the `serve()` call from Task 3 Step 2.)

**Step 4: Run WS unit tests**

```bash
cd apps/server && bun x vitest run src/agent/__tests__/ws.test.ts src/__tests__/terminal-push.test.ts src/__tests__/ws-welcome.test.ts
```

Expected: PASS (these test `handleMessage` + the registry functions directly, which are framework-agnostic).

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws.ts apps/server/src/agent/ws-handler.ts apps/server/src/create-server.ts
git commit -m "feat(server): port WS endpoint to @hono/node-server upgradeWebSocket"
```

---

## Task 5: Test harness — vitest setup + helpers

**Files:**

- Modify: `apps/server/src/__tests__/helpers.ts`
- Modify: all test files (import sweep)

**Step 1: Rewrite `src/__tests__/helpers.ts`** (`makeApp` builds a Hono app):

```ts
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { initDatabase } from "@sakti-code/db";
import { createContext, ctxMiddleware } from "../context.ts";
import { createApiKeyStore } from "../lib/api-key-store.ts";
import { factory } from "../factory.ts";

type AnyHono = Hono;

export async function makeApp(routes: AnyHono[]) {
  const db = await initDatabase(new Database(":memory:"));
  const apiKeys = createApiKeyStore(`/tmp/sakti-test-keys-${Date.now()}.json`);
  const ctx = createContext(db, {}, apiKeys);

  let rest = factory.createApp();
  // Each route module already carries bare paths + a basePath() of its prefix;
  // mount each at "/" so its own basePath wins.
  for (const route of routes) {
    rest = rest.route("/", route);
  }

  const app = factory.createApp().use(ctxMiddleware(ctx)).route("/api", rest);
  return { app, db, ctx };
}
```

> IMPORTANT path-matching detail: route modules (Task 6) are written as `factory.createApp().basePath("/sessions").get("/", ...)`. In `makeApp`, mounting at `"/"` preserves the `basePath`. In `buildApp` (Task 3), modules are mounted at their prefix WITHOUT basePath — **reconcile this**: pick ONE convention. **Decision: modules use NO `basePath`; the prefix is in the mount.** So update Task 6 modules to bare paths and mount each in `buildApp`/`makeApp` at its prefix. Adjust `makeApp` accordingly: it must know each module's prefix. Simplest: change `makeApp` to accept `[prefix, app][]` pairs, OR keep modules with `basePath()` and mount at `"/"` everywhere (including `buildApp`).

**RESOLUTION (use this everywhere):** Every route module calls `.basePath("/<prefix>")`. Both `buildApp` and `makeApp` mount via `.route("/", module)`. Rewrite Task 3's `buildApp` to mount each module at `"/"` under a `/api` parent:

```ts
export function buildApp(ctx: ServerContext) {
  const rest = factory
    .createApp()
    .route("/", healthRoutes) // basePath /health
    .route("/", projectsRoutes) // basePath /projects
    .route("/", gitRoutes) // basePath /projects
    .route("/", searchFilesRoutes) // basePath /projects
    .route("/", sessionsRoutes); // basePath /sessions
  // ... etc, all mounted at "/"
  return factory
    .createApp()
    .use(ctxMiddleware(ctx))
    .route("/api", rest)
    .route("/", buildWsApp(ctx))
    .route("/", createApiKeyRoutes(ctx.apiKeys));
}
```

> Verify Hono allows `.route("/", appWithBasePath)` accumulating multiple sub-apps — if not, mount each sub-app under its prefix explicitly: `.route("/api/health", healthRoutes)`. **Implementation must confirm which form Hono accepts by running the `wiring.test.ts` / `health.test.ts` first.** (Best-practices doc shows `app.route('/books', books)` where books has bare paths — so prefer bare-paths modules + prefixed mount. Fall back to basePath+"/" mount only if RPC typing demands.)

**Step 2: Import sweep — `bun:test` → `vitest`**

Across every file under `apps/server/src/**/*.test.ts` and `apps/server/src/**/__tests__/*.ts` (including `helpers.ts`):

- `from "bun:test"` → `from "vitest"`
- Top-level `spyOn(...)` → `vi.spyOn(...)` (vitest exports `spyOn` only as `vi.spyOn`)

```bash
cd apps/server
# replace imports
grep -rl 'from "bun:test"' src | xargs sed -i 's/from "bun:test"/from "vitest"/g'
# replace bare spyOn with vi.spyOn (careful: only the function-call form)
grep -rl 'spyOn(' src | xargs sed -i 's/\bspyon(/vi.spyOn(/g; s/\bsspyOn(/vi.spyOn(/g'
```

> Manual review required after sed — verify `vi` is imported in every file that now uses `vi.spyOn`.

**Step 3: Run a non-DB test to verify harness**

```bash
cd apps/server && bun x vitest run src/__tests__/ws-welcome.test.ts
```

Expected: PASS (this test only checks `createWelcomeFrame`, no DB).

**Step 4: Commit**

```bash
git add apps/server/src/__tests__/helpers.ts apps/server/src
git commit -m "test(server): migrate bun:test to vitest; Hono makeApp helper"
```

---

## Task 6: Port route modules (the 17 files)

**Files:** every file under `apps/server/src/routes/` + `api-keys.ts`.

### Transformation rules (apply to every route file)

| Elysia                                                              | Hono                                                                                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `import { Elysia, t } from "elysia"`                                | `import { Type as t } from "typebox"; import { tbValidator } from "@hono/typebox-validator"`                                                   |
| `import { Elysia } from "elysia"`                                   | `import { Hono } from "hono"`                                                                                                                  |
| `new Elysia({ name, prefix: "/x" })`                                | `new Hono().basePath("/x")`                                                                                                                    |
| `.get("/:id", ({ params, store }) => {...}, { response: t.X })`     | `.get("/:id", (c) => { const { params } = c; const ctx = getCtx(c); ... return c.json(data) })` — drop `response` schema                       |
| `.post("/", ({ body, store }) => {...}, { body: t.Object({...}) })` | `.post("/", tbValidator("json", t.Object({...})), (c) => { const body = c.req.valid("json"); const ctx = getCtx(c); ... return c.json(...) })` |
| `getCtx(store)`                                                     | `getCtx(c)`                                                                                                                                    |
| `new Response("Not found", { status: 404 })`                        | `c.json({ error: "Not found" }, 404)`                                                                                                          |
| `new Response(null, { status: 204 })`                               | `c.body(null, 204)`                                                                                                                            |
| `Response.json(data)`                                               | `c.json(data)`                                                                                                                                 |
| `set.status = 400; return { error }`                                | `return c.json({ error }, 400)`                                                                                                                |
| query schema with `t.Numeric()` / `t.Integer()`                     | validate query as **strings**, parse manually: `const limit = query.limit ? Number(query.limit) : 20`                                          |
| `.model({ x: schema })` / `t.Ref("x")` / `response: t.Array(...)`   | **delete entirely**                                                                                                                            |

**IMPORTANT `getCtx` callsite shape change:** Elysia destructures `{ params, body, query, store }` from the handler arg. Hono passes a single `c`. So:

- `({ params }) =>` → `(c) => { const params = c.req.param(); ... }` OR `(c) => { const id = c.req.param("id"); ... }`
- `({ query }) =>` → `const query = c.req.query()` (after `tbValidator("query", ...)` use `c.req.valid("query")`)
- `({ body }) =>` → `const body = c.req.valid("json")`

### Worked example: `src/routes/sessions/sessions.ts` (full rewrite)

```ts
import { buildSessionContext } from "@sakti-code/agent";
import { Hono } from "hono";
import { tbValidator } from "@hono/typebox-validator";
import { Type as t } from "typebox";
import { createSessionStorage, getCtx } from "../../context.ts";

export const sessionsRoutes = new Hono()
  .basePath("/sessions")
  // GET /?projectId=...
  .get("/", (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) {
      return c.json({ error: "Missing projectId" }, 400);
    }
    return c.json(getCtx(c).repos.sessions.listByProject(projectId));
  })
  // GET /:id
  .get("/:id", (c) => {
    const s = getCtx(c).repos.sessions.findById(c.req.param("id"));
    if (!s) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(s);
  })
  // POST /
  .post(
    "/",
    tbValidator(
      "json",
      t.Object({
        projectId: t.String(),
        modelId: t.String(),
        title: t.Optional(t.String()),
      }),
    ),
    (c) => {
      const body = c.req.valid("json");
      const created = getCtx(c).repos.sessions.create(body.projectId, body.modelId, {
        ...(body.title === undefined ? {} : { title: body.title }),
      });
      return c.json(created);
    },
  )
  // PATCH /:id
  .patch(
    "/:id",
    tbValidator(
      "json",
      t.Partial(
        t.Object({
          title: t.Union([t.String(), t.Null()]),
          modelId: t.String(),
          thinkingLevel: t.String(),
        }),
      ),
    ),
    (c) => {
      const updated = getCtx(c).repos.sessions.update(c.req.param("id"), c.req.valid("json"));
      return c.json(updated);
    },
  )
  // GET /:id/messages
  .get("/:id/messages", async (c) => {
    const ctx = getCtx(c);
    const storage = createSessionStorage(ctx, c.req.param("id"));
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages } = buildSessionContext(entries);
    return c.json(messages);
  });
```

### Per-file spec (apply transformation rules)

| File                                     | Prefix          | Special handling                                                                                                                                                 |
| ---------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/health.ts`                       | `/health`       | none — trivial                                                                                                                                                   |
| `routes/settings.ts`                     | `/settings`     | `new Response("Not found",404)`→`c.json({error},404)`; `new Response(null,204)`→`c.body(null,204)`                                                               |
| `routes/dialog.ts`                       | `/dialog`       | calls `ctx.hooks.onOpenFolderDialog`; returns `Response`                                                                                                         |
| `routes/api-keys.ts`                     | `/api/api-keys` | factory `createApiKeyRoutes(store)` stays a factory but returns `new Hono().basePath("/api/api-keys")`; `set.status=X; return {...}` → `return c.json({...}, X)` |
| `routes/models/models.ts`                | `/models`       | `tbValidator("json", ...)` for POST config                                                                                                                       |
| `routes/models/available-models.ts`      | `/models`       | GET only                                                                                                                                                         |
| `routes/projects/projects.ts`            | `/projects`     | GET/POST/PUT/DELETE; body validators                                                                                                                             |
| `routes/projects/git.ts`                 | `/projects`     | query validators — see Task 7 (spawn) + change `t.Integer({minimum:0})` query to string + manual parse; `limit=-5` test now expects **400**                      |
| `routes/projects/search-files.ts`        | `/projects`     | `t.Numeric()` query → string + manual parse; see Task 7                                                                                                          |
| `routes/sessions/sessions.ts`            | `/sessions`     | worked example above                                                                                                                                             |
| `routes/sessions/compaction.ts`          | `/sessions`     | async POST; `new Response(...,500)`→`c.json({error},500)`; `Response.json`→`c.json`                                                                              |
| `routes/sessions/stats.ts`               | `/sessions`     | drop `response: t.Object(...)`                                                                                                                                   |
| `routes/sessions/forking.ts`             | `/sessions`     | `Response.json`→`c.json`                                                                                                                                         |
| `routes/sessions/export.ts`              | `/sessions`     | returns `new Response(html,{headers})` → `c.html(html)` or `new Response(html,{headers})` (Hono accepts a raw Response)                                          |
| `routes/sessions/last-assistant-text.ts` | `/sessions`     | `Response.json`→`c.json`                                                                                                                                         |
| `routes/sessions/session-settings.ts`    | `/sessions`     | body validator; 204/404                                                                                                                                          |
| `routes/workspace/workspace.ts`          | `/workspace`    | `Response.json`→`c.json`                                                                                                                                         |
| `routes/workspace/terminals.ts`          | `/workspace`    | POST body validators; returns `Response` with status — convert to `c.json(...)`                                                                                  |

**Step 1:** Port each file per the table + worked example. Port `health.ts` first, run `health.test.ts`, then proceed file-by-file running each file's test.

**Step 2 (per file):** Run that file's test:

```bash
cd apps/server && bun x vitest run src/__tests__/<file>.test.ts
```

Expected: PASS. Fix the test for the two intentional behavior changes:

- `git.test.ts:122` — `422` → `400` for invalid `limit`.
- Any test reading error-response `.text()` on a now-JSON body → switch to `.json()` and assert `{ error: "Not found" }`.

**Step 3: Full route-suite run**

```bash
cd apps/server && bun x vitest run
```

Expected: all route + ws + terminal tests PASS.

**Step 4: Commit (one commit per logical group, or one big commit)**

```bash
git add apps/server/src/routes
git commit -m "feat(server): port all route modules from Elysia to Hono"
```

---

## Task 7: `Bun.spawn` → `node:child_process`

**Files:**

- Modify: `apps/server/src/agent/execution-env.ts` (the `exec()` method, lines ~332-406)
- Modify: `apps/server/src/routes/projects/git.ts` (`trySpawnGit`, `runGit`)
- Modify: `apps/server/src/routes/projects/search-files.ts` (`runFd`, `runFind`)
- Modify: `apps/server/src/__tests__/git.test.ts` (`execGit` helper)

**Bun vs Node spawn differences (critical):**

- `Bun.spawn(["/bin/sh","-c",cmd], {stdout:"pipe"})` → `child_process.spawn("/bin/sh", ["-c", cmd], {stdio:["ignore","pipe","pipe"]})`
- `proc.stdout`/`proc.stderr` are **Web `ReadableStream`** in Bun; **Node `Readable`** in Node. The `new Response(stream).text()` trick does NOT work on Node streams. Use `import { text } from "node:stream/consumers"` (Node ≥18): `await text(child.stdout)`.
- `proc.exited` (Promise<number>) → `new Promise<number>(r => child.on("close", code => r(code ?? 0)))`.
- `proc.kill()` → `child.kill()` (same name, works).
- **Missing binary:** `Bun.spawn` throws synchronously; Node `spawn` emits an async `'error'` event (ENOENT). `trySpawnGit`'s try/catch must be replaced with an error-event handler + a promise.

**Step 1: Add a shared spawn helper** to `git.ts` (or a new `src/lib/spawn.ts`):

Create `apps/server/src/lib/spawn.ts`:

```ts
import { spawn } from "node:child_process";
import { text } from "node:stream/consumers";

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

export function spawnPiped(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): {
  child: ReturnType<typeof spawn>;
  done: Promise<SpawnResult>;
  stdoutText: Promise<string>;
  stderrText: Promise<string>;
} {
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutText = text(child.stdout);
  const stderrText = text(child.stderr);
  const done = new Promise<SpawnResult>((resolve) => {
    let spawnError: string | undefined;
    child.on("error", (err) => {
      spawnError = err.message;
    });
    child.on("close", (code) => {
      Promise.all([stdoutText, stderrText]).then(([stdout, stderr]) =>
        resolve({ exitCode: code, stdout, stderr, spawnError }),
      );
    });
  });
  return { child, done, stdoutText, stderrText };
}
```

**Step 2: Rewrite `git.ts` `trySpawnGit` + `runGit`:**

```ts
import { spawnPiped } from "../../lib/spawn.ts";

function trySpawnGit(args: string[], cwd: string): ReturnType<typeof spawnPiped> | null {
  try {
    return spawnPiped("git", args, { cwd, env: { ...process.env } as Record<string, string> });
  } catch {
    return null;
  }
}

export async function runGit(
  args: string[],
  cwd: string,
  timeoutMs: number = GIT_TIMEOUT_MS,
): Promise<GitResult> {
  const spawned = trySpawnGit(args, cwd);
  if (spawned === null) {
    return { kind: "spawn-error", output: "git not found" };
  }
  const { child, done } = spawned;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);

  const result = await done;
  clearTimeout(timer);

  // Missing-binary case: Node emits async ENOENT error event
  if (result.spawnError) {
    return { kind: "spawn-error", output: "git not found" };
  }
  if (timedOut) {
    return { kind: "timeout", output: "git timed out" };
  }
  if (result.exitCode === 0) {
    return { kind: "ok", code: result.exitCode, output: result.stdout };
  }
  return { kind: "ok", code: result.exitCode, output: `${result.stdout}${result.stderr}`.trim() };
}
```

**Step 3: Rewrite `search-files.ts` `runFd` + `runFind`:** use `spawnPiped`, `await done`, read `.stdout` from result (no more `new Response(proc.stdout).text()`).

**Step 4: Rewrite `execution-env.ts` `exec()`** (lines ~332-406) to use `spawnPiped`:

```ts
const { child, done } = spawnPiped("/bin/sh", ["-c", command], {
  cwd: options?.cwd ?? this._cwd,
  ...(options?.env ? { env: options.env } : {}),
});
// timeout
const timeoutId = timeoutMs
  ? setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs)
  : undefined;
const onAbort = () => child.kill();
options?.abortSignal?.addEventListener("abort", onAbort);
try {
  const result = await done;
  if (result.spawnError) {
    return err(new ExecutionError("shell_unavailable", result.spawnError));
  }
  if (options?.abortSignal?.aborted) {
    return err(new ExecutionError("aborted", "Command aborted"));
  }
  if (timedOut) {
    return err(new ExecutionError("timeout", result.stderr || "Command timed out"));
  }
  return ok({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 0 });
} catch (e) {
  /* ...existing catch... */
} finally {
  if (timeoutId) clearTimeout(timeoutId);
  options?.abortSignal?.removeEventListener("abort", onAbort);
}
```

**Step 5: Rewrite `git.test.ts` `execGit` helper:**

```ts
import { spawnPiped } from "../lib/spawn.ts"; // adjust path
async function execGit(cwd: string, ...args: string[]): Promise<string> {
  const { done } = spawnPiped("git", args, {
    cwd,
    env: { ...process.env } as Record<string, string>,
  });
  const r = await done;
  return r.stdout;
}
```

**Step 6: Run tests**

```bash
cd apps/server && bun x vitest run src/__tests__/git.test.ts src/__tests__/search-files.test.ts
```

Expected: PASS — including "returns 500 when git is not on PATH" (now via async spawnError) and "rejects negative limit with 400" (status updated).

**Step 7: Commit**

```bash
git add apps/server/src/lib/spawn.ts apps/server/src/agent/execution-env.ts apps/server/src/routes/projects apps/server/src/__tests__/git.test.ts
git commit -m "feat(server): replace Bun.spawn with node:child_process spawn helper"
```

---

## Task 8: `Bun.file` / `Bun.write` → `node:fs/promises`

**Files:**

- Modify: `apps/server/src/agent/execution-env.ts` (5 sites: `Bun.write` ×2, `Bun.file().exists/arrayBuffer/text` ×3)

**Mapping:**

- `await Bun.write(path, data)` → `await writeFile(path, data)` (import `writeFile` from `node:fs/promises`)
- `await Bun.file(path).exists()` → `await access(path).then(() => true).catch(() => false)` (import `access` from `node:fs/promises`) — or use `stat` and catch ENOENT
- `await Bun.file(path).arrayBuffer()` → `await readFile(path)` (returns `Buffer`, a `Uint8Array` subtype — fine for `new Uint8Array` wrapping)
- `await Bun.file(path).text()` → `await readFile(path, "utf8")`

**Step 1:** Add `access, readFile, writeFile` to the existing `node:fs/promises` import block at top of `execution-env.ts`. Replace the 5 `Bun.*` calls.

**Step 2:** `Bun.write(path, new Uint8Array(0))` (create-empty-file) → `writeFile(path, new Uint8Array(0))`.

**Step 3:** Run any execution-env test (it's exercised via agent e2e). If none directly, typecheck:

```bash
cd apps/server && bun run typecheck
```

**Step 4: Commit**

```bash
git add apps/server/src/agent/execution-env.ts
git commit -m "feat(server): replace Bun.file/Bun.write with node:fs/promises"
```

---

## Task 9: `bun-pty` → `node-pty`

**Files:**

- Modify: `apps/server/src/terminal/terminal-manager.ts`

`node-pty`'s API is nearly identical to `bun-pty` (bun-pty modeled on it): `spawn(file, args, {name, cols, rows, cwd, env})` returns an `IPty` with `.onData(cb)`, `.onExit(({exitCode, signal}) => {})`, `.write`, `.resize`, `.kill`, `.pid`. The `IPty` and `IExitEvent` type names exist in both.

**Step 1: Swap imports + dynamic import:**

```ts
// top:
import type { IExitEvent, IPty } from "node-pty";
// ...
// inside loadBunPty (rename to loadPty):
const ptyMod = await import("node-pty");
ptySpawnFn = ptyMod.spawn;
```

**Step 2:** Update error messages `"bun-pty not loaded"` → `"node-pty not loaded"` and the `bunPtyAvailable` getter name → `ptyAvailable` (and its call-site in `routes/workspace/terminals.ts:40` `ctx.terminalManager.bunPtyAvailable` → `.ptyAvailable`).

**Step 3:** The `ptySpawnFn("/bin/sh", [], { cwd, cols, rows, name })` call works as-is — `node-pty`'s `spawn` accepts `{ name, cols, rows, cwd, env }`.

**Step 4:** `event.signal` in `onExit`: node-pty's `IExitEvent` is `{ exitCode: number; signal?: number | string }` — matches.

**Step 5:** Run terminal tests:

```bash
cd apps/server && bun x vitest run src/__tests__/terminal.test.ts src/__tests__/terminal-push.test.ts
```

Expected: PASS. (`terminal.test.ts` may skip actual pty spawn if bun-pty/node-pty unavailable in CI — check the test.)

**Step 6: Commit**

```bash
git add apps/server/src/terminal/terminal-manager.ts apps/server/src/routes/workspace/terminals.ts
git commit -m "feat(server): replace bun-pty with node-pty"
```

---

## Task 10: `create-server` static-serving tests

**Files:**

- Modify: `apps/server/src/__tests__/create-server.test.ts`

These tests start a real server via `createServer({ staticDir })` and `fetch()` it. They exercise `serveStatic` + the SPA fallback. No logic change to the tests themselves except the `bun:test`→`vitest` import (done in Task 5). Run them:

```bash
cd apps/server && bun x vitest run src/__tests__/create-server.test.ts
```

If the SPA-fallback `Bun.file` in `create-server.ts` doesn't stream correctly through `@hono/node-server`, adjust the fallback to read via `node:fs`:

```ts
import { readFile } from "node:fs/promises";
app.get("*", async (c) => {
  const html = await readFile(indexHtml, "utf8");
  return c.html(html);
});
```

**Commit:**

```bash
git add apps/server/src/create-server.ts apps/server/src/__tests__/create-server.test.ts
git commit -m "fix(server): static serving + SPA fallback on @hono/node-server"
```

---

## Task 11: Final verification

**Step 1: Full test suite**

```bash
cd apps/server && bun x vitest run
```

Expected: all non-DB-deferred tests PASS. (DB-touching tests pass because they still use `bun:sqlite` under `bun x vitest`'s Bun runtime.)

**Step 2: Typecheck**

```bash
cd apps/server && bun run typecheck
```

Expected: no errors.

**Step 3: Lint + format**

```bash
bun x ultracite fix
```

**Step 4: Smoke-test the server**

```bash
bun dev:server &
sleep 2
curl -s http://localhost:3001/api/health   # {"status":"ok","uptime":...}
kill %1
```

**Step 5: Grep for leftover Bun APIs (must be empty except the deferred DB import)**

```bash
cd apps/server && grep -rn 'Bun\.\(file\|spawn\|write\)\|from "elysia"\|from "bun:test"\|bun-pty' src
```

Expected: no matches. `bun:sqlite` imports in `create-server.ts` + `__tests__/helpers.ts` + 4 test files are **expected** (deferred).

**Step 6: Update `AGENTS.md`** Server section to reflect Hono + Node + vitest (replace "Elysia REST server" / "Eden treaty" language). Commit:

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for Hono + Node server"
```

---

## Deferred (NOT in this plan — separate change after `packages/*` is Node-ready)

- `bun:sqlite` → `better-sqlite3` in `create-server.ts`, `__tests__/helpers.ts`, and `packages/db/src/init.ts` (+ the `DrizzleDB` type → `drizzle-orm/better-sqlite3`).
- Switch test command `bun x vitest run` → `vitest run` (Node runtime) once no test imports `bun:sqlite`.
- Remove the `Bun.file` SPA fallback in `create-server.ts`, replace with `node:fs` stream.
- UI (`apps/app`): Eden treaty → Hono `hc<AppType>()`; Eden WS → raw `WebSocket` or `client.ws.$ws()`; create `hcWithType` helper (RPC perf tip).
