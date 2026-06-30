# Elysia Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **NOTE — this plan is now GENERAL GUIDELINES, not a direct execution script.** The work has been decomposed into **4 OpenSpec changes** (see the “OpenSpec change split” section at the end). Each change has its own proposal/spec/tasks. This document remains the shared reference: the grounded facts (repo signatures, agent API), conventions, structure decisions, and per-task code sketches all carry over. When a change's tasks.md conflicts with this plan, **the change wins** (it's the more current, more focused artifact). Read this plan for context and approved patterns; read the changes for what to actually build.

**Goal:** Build an Elysia REST + WebSocket server (`apps/server`) that exposes the existing agent/db/tools packages — CRUD state over typed REST, agent-loop streaming over a minimal WebSocket.

**Architecture:** One Bun process runs the server. Elysia routes call the existing repo classes directly (no service layer — repos _are_ the service layer) via an injected `ServerContext` in `.state()`. The agent loop runs **in-process** as an async generator: `agent/runner.ts` builds fresh tools+store+loop per prompt from the session's project cwd, streams `AgentEvent`s to the WebSocket. The loop is ephemeral (dies when the stream ends); only a `Map<sessionId, AbortController>` is long-lived. Eden treaty gives the SolidJS app a zero-codegen typed client for the REST routes.

**Structure (hybrid, not dogmatic DDD):** REST routes are flat in `routes/` — they're thin transport adapters that rhyme, so a folder per resource would be ceremony. The one domain with real complexity (model resolution + tool building + the loop bridge + WS transport — 4 mutually-dependent files) is promoted to an `agent/` folder because cohesion pays off there. `context.ts` stays flat at the root — it's a single injected object, not a library, so there is no `lib/` directory. **Messages are part of the Session aggregate** — there's no standalone message route file; `GET /api/sessions/:id/messages` lives in `sessions.ts` (messages have no existence outside a session). Costs keep their own thin `costs.ts` because they span project- and session-level aggregation (a read projection, not part of either aggregate).

**Tech Stack:** Bun 1.3.14, TypeScript 6.0.3, Elysia (`elysia@^1.4.28` + `@elysiajs/eden@^1.4.9`), `@earendil-works/pi-ai` (`getModel`), `bun:sqlite` (WAL already enabled in `initDatabase`), Vitest.

---

## Grounded facts (verified before writing this plan — do not re-derive)

**DB layer** (`packages/db`):

- `initDatabase(sqlite: Database): Promise<DrizzleDB>` — takes a `bun:sqlite` `Database` **instance** (not a path). Enables WAL + foreign keys internally. Create with `new Database(":memory:")` (tests) or `new Database(path)` (prod).
- `SqliteSessionStore(db)` implements `SessionStore` (`loadMessages`/`appendMessage`/`replaceMessages`). No cache.
- `ProjectRepo(db)`: `create(name, cwd)` async→row · `findById(id)` → row|undefined · `findByCwd(cwd)` · `list()` · `update(id, data)` async · `delete(id)` async
- `SessionRepo(db)`: `create(projectId, modelId, options?: {title?, thinkingLevel?})` async→row · `findById(id)` · `listByProject(projectId)` · `update(id, data)` async · `delete(id)` async
- `MessageRepo(db)`: `append(sessionId, data)` async→id · `loadBySession(sessionId)` · `replaceForSession(sessionId, msgs)` async · `countBySession(sessionId)`→number
- `CostRepo(db)`: `record(sessionId, projectId, usage, modelId)` async→id · `aggregateByProject(projectId)` · `aggregateBySession(sessionId)`
- `SettingsRepo(db)`: `get(key)`→value|null · `set(key, value)` async · `getAll()`
- `ModelConfigRepo(db)`: `set(data)` async→id · `getForProject(projectId)`→row|null · `getGlobalDefault()`→row|null. **No `findById`. No `apiKey` column** — schema is `{id, projectId, provider, modelId, thinkingLevel}`.
- `drizzle .get()` returns `undefined` (not `null`) for no match.

**Agent layer** (`packages/agent`):

- `createAgentLoop(AgentConfigInput): AgentLoop` where `AgentLoop.prompt(message, signal?): AsyncIterable<AgentEvent>`. Stream with `for await…of`.
- `AgentConfigInput` required: `model: AnyModel`, `sessionId: string`, `store: SessionStore`, `tools: AgentTool[]`. Optional (w/ defaults): `maxRetries`(3), `retryBaseDelayMs`(1000), `reserveTokens`(16000), `keepRecentTokens`(20000), `toolExecutionMode`("parallel").
- `AgentEvent`: 14-variant union; each has `type` + `timestamp`. The loop yields it directly — it **is** the WS wire payload.

**Tools** (`packages/tools`): `createReadTool(cwd)`, `createWriteTool(cwd)`, `createEditTool(cwd)`, `createBashTool(cwd)`, `createGrepTool(cwd)`, `createFindTool(cwd)`, `createLsTool(cwd)` — all take `cwd: string`.

**Model resolution** (`@earendil-works/pi-ai`):

- `getModel(provider, modelId): Model<...>` — static registry lookup. **API keys come from env** (`OPENAI_API_KEY` etc., read by pi-ai internally). No key arg.
- `getProviders()`, `getModels(provider)` — for a model-listing endpoint.
- Generic signature won't accept runtime `string`s cleanly; cast at the boundary → `AnyModel`.

**Workspace**: `apps/*` and `packages/*` are Bun workspaces. Package paths: `@sakti-code/agent`, `@sakti-code/db`, `@sakti-code/tools`. Resolve `.ts` directly in dev.

**Test approach**: Elysia apps are callable via `await app.handle(new Request("http://x/path", {method, body}))` — real HTTP semantics through the stack. Use Vitest with in-memory `bun:sqlite`. For the agent WS test, mock `@earendil-works/pi-ai` (`vi.mock`) the same way `packages/agent/src/__tests__/loop.test.ts` does.

---

## Conventions for every task

- **TDD**: write failing test → run (RED) → implement → run (GREEN) → commit.
- **Run tests**: `bun vitest run apps/server/` (vitest). The root `vitest.config.ts` includes `packages/**/__tests__/**` — **add `apps/**/**tests**/**`to`include`** in Task 1.
- **Typecheck**: `bun typecheck` (runs `tsc --project tsconfig.json` — the root config already `include`s `packages/*/src`; **add `apps/*/src` in Task 1**).
- **Lint/format**: `bun x ultracite fix` before each commit.
- **`exactOptionalPropertyTypes: true` is on** — use conditional spread `...(x !== undefined ? { x } : {})` instead of passing `undefined`.
- **Never block on committing.** Commit after each GREEN.

## Final structure (what you're building toward)

```
apps/server/src/
├── context.ts                   # flat — injected ServerContext (db + repos)
├── index.ts                     # flat — wiring: buildServer() + listen
├── routes/                      # flat folder — thin transport adapters
│   ├── health.ts                #   GET /health
│   ├── projects.ts              #   CRUD /api/projects
│   ├── sessions.ts              #   CRUD /api/sessions + /:id/messages (aggregate)
│   ├── costs.ts                 #   GET /api/costs/{projects,sessions}/:id
│   ├── settings.ts              #   GET/PUT /api/settings
│   ├── models.ts                #   DB-backed model-config CRUD
│   ├── available-models.ts      #   pi-ai registry (getModels/getProviders)
│   ├── git.ts                   #   git status/branch/diff/log (Task 13)
│   ├── compaction.ts            #   manual compact + auto settings (Task 14)
│   └── stats.ts                 #   unified session stats (Task 15)
└── agent/                       # PROMOTED to folder — 4 cohesive files
    ├── runner.ts                #   per-prompt loop bridge (was agent-runner.ts)
    ├── model-resolver.ts        #   getModel from stored config + env keys
    ├── tools-builder.ts         #   build 7 tools from project cwd
    └── ws.ts                    #   prompt/abort WebSocket handler
```

No `lib/` directory. `context.ts` is the DI root, not a library. If a genuinely shared helper (used by 3+ unrelated modules) emerges later, add it flat at `src/` root and promote to a directory only when there are several.

---

### Task 1: Scaffold `apps/server` package

**Files:**

- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/index.ts`
- Modify: `tsconfig.json` (add `apps/*/src` to `include`)
- Modify: `vitest.config.ts` (add `apps/**/__tests__/**` to `include`)
- Modify: root `package.json` (add `dev:server` script)

**Step 1: Create `apps/server/package.json`**

```json
{
  "name": "@sakti-code/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts"
  },
  "dependencies": {
    "@earendil-works/pi-ai": "*",
    "@elysia/eden": "^1.4.9",
    "@sakti-code/agent": "workspace:*",
    "@sakti-code/db": "workspace:*",
    "@sakti-code/tools": "workspace:*",
    "elysia": "^1.4.28"
  }
}
```

**Step 2: Create `apps/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

(The base config now sets `types: ["bun"]` and `strictNullChecks` is off by default here — keep `strict: true` from base.)

**Step 3: Modify root `tsconfig.json`** — add `apps` to include so `bun typecheck` covers it:

Change the `include` array to `["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"]`.

**Step 4: Modify `vitest.config.ts`** — extend `include`:

```ts
include: ["packages/**/__tests__/**/*.test.ts", "apps/**/__tests__/**/*.test.ts"],
```

**Step 5: Create a placeholder `apps/server/src/index.ts`**

```ts
import { Elysia } from "elysia";

const app = new Elysia().get("/health", () => "ok");

export { app };
```

**Step 6: Install deps**

Run: `bun install`
Expected: installs elysia, eden, links workspace packages. No errors.

**Step 7: Modify root `package.json`** — add dev script alongside existing `dev`:

Add to `scripts`: `"dev:server": "bun run --watch apps/server/src/index.ts"`.

**Step 8: Verify typecheck + lint**

Run: `bun typecheck`
Expected: 0 errors (elysia types resolve).

Run: `bun x ultracite fix`
Expected: formats the new files.

**Step 9: Commit**

```bash
git add -A
git commit -m "chore(server): scaffold apps/server with elysia + eden deps"
```

---

### Task 2: ServerContext + health route (TDD)

**Files:**

- Create: `apps/server/src/context.ts`
- Create: `apps/server/src/routes/health.ts`
- Create: `apps/server/src/__tests__/health.test.ts`

**Step 1: Write failing test `apps/server/src/__tests__/health.test.ts`**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { createContext } from "../context.ts";
import { healthRoutes } from "../routes/health.ts";

async function makeApp() {
  const db = await initDatabase(new Database(":memory:"));
  return healthRoutes.state("ctx", createContext(db));
}

describe("GET /health", () => {
  it("returns status ok", async () => {
    const app = await makeApp();
    const res = await app.handle(new Request("http://x/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });
});
```

**Step 2: Run test → verify RED**

Run: `bun vitest run apps/server/src/__tests__/health.test.ts`
Expected: FAIL — `createContext` and `healthRoutes` modules not found.

**Step 3: Create `apps/server/src/context.ts`**

```ts
import {
  CostRepo,
  MessageRepo,
  ModelConfigRepo,
  ProjectRepo,
  SessionRepo,
  SettingsRepo,
  type DrizzleDB,
} from "@sakti-code/db";

export interface ServerContext {
  db: DrizzleDB;
  repos: {
    projects: ProjectRepo;
    sessions: SessionRepo;
    messages: MessageRepo;
    costs: CostRepo;
    settings: SettingsRepo;
    models: ModelConfigRepo;
  };
}

export function createContext(db: DrizzleDB): ServerContext {
  return {
    db,
    repos: {
      projects: new ProjectRepo(db),
      sessions: new SessionRepo(db),
      messages: new MessageRepo(db),
      costs: new CostRepo(db),
      settings: new SettingsRepo(db),
      models: new ModelConfigRepo(db),
    },
  };
}
```

**Step 4: Create `apps/server/src/routes/health.ts`**

```ts
import { Elysia, t } from "elysia";
import type { ServerContext } from "../context.ts";

export const healthRoutes = new Elysia({ name: "routes.health" }).get(
  "/health",
  () => ({ status: "ok" as const, uptime: process.uptime() }),
  { response: t.Object({ status: t.Literal("ok"), uptime: t.Number() }) },
);

// Re-export the context type for convenience.
export type { ServerContext };
```

**Step 5: Run test → verify GREEN**

Run: `bun vitest run apps/server/src/__tests__/health.test.ts`
Expected: PASS (1 test).

**Step 6: Typecheck + lint + commit**

Run: `bun typecheck && bun x ultracite fix`

```bash
git add -A
git commit -m "feat(server): ServerContext + /health route"
```

---

### Task 3: Projects REST routes (TDD)

**Files:**

- Create: `apps/server/src/routes/projects.ts`
- Create: `apps/server/src/__tests__/projects.test.ts`

**Step 1: Write failing test**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { createContext } from "../context.ts";
import { projectsRoutes } from "../routes/projects.ts";

async function makeApp() {
  const db = await initDatabase(new Database(":memory:"));
  return projectsRoutes.state("ctx", createContext(db));
}

describe("projects routes", () => {
  it("POST then GET lists the project", async () => {
    const app = await makeApp();
    const created = await app.handle(
      new Request("http://x/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "demo", cwd: "/tmp/demo" }),
      }),
    );
    expect(created.status).toBe(200);
    const project = await created.json();
    expect(project.name).toBe("demo");
    expect(project.cwd).toBe("/tmp/demo");
    expect(typeof project.id).toBe("string");

    const list = await (await app.handle(new Request("http://x/api/projects"))).json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(project.id);
  });

  it("GET /:id returns 404 for unknown id", async () => {
    const app = await makeApp();
    const res = await app.handle(new Request("http://x/api/projects/nope"));
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run → RED**

Run: `bun vitest run apps/server/src/__tests__/projects.test.ts`
Expected: FAIL — `projectsRoutes` not found.

**Step 3: Create `apps/server/src/routes/projects.ts`**

```ts
import { Elysia, t } from "elysia";
import type { ServerContext } from "../context.ts";

const projectModel = t.Object({
  id: t.String(),
  name: t.String(),
  cwd: t.String(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
});

export const projectsRoutes = new Elysia({ name: "routes.projects" })
  .model({ project: projectModel })
  .get("/api/projects", ({ store }) => store.ctx.repos.projects.list(), {
    response: t.Array(t.Ref("project")),
  })
  .get(
    "/api/projects/:id",
    ({ params, store, set }) => {
      const p = store.ctx.repos.projects.findById(params.id);
      if (!p) {
        set.status = 404;
        return "Not found";
      }
      return p;
    },
    { response: t.Ref("project") },
  )
  .post(
    "/api/projects",
    ({ body, store }) => store.ctx.repos.projects.create(body.name, body.cwd),
    {
      body: t.Object({ name: t.String(), cwd: t.String() }),
      response: t.Ref("project"),
    },
  )
  .put(
    "/api/projects/:id",
    ({ params, body, store }) => store.ctx.repos.projects.update(params.id, body),
    {
      body: t.Partial(t.Object({ name: t.String(), cwd: t.String() })),
      response: t.Ref("project"),
    },
  )
  .delete("/api/projects/:id", ({ params, store }) => store.ctx.repos.projects.delete(params.id));
```

**Step 4: Run → GREEN**

Run: `bun vitest run apps/server/src/__tests__/projects.test.ts`
Expected: PASS (2 tests).

**Step 5: Typecheck + lint + commit**

```bash
bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): projects CRUD routes"
```

---

### Task 4: Sessions + Messages REST routes (TDD)

**Files:**

- Create: `apps/server/src/routes/sessions.ts`
- Create: `apps/server/src/__tests__/sessions.test.ts`

**Step 1: Write failing test**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { createContext } from "../context.ts";
import { sessionsRoutes } from "../routes/sessions.ts";

async function makeApp() {
  const db = await initDatabase(new Database(":memory:"));
  return sessionsRoutes.state("ctx", createContext(db));
}

async function seedProject(
  app: ReturnType<Awaited<ReturnType<typeof makeApp>>["handle"]> extends never
    ? never
    : Awaited<ReturnType<typeof makeApp>>,
) {
  // helper to create a project so FK is valid
}

describe("sessions routes", () => {
  it("creates a session under a project and lists it", async () => {
    const app = await makeApp();
    const ctx = app["~store"].ctx as import("../context.ts").ServerContext;
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");

    const created = await app.handle(
      new Request("http://x/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, modelId: "gpt-4o" }),
      }),
    );
    expect(created.status).toBe(200);
    const session = await created.json();
    expect(session.projectId).toBe(project.id);
    expect(session.modelId).toBe("gpt-4o");

    const list = await (
      await app.handle(new Request(`http://x/api/sessions?projectId=${project.id}`))
    ).json();
    expect(list).toHaveLength(1);
  });

  it("GET /api/sessions/:id/messages returns history (empty initially)", async () => {
    const app = await makeApp();
    const ctx = app["~store"].ctx as import("../context.ts").ServerContext;
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(new Request(`http://x/api/sessions/${session.id}/messages`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
```

**Step 2: Run → RED** (`sessionsRoutes` not found)

**Step 3: Create `apps/server/src/routes/sessions.ts`**

```ts
import { Elysia, t } from "elysia";

const sessionModel = t.Object({
  id: t.String(),
  projectId: t.String(),
  title: t.Union([t.String(), t.Null()]),
  modelId: t.String(),
  thinkingLevel: t.String(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
});

export const sessionsRoutes = new Elysia({ name: "routes.sessions" })
  .model({ session: sessionModel })
  .get(
    "/api/sessions",
    ({ query, store }) => store.ctx.repos.sessions.listByProject(query.projectId),
    {
      query: t.Object({ projectId: t.String() }),
      response: t.Array(t.Ref("session")),
    },
  )
  .get(
    "/api/sessions/:id",
    ({ params, store, set }) => {
      const s = store.ctx.repos.sessions.findById(params.id);
      if (!s) {
        set.status = 404;
        return "Not found";
      }
      return s;
    },
    { response: t.Ref("session") },
  )
  .post(
    "/api/sessions",
    ({ body, store }) =>
      store.ctx.repos.sessions.create(body.projectId, body.modelId, {
        ...(body.title !== undefined ? { title: body.title } : {}),
      }),
    {
      body: t.Object({
        projectId: t.String(),
        modelId: t.String(),
        title: t.Optional(t.String()),
      }),
      response: t.Ref("session"),
    },
  )
  .patch(
    "/api/sessions/:id",
    ({ params, body, store }) => store.ctx.repos.sessions.update(params.id, body),
    {
      body: t.Partial(
        t.Object({
          title: t.Union([t.String(), t.Null()]),
          modelId: t.String(),
          thinkingLevel: t.String(),
        }),
      ),
      response: t.Ref("session"),
    },
  )
  .get("/api/sessions/:id/messages", ({ params, store }) =>
    store.ctx.repos.messages.loadBySession(params.id),
  );
```

**Step 4: Run → GREEN**

Run: `bun vitest run apps/server/src/__tests__/sessions.test.ts`
Expected: PASS (2 tests).

> **Note:** if `app["~store"].ctx` is not the correct internal accessor in the installed Elysia version, switch the test to construct the project via a `projectsRoutes` instance instead. The cleaner pattern is to add a `projectsRoutes` import and POST through it — but reaching into the store is fine for seeding. Verify against the installed version; adjust if TS complains.

**Step 5: Typecheck + lint + commit**

```bash
bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): sessions + message-history routes"
```

---

### Task 5: Settings + Model-configs + Costs routes (TDD)

**Files:**

- Create: `apps/server/src/routes/settings.ts`
- Create: `apps/server/src/routes/models.ts`
- Create: `apps/server/src/routes/costs.ts`
- Create: `apps/server/src/__tests__/misc-routes.test.ts`

**Step 1: Write failing test** (covers all three)

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { createContext } from "../context.ts";
import { settingsRoutes } from "../routes/settings.ts";
import { costsRoutes } from "../routes/costs.ts";
import { modelConfigRoutes } from "../routes/models.ts";

async function appWith<T extends Record<string, unknown>>(
  route: new () => { state: (k: string, v: unknown) => any },
) {
  const db = await initDatabase(new Database(":memory:"));
  const ctx = createContext(db);
  // each route module is a single Elysia instance; chain .state
  return { ctx, app: (route as any).state("ctx", ctx) };
}

describe("settings routes", () => {
  it("PUT then GET round-trips a setting", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const app = settingsRoutes.state("ctx", createContext(db));
    const put = await app.handle(
      new Request("http://x/api/settings/theme", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "dark" }),
      }),
    );
    expect(put.status).toBe(204);
    const got = await (await app.handle(new Request("http://x/api/settings/theme"))).text();
    expect(got).toBe("dark");
  });
});

describe("costs routes", () => {
  it("aggregates by project (zero initially)", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(db);
    const app = costsRoutes.state("ctx", ctx);
    const project = await ctx.repos.projects.create("p", "/tmp/p");
    const res = await app.handle(new Request(`http://x/api/costs/projects/${project.id}`));
    expect(res.status).toBe(200);
    const agg = await res.json();
    expect(agg.totalInputTokens).toBe(0);
  });
});
```

**Step 2: Run → RED**

**Step 3: Create the three route files**

`apps/server/src/routes/settings.ts`:

```ts
import { Elysia, t } from "elysia";

export const settingsRoutes = new Elysia({ name: "routes.settings" })
  .get("/api/settings", ({ store }) => store.ctx.repos.settings.getAll())
  .get("/api/settings/:key", ({ params, store, set }) => {
    const v = store.ctx.repos.settings.get(params.key);
    if (v === null) {
      set.status = 404;
      return "Not found";
    }
    return v;
  })
  .put(
    "/api/settings/:key",
    ({ params, body, store, set }) => {
      store.ctx.repos.settings.set(params.key, body.value);
      set.status = 204;
    },
    { body: t.Object({ value: t.String() }) },
  );
```

`apps/server/src/routes/costs.ts`:

```ts
import { Elysia, t } from "elysia";

export const costsRoutes = new Elysia({ name: "routes.costs" })
  .get(
    "/api/costs/projects/:projectId",
    ({ params, store }) => store.ctx.repos.costs.aggregateByProject(params.projectId),
    {
      response: t.Object({
        totalInputTokens: t.Number(),
        totalOutputTokens: t.Number(),
        totalCostUsd: t.Number(),
      }),
    },
  )
  .get("/api/costs/sessions/:sessionId", ({ params, store }) =>
    store.ctx.repos.costs.aggregateBySession(params.sessionId),
  );
```

`apps/server/src/routes/models.ts` (DB-backed model-config CRUD, **not** the pi-ai registry):

```ts
import { Elysia, t } from "elysia";

const modelConfigModel = t.Object({
  id: t.String(),
  projectId: t.Union([t.String(), t.Null()]),
  provider: t.String(),
  modelId: t.String(),
  thinkingLevel: t.String(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
});

export const modelConfigRoutes = new Elysia({ name: "routes.modelConfigs" })
  .model({ modelConfig: modelConfigModel })
  .get("/api/model-configs/global", ({ store }) => store.ctx.repos.models.getGlobalDefault())
  .get("/api/model-configs/projects/:projectId", ({ params, store }) =>
    store.ctx.repos.models.getForProject(params.projectId),
  )
  .post("/api/model-configs", ({ body, store }) => store.ctx.repos.models.set(body), {
    body: t.Object({
      provider: t.String(),
      modelId: t.String(),
      thinkingLevel: t.Optional(t.String()),
      projectId: t.Optional(t.String()),
    }),
  });
```

**Step 4: Run → GREEN**

Run: `bun vitest run apps/server/src/__tests__/misc-routes.test.ts`
Expected: PASS (2 tests).

**Step 5: Typecheck + lint + commit**

```bash
bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): settings, costs, model-config routes"
```

---

### Task 6: Available-models endpoint (pi-ai registry) (TDD)

**Files:**

- Create: `apps/server/src/routes/available-models.ts`
- Create: `apps/server/src/__tests__/available-models.test.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-ai", () => ({
  getProviders: () => ["openai", "anthropic"],
  getModels: (p: string) =>
    p === "openai"
      ? [{ id: "gpt-4o", name: "GPT-4o", provider: "openai" }]
      : [{ id: "claude-3", name: "Claude 3", provider: "anthropic" }],
}));

const { availableModelsRoutes } = await import("../routes/available-models.ts");

describe("GET /api/available-models", () => {
  it("lists providers", async () => {
    const app = availableModelsRoutes;
    const res = await app.handle(new Request("http://x/api/available-models"));
    const body = await res.json();
    expect(body).toEqual(["openai", "anthropic"]);
  });
  it("lists models for a provider", async () => {
    const app = availableModelsRoutes;
    const res = await app.handle(new Request("http://x/api/available-models/openai"));
    const body = await res.json();
    expect(body[0].id).toBe("gpt-4o");
  });
});
```

**Step 2: Run → RED**

**Step 3: Create `apps/server/src/routes/available-models.ts`**

```ts
import { Elysia } from "elysia";
import { getModels, getProviders } from "@earendil-works/pi-ai";

export const availableModelsRoutes = new Elysia({
  name: "routes.availableModels",
})
  .get("/api/available-models", () => getProviders())
  .get("/api/available-models/:provider", ({ params }) => getModels(params.provider));
```

**Step 4: Run → GREEN**

Run: `bun vitest run apps/server/src/__tests__/available-models.test.ts`
Expected: PASS (2 tests).

**Step 5: Typecheck + lint + commit**

```bash
bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): available-models endpoint (pi-ai registry)"
```

---

### Task 7: `agent/` folder — model-resolver, tools-builder, runner (TDD)

This is the one domain promoted to its own folder. It holds 4 mutually-dependent files that change together: how a stored model config becomes a pi-ai `Model`, how a project cwd becomes 7 tools, the per-prompt loop bridge that wires them, and (Task 8) the WS transport. `model-resolver.ts` and `tools-builder.ts` are currently small seams — they exist for conceptual clarity and the growth paths they unlock (per-provider key handling, custom tool registration), not because 8-line files need their own module.

**Files:**

- Create: `apps/server/src/agent/model-resolver.ts`
- Create: `apps/server/src/agent/tools-builder.ts`
- Create: `apps/server/src/agent/runner.ts`
- Create: `apps/server/src/agent/__tests__/runner.test.ts`

**Step 1: Write failing test `apps/server/src/agent/__tests__/runner.test.ts`**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it, vi } from "vitest";
import { initDatabase } from "@sakti-code/db";

// Mock pi-ai the same way packages/agent/src/__tests__/loop.test.ts does.
vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return {
    ...actual,
    streamSimple: vi.fn(),
    getModel: (provider: string, modelId: string) => ({
      id: modelId,
      name: modelId,
      provider,
      api: "openai-completions",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 4096,
    }),
  };
});

const { streamSimple } = await import("@earendil-works/pi-ai");
const { runPrompt } = await import("../runner.ts");
const { createContext } = await import("../../context.ts");

function textStream(text: string) {
  const events = [
    {
      type: "done",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4o",
        timestamp: Date.now(),
      },
    },
  ];
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
  };
}

describe("runPrompt", () => {
  it("streams AgentEvents for a valid session+project", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(db);
    const project = await ctx.repos.projects.create("demo", process.cwd());
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    vi.mocked(streamSimple).mockReturnValue(textStream("hello") as any);

    const events = [];
    for await (const e of runPrompt(ctx, session.id, "hi", new AbortController().signal)) {
      events.push(e);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain("agent_start");
    expect(types).toContain("agent_end");

    // Messages persisted via the store
    expect(ctx.repos.messages.countBySession(session.id)).toBeGreaterThan(0);
  });

  it("throws on unknown session", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(db);
    await expect(
      (async () => {
        for await (const _ of runPrompt(ctx, "nope", "hi", new AbortController().signal)) {
        }
      })(),
    ).rejects.toThrow(/Session not found/);
  });
});
```

**Step 2: Run → RED** (`../runner.ts` not found)

Run: `bun vitest run apps/server/src/agent/__tests__/runner.test.ts`

**Step 3: Create `apps/server/src/agent/model-resolver.ts`**

```ts
import { type AnyModel } from "@sakti-code/agent";
import { getModel } from "@earendil-works/pi-ai";
import type { ServerContext } from "../context.ts";

/** Resolve a pi-ai Model from a session's model config. API keys come from env. */
export function resolveModel(ctx: ServerContext, session: { projectId: string }): AnyModel {
  const cfg =
    ctx.repos.models.getForProject(session.projectId) ?? ctx.repos.models.getGlobalDefault();
  if (!cfg) {
    throw new Error(`No model config for project ${session.projectId} and no global default`);
  }
  // getModel is generic over literal provider/modelId types; cast at this runtime boundary.
  return getModel(cfg.provider as never, cfg.modelId as never) as AnyModel;
}
```

**Step 4: Create `apps/server/src/agent/tools-builder.ts`**

```ts
import { type AgentTool } from "@sakti-code/agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@sakti-code/tools";

/** Build the 7 coding tools scoped to a project cwd. Fresh per prompt. */
export function buildTools(cwd: string): AgentTool[] {
  return [
    createReadTool(cwd),
    createWriteTool(cwd),
    createEditTool(cwd),
    createBashTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];
}
```

**Step 5: Create `apps/server/src/agent/runner.ts`**

```ts
import { type AgentEvent } from "@sakti-code/agent";
import { createAgentLoop } from "@sakti-code/agent";
import { SqliteSessionStore } from "@sakti-code/db";
import type { ServerContext } from "../context.ts";
import { resolveModel } from "./model-resolver.ts";
import { buildTools } from "./tools-builder.ts";

const activeRuns = new Map<string, AbortController>();

/** Run one prompt, yielding AgentEvents. The loop is ephemeral. */
export async function* runPrompt(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const session = ctx.repos.sessions.findById(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const project = ctx.repos.projects.findById(session.projectId);
  if (!project) throw new Error(`Project not found: ${session.projectId}`);

  const model = resolveModel(ctx, session);
  const store = new SqliteSessionStore(ctx.db);
  const loop = createAgentLoop({
    sessionId,
    model,
    tools: buildTools(project.cwd),
    store,
  });

  yield* loop.prompt(message, signal);
}

export function registerRun(sessionId: string, ctrl: AbortController) {
  activeRuns.set(sessionId, ctrl);
}
export function unregisterRun(sessionId: string) {
  activeRuns.delete(sessionId);
}
export function abortRun(sessionId: string): boolean {
  const ctrl = activeRuns.get(sessionId);
  if (!ctrl) return false;
  ctrl.abort();
  activeRuns.delete(sessionId);
  return true;
}
```

**Step 6: Run → GREEN**

Run: `bun vitest run apps/server/src/agent/__tests__/runner.test.ts`
Expected: PASS (2 tests).

**Step 7: Typecheck + lint + commit**

```bash
bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): agent/ folder — model-resolver, tools-builder, runner"
```

---

### Task 8: WebSocket handler — prompt/abort (TDD)

The WS transport lives in `agent/` alongside the runner it calls — transport + execution are one cohesive domain, which is the whole reason `agent/` is a folder.

**Files:**

- Create: `apps/server/src/agent/ws.ts`
- Create: `apps/server/src/agent/__tests__/ws.test.ts`

**Step 1: Write failing test**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it, vi } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { createContext } from "../../context.ts";
import { buildWsApp } from "../ws.ts";

// Reuse the pi-ai mock pattern; see runner test for streamSimple stub.
vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return {
    ...actual,
    streamSimple: vi.fn(),
    getModel: (provider: string, modelId: string) => ({
      id: modelId,
      name: modelId,
      provider,
      api: "openai-completions",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 4096,
    }),
  };
});

const { streamSimple } = await import("@earendil-works/pi-ai");

describe("WS /ws", () => {
  it("responds to a prompt with an event frame stream", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(db);
    const project = await ctx.repos.projects.create("demo", process.cwd());
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    vi.mocked(streamSimple).mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hi" }],
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            api: "openai-completions",
            provider: "openai",
            model: "gpt-4o",
            timestamp: Date.now(),
          },
        };
      },
    } as any);

    const app = buildWsApp().state("ctx", ctx);

    // Drive the WS handler directly with the in-memory WsTestClient pattern.
    const received: unknown[] = [];
    const send = (m: string) => received.push(JSON.parse(m));
    const ws = { send, subscribe: () => {}, data: { ctx } } as any;

    await app.config.websocket.message(
      ws,
      JSON.stringify({
        type: "prompt",
        sessionId: session.id,
        message: "hello",
      }),
    );

    // Fire-and-forget stream — poll briefly for the first frame.
    await new Promise((r) => setTimeout(r, 50));
    const types = received.map((f: any) => f.type);
    expect(types).toContain("event");
    const events = received.filter((f: any) => f.type === "event").map((f: any) => f.event.type);
    expect(events).toContain("agent_start");
  });
});
```

**Step 2: Run → RED** (`buildWsApp` not found)

Run: `bun vitest run apps/server/src/agent/__tests__/ws.test.ts`

**Step 3: Create `apps/server/src/agent/ws.ts`**

```ts
import { Elysia, t } from "elysia";
import type { ServerContext } from "../context.ts";
import { abortRun, registerRun, runPrompt, unregisterRun } from "./runner.ts";

export interface WsIn {
  type: "prompt" | "abort";
  message?: string;
  sessionId: string;
}

export interface WsOut {
  sessionId: string;
  type: "event" | "error";
  event?: unknown;
  message?: string;
}

export function buildWsApp() {
  return new Elysia({ name: "ws" }).ws("/ws", {
    body: t.Object({
      type: t.Union([t.Literal("prompt"), t.Literal("abort")]),
      sessionId: t.String(),
      message: t.Optional(t.String()),
    }),
    open() {
      /* connection established */
    },
    message(ws, msg: WsIn) {
      const ctx = ws.data.store.ctx as ServerContext;

      if (msg.type === "abort") {
        abortRun(msg.sessionId);
        return;
      }

      if (msg.type === "prompt" && msg.message !== undefined) {
        // Fire-and-forget: do NOT await — so the next prompt on the same
        // connection is processed concurrently (two projects at once).
        runAgentStream(ws, ctx, msg.sessionId, msg.message).catch((err) => {
          ws.send({
            type: "error",
            sessionId: msg.sessionId,
            message: err instanceof Error ? err.message : "Run failed",
          } satisfies WsOut);
        });
      }
    },
    close() {
      // In a full impl, abort runs owned by this connection. Track ws→sessions
      // in open()/message() if cross-session abort-on-disconnect is required.
    },
  });
}

async function runAgentStream(
  ws: { send: (m: unknown) => void },
  ctx: ServerContext,
  sessionId: string,
  message: string,
) {
  const ctrl = new AbortController();
  registerRun(sessionId, ctrl);
  try {
    for await (const event of runPrompt(ctx, sessionId, message, ctrl.signal)) {
      ws.send({ type: "event", sessionId, event } satisfies WsOut);
    }
  } finally {
    unregisterRun(sessionId);
  }
}
```

**Step 4: Run → GREEN**

Run: `bun vitest run apps/server/src/agent/__tests__/ws.test.ts`
Expected: PASS (1 test).

> **Note:** the exact `ws.data.store.ctx` path and the test's `app.config.websocket.message` accessor depend on the installed Elysia version. If the WS body validator rejects the `type` union, widen `body` to `t.Object({ type: t.String(), sessionId: t.String(), message: t.Optional(t.String()) })` and narrow inside the handler. Verify against the installed version; the TDD test will catch a mismatch.

**Step 5: Typecheck + lint + commit**

```bash
bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): WebSocket prompt/abort handler (concurrent)"
```

---

### Task 9: Wire everything in `index.ts` + listen

**Files:**

- Modify: `apps/server/src/index.ts`
- Create: `apps/server/src/__tests__/wiring.test.ts`

**Step 1: Write failing test** (verifies all routes compose into one app)

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { buildServer } from "../index.ts";

describe("built server", () => {
  it("responds to /health and /api/projects", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const app = buildServer({ db });
    const health = await (await app.handle(new Request("http://x/health"))).json();
    expect(health.status).toBe("ok");
    const projects = await (await app.handle(new Request("http://x/api/projects"))).json();
    expect(projects).toEqual([]);
  });
});
```

**Step 2: Run → RED** (`buildServer` not exported)

**Step 3: Rewrite `apps/server/src/index.ts`**

```ts
import { Elysia } from "elysia";
import { type DrizzleDB, initDatabase } from "@sakti-code/db";
import { Database } from "bun:sqlite";
import { createContext } from "./context.ts";
import { availableModelsRoutes } from "./routes/available-models.ts";
import { costsRoutes } from "./routes/costs.ts";
import { healthRoutes } from "./routes/health.ts";
import { modelConfigRoutes } from "./routes/models.ts";
import { projectsRoutes } from "./routes/projects.ts";
import { sessionsRoutes } from "./routes/sessions.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { buildWsApp } from "./agent/ws.ts";

export function buildServer({ db }: { db: DrizzleDB }) {
  return new Elysia()
    .state("ctx", createContext(db))
    .use(healthRoutes)
    .use(projectsRoutes)
    .use(sessionsRoutes)
    .use(settingsRoutes)
    .use(modelConfigRoutes)
    .use(costsRoutes)
    .use(availableModelsRoutes)
    .use(buildWsApp());
}

// Start listening when run directly (not when imported by tests).
if (import.meta.main) {
  const dbPath = process.env.SAKTI_DB_PATH ?? "sakti.db";
  const db = await initDatabase(new Database(dbPath));
  const app = buildServer({ db });
  app.listen(Number(process.env.SAKTI_PORT ?? 3001));
  console.log(`sakti-code server on http://localhost:${process.env.SAKTI_PORT ?? 3001}`);
}

export { app } from "elysia";
```

> **Note:** `import.meta.main` is the Bun idiom for "run directly, not imported." If the final `export { app }` line conflicts, drop it — it exists only to expose the app type for Eden. The Eden client imports the _type_ via `import type`. Adjust per TS resolution once the file exists.

**Step 4: Run → GREEN**

Run: `bun vitest run apps/server/src/__tests__/wiring.test.ts`
Expected: PASS (1 test).

**Step 5: Full server test suite**

Run: `bun vitest run apps/server/`
Expected: all server tests PASS.

**Step 6: Typecheck + lint + commit**

```bash
bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): wire all routes + WS into buildServer, listen on 3001"
```

---

### Task 10: Eden treaty client for the SolidJS app

**Files:**

- Modify: `apps/app/package.json` (add `@elysiajs/eden` + workspace dep)
- Create: `apps/app/src/lib/api.ts`

**Step 1: Add deps**

In `apps/app/package.json`, add to `dependencies`:

```json
"@elysiajs/eden": "^1.4.9",
"@sakti-code/server": "workspace:*"
```

Run: `bun install`

**Step 2: Create `apps/app/src/lib/api.ts`**

```ts
import { treaty } from "@elysia/eden";
import type { App } from "../../../../../server/src/index.ts";

export const api = treaty<App>("http://localhost:3001");

// Usage (typed, no codegen):
//   const { data } = await api.api.projects.get();
//   await api.api.sessions.post({ projectId, modelId });
```

> **Note:** the relative import path to the server's app type is fragile across moves. The robust alternative is to `export type { App } from "@sakti-code/server"` (re-export in `apps/server/src/index.ts`) and import via `import type { App } from "@sakti-code/server"`. Prefer the workspace import — add it to the server's barrel in this step.

**Step 3: Verify typecheck**

Run: `bun typecheck`
Expected: 0 errors. If the `App` type doesn't resolve, switch to the workspace re-export and re-run.

**Step 4: Commit**

```bash
bun x ultracite fix
git add -A
git commit -m "feat(app): Eden treaty client for typed server access"
```

---

### Task 11: End-to-end integration test (real loop → WS → events → persistence)

**Files:**

- Create: `apps/server/src/__tests__/e2e.test.ts`

**Step 1: Write the test** — a full multi-turn scenario through the built server: create project+session, send two prompts over the WS, assert both streams produce events and both persist messages, and that a third concurrent session on a _different_ project runs independently.

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it, vi } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { buildServer } from "../index.ts";

vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return {
    ...actual,
    streamSimple: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "done",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            api: "openai-completions",
            provider: "openai",
            model: "gpt-4o",
            timestamp: Date.now(),
          },
        };
      },
    })),
    getModel: (provider: string, modelId: string) => ({
      id: modelId,
      name: modelId,
      provider,
      api: "openai-completions",
      baseUrl: "",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 4096,
    }),
  };
});

function makeWsClient(ctx: unknown) {
  const received: any[] = [];
  const ws = {
    send: (m: string) => received.push(JSON.parse(m)),
    subscribe: () => {},
    data: { store: { ctx } },
  };
  return { ws, received };
}

describe("e2e: multi-session concurrency", () => {
  it("runs two projects concurrently, each persists independently", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const app = buildServer({ db });
    const ctx = (app as any)["~store"].ctx;

    const projA = await ctx.repos.projects.create("a", process.cwd());
    const projB = await ctx.repos.projects.create("b", "/tmp");
    const sessA = await ctx.repos.sessions.create(projA.id, "gpt-4o");
    const sessB = await ctx.repos.sessions.create(projB.id, "gpt-4o");

    const clientA = makeWsClient(ctx);
    const clientB = makeWsClient(ctx);

    await app.config.websocket.message(
      clientA.ws as any,
      JSON.stringify({ type: "prompt", sessionId: sessA.id, message: "one" }),
    );
    await app.config.websocket.message(
      clientB.ws as any,
      JSON.stringify({ type: "prompt", sessionId: sessB.id, message: "two" }),
    );

    await new Promise((r) => setTimeout(r, 100));

    // Each session persisted its own messages (no cross-contamination)
    const msgsA = ctx.repos.messages.loadBySession(sessA.id);
    const msgsB = ctx.repos.messages.loadBySession(sessB.id);
    expect(msgsA.length).toBeGreaterThan(0);
    expect(msgsB.length).toBeGreaterThan(0);
    expect(clientA.received.some((f) => f.sessionId === sessA.id)).toBe(true);
    expect(clientB.received.some((f) => f.sessionId === sessB.id)).toBe(true);
  });
});
```

**Step 2: Run → expect GREEN** (this is the integration proof; all pieces already built)

Run: `bun vitest run apps/server/src/__tests__/e2e.test.ts`
Expected: PASS.

**Step 3: Full suite + typecheck + lint + commit**

```bash
bun vitest run apps/server/ && bun typecheck && bun x ultracite fix
git add -A
git commit -m "test(server): e2e multi-session concurrency"
```

---

### Task 12: Documentation update

**Files:**

- Modify: `AGENTS.md` (add server commands + architecture note)

**Step 1: Update AGENTS.md** — add to the Commands section:

```
bun dev:server                              # run server with watch (port 3001)
SAKTI_DB_PATH=./sakti.db SAKTI_PORT=3001 bun run apps/server/src/index.ts
```

And add a one-paragraph "Server" note: REST for state (Elysia routes over `@sakti-code/db` repos), WS `/ws` for agent streaming (`prompt`/`abort` in, `event` out), Eden treaty client for typed frontend access. API keys from env; model config (provider+modelId) in DB.

**Step 2: Commit**

```bash
git add -A
git commit -m "docs(agents): document server commands + architecture"
```

---

## v1 parity tasks (PiBun gap analysis)

The first 12 tasks deliver a working server with CRUD + agent streaming. The next 3 close the highest-impact gaps vs PiBun (see gap analysis: git visibility, half-wired thinking level, stats). These are required for a usable v1 coding agent and are low-effort because the underlying functions (`compactMessages`, `runCommand`, cost aggregation) already exist. **Deferred to v1.5:** forking, steering/follow-up, user-bash, interactive terminals (bun-pty), export-to-HTML, project.searchFiles, session.getCommands. Those need new schema columns, loop-model changes, or OS integration and are out of v1 scope.

---

### Task 13: Git routes (TDD)

Every coding agent shows git state. Shells to `git` in the project cwd — no new schema, no subprocess lifecycle (each call is one-shot). Reuses the tools package's shell helper pattern but calls `git` directly via `Bun.spawn`/`execSync` to avoid importing tool internals.

**Files:**

- Create: `apps/server/src/routes/git.ts`
- Create: `apps/server/src/__tests__/git.test.ts`

**Step 1: Write failing test** (run inside a temp git repo for determinism)

```ts
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { createContext } from "../context.ts";
import { gitRoutes } from "../routes/git.ts";

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sakti-git-"));
  execSync("git init -q && git config user.email t@t && git config user.name t", { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "hi");
  execSync("git add a.txt && git commit -qm init", { cwd: dir });
  writeFileSync(join(dir, "a.txt"), "changed");
  return dir;
}

async function appAt(cwd: string) {
  const db = await initDatabase(new Database(":memory:"));
  const ctx = createContext(db);
  await ctx.repos.projects.create("repo", cwd);
  return gitRoutes.state("ctx", ctx).state("cwd", cwd);
}

describe("git routes", () => {
  it("status shows modified file", async () => {
    const cwd = tempRepo();
    const app = await appAt(cwd);
    const res = await app.handle(
      new Request(`http://x/api/git/status?cwd=${encodeURIComponent(cwd)}`),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("a.txt");
  });
  it("branch returns current branch", async () => {
    const cwd = tempRepo();
    const app = await appAt(cwd);
    const res = await app.handle(
      new Request(`http://x/api/git/branch?cwd=${encodeURIComponent(cwd)}`),
    );
    expect(res.status).toBe(200);
  });
  it("log returns at least one commit", async () => {
    const cwd = tempRepo();
    const app = await appAt(cwd);
    const res = await app.handle(
      new Request(`http://x/api/git/log?cwd=${encodeURIComponent(cwd)}&limit=5`),
    );
    const body = await res.text();
    expect(body).toContain("init");
  });
});
```

**Step 2: Run → RED** (`gitRoutes` not found)

**Step 3: Create `apps/server/src/routes/git.ts`**

```ts
import { execSync } from "node:child_process";
import { Elysia, t } from "elysia";

function git(args: string, cwd: string, timeout = 10_000): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      timeout,
      maxBuffer: 1024 * 1024,
      shell: "/bin/sh",
    });
  } catch (err) {
    // Non-zero exit (e.g. nothing to commit) — return stderr so UI can show it.
    const e = err as { stdout?: string; stderr?: string; message: string };
    return (e.stdout ?? "") + (e.stderr ?? "") || e.message;
  }
}

export const gitRoutes = new Elysia({ name: "routes.git" })
  .get("/api/git/status", ({ query }) => git("status --short", query.cwd), {
    query: t.Object({ cwd: t.String() }),
  })
  .get("/api/git/branch", ({ query }) => git("branch --show-current", query.cwd), {
    query: t.Object({ cwd: t.String() }),
  })
  .get(
    "/api/git/diff",
    ({ query }) =>
      git(`diff ${query.staged ? "--cached" : ""} ${query.path ?? ""}`.trim(), query.cwd),
    {
      query: t.Object({
        cwd: t.String(),
        staged: t.Optional(t.Boolean()),
        path: t.Optional(t.String()),
      }),
    },
  )
  .get("/api/git/log", ({ query }) => git(`log -n ${query.limit ?? 20} --oneline`, query.cwd), {
    query: t.Object({ cwd: t.String(), limit: t.Optional(t.Number()) }),
  });
```

**Step 4: Run → GREEN**

Run: `bun vitest run apps/server/src/__tests__/git.test.ts`
Expected: PASS (3 tests).

> **Note:** passing `cwd` as a query param is a v1 simplification. The robust approach resolves cwd from the session's projectId (join `gitRoutes` with project lookup). If you prefer that, change the query to `sessionId` and resolve cwd via `ctx.repos`. Either works; the query-param form is simpler to test and matches PiBun's `git.status(cwd)` shape. Decide before wiring in Task 9 — keep it consistent with how the WS handler resolves cwd.

**Step 5: Typecheck + lint + commit**

```bash
bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): git status/branch/diff/log routes"
```

---

### Task 14: Compaction route (TDD)

Closes a single gap: `compactMessages()` exists in the agent package but has no server route. This task adds ONLY the route — a thin server-layer concern that calls the already-built agent function.

**Scope correction (important):** An earlier draft of this task bundled in two agent-package concerns — wiring `thinkingLevel` through to `streamSimple`, and threading per-session `maxRetries` into `createAgentLoop`. That bundling was wrong: those are _agent-layer_ capability extensions, not server routes. They cross package boundaries (`packages/agent/src/types.ts` + `streaming.ts`) and deserve their own OpenSpec change in the agent domain. They are **out of scope here** and tracked in the v1.5 roadmap below. Mixing them into a server route task muddies the change's story and risks ballooning into an agent-package refactor. **This task does the route only.**

**Files:**

- Create: `apps/server/src/routes/compaction.ts`
- Create: `apps/server/src/__tests__/compaction.test.ts`

**Step 1: Write failing test**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { createContext } from "../context.ts";
import { compactionRoutes } from "../routes/compaction.ts";

describe("compaction route", () => {
  it("compacts a session's messages and returns token counts", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(db);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    // Seed many messages to make compaction do work
    for (let i = 0; i < 50; i++) {
      await ctx.repos.messages.append(session.id, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(500),
      });
    }

    const app = compactionRoutes.state("ctx", ctx);
    const res = await app.handle(
      new Request(`http://x/api/sessions/${session.id}/compact`, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokensBefore).toBeGreaterThan(body.tokensAfter);
    expect(body.tokensAfter).toBeGreaterThan(0);
  });
  it("returns 404 for unknown session", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const app = compactionRoutes.state("ctx", createContext(db));
    const res = await app.handle(
      new Request("http://x/api/sessions/nope/compact", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run → RED** (`compactionRoutes` not found)

**Step 3: Create `apps/server/src/routes/compaction.ts`**

```ts
import { Elysia } from "elysia";
import { compactMessages, estimateTokens, type AgentMessage } from "@sakti-code/agent";
import { SqliteSessionStore } from "@sakti-code/db";

export const compactionRoutes = new Elysia({ name: "routes.compaction" }).post(
  "/api/sessions/:id/compact",
  async ({ params, store, set }) => {
    const ctx = store.ctx;
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      set.status = 404;
      return "Not found";
    }
    const store2 = new SqliteSessionStore(ctx.db);
    const messages = await store2.loadMessages(params.id);
    const tokensBefore = estimateTokens(messages);
    const compacted = await compactMessages(messages, {
      // completeSimple is the lightweight summarizer; see packages/agent compaction tests
      summarize: undefined, // uses completeSimple default inside compactMessages
      keepRecentTokens: 20_000,
    });
    await store2.replaceMessages(params.id, compacted);
    const tokensAfter = estimateTokens(compacted as AgentMessage[]);
    return { tokensBefore, tokensAfter };
  },
);
```

> **Note on `compactMessages` signature:** verify the exact signature in `packages/agent/src/compaction.ts` before implementing. The plan assumes `(messages, opts?)` returning `AgentMessage[]`, with `opts.summarize` optional (defaults to `completeSimple`). If the real signature differs (e.g. requires a model), pass `resolveModel(ctx, session)` — the route already has access to it. The test asserts `tokensBefore > tokensAfter`, which is the real behavioral contract regardless of signature shape.

**Step 4: Run → GREEN**

Run: `bun vitest run apps/server/src/__tests__/compaction.test.ts`
Expected: PASS (2 tests).

**Step 5: Typecheck + lint + commit**

```bash
bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): compaction route"
```

---

### Task 15: Session stats route (TDD)

PiBun's `session.getStats` returns a unified summary (message count, token totals, duration). We have cost aggregation but not a single stats object. This is a thin read-only projection — no new schema, just composing existing repo calls.

**Files:**

- Create: `apps/server/src/routes/stats.ts`
- Create: `apps/server/src/__tests__/stats.test.ts`

**Step 1: Write failing test**

```ts
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { initDatabase } from "@sakti-code/db";
import { createContext } from "../context.ts";
import { statsRoutes } from "../routes/stats.ts";

describe("session stats", () => {
  it("returns counts and cost aggregates for a session", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const ctx = createContext(db);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
    await ctx.repos.messages.append(session.id, { role: "user", content: "hi" });
    await ctx.repos.messages.append(session.id, { role: "assistant", content: "yo" });

    const app = statsRoutes.state("ctx", ctx);
    const res = await app.handle(new Request(`http://x/api/sessions/${session.id}/stats`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messageCount).toBe(2);
    expect(body.totalInputTokens).toBe(0); // no costs recorded yet
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
  });
  it("returns 404 for unknown session", async () => {
    const db = await initDatabase(new Database(":memory:"));
    const app = statsRoutes.state("ctx", createContext(db));
    const res = await app.handle(new Request("http://x/api/sessions/nope/stats"));
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run → RED** (`statsRoutes` not found)

**Step 3: Create `apps/server/src/routes/stats.ts`**

```ts
import { Elysia, t } from "elysia";

export const statsRoutes = new Elysia({ name: "routes.stats" }).get(
  "/api/sessions/:id/stats",
  ({ params, store, set }) => {
    const ctx = store.ctx;
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      set.status = 404;
      return "Not found";
    }
    const messageCount = ctx.repos.messages.countBySession(params.id);
    const costs = ctx.repos.costs.aggregateBySession(params.id);
    return {
      messageCount,
      totalInputTokens: costs?.totalInputTokens ?? 0,
      totalOutputTokens: costs?.totalOutputTokens ?? 0,
      totalCostUsd: costs?.totalCostUsd ?? 0,
      createdAt: session.createdAt,
      durationMs: Date.now() - session.createdAt,
    };
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
  },
);
```

**Step 4: Run → GREEN**

Run: `bun vitest run apps/server/src/__tests__/stats.test.ts`
Expected: PASS (2 tests).

**Step 5: Wire into index.ts** — add `statsRoutes`, `compactionRoutes`, `gitRoutes` to the `.use()` chain in `buildServer` (Task 9's `index.ts`).

**Step 6: Full suite + typecheck + lint + commit**

```bash
bun vitest run apps/server/ && bun typecheck && bun x ultracite fix
git add -A
git commit -m "feat(server): session stats + wire new routes into buildServer"
```

---

## Done criteria

- `bun vitest run apps/server/` — all route + WS + e2e + parity tests pass
- `bun typecheck` — 0 errors
- `bun x ultracite check` — 0 errors
- `bun dev:server` starts; `curl http://localhost:3001/health` → `{"status":"ok",...}`
- Two concurrent prompts on two projects persist independently (e2e test proves it)
- Git status/branch/diff/log work against a real repo (Task 13)
- Manual compaction reduces token count (Task 14)
- Session stats returns unified counts + costs (Task 15)

## Out of scope (v1.5 roadmap)

Deferred from PiBun parity — each needs new schema, loop-model changes, or OS integration:

- **Session forking** (`session.fork` + `getForkMessages`) — needs `parentSessionId` column
- **Steering / follow-up** (`session.steer`, `.followUp` + modes) — inject guidance mid-run; loop-model change
- **User bash** (`session.bash`/`abortBash`) — user-run commands separate from the agent tool
- **Interactive terminals** (`terminal.create/write/resize/close`) — bun-pty PTY integration
- **Thinking level fully wired** — stored today, but `streamSimple` isn't called with it; needs agent-package change
- **Export to HTML** (`session.exportHtml`)
- **`project.searchFiles`** + **`session.getCommands`** — UI convenience
- **Workspace sidebar persistence** (`workspace.getLoaded/addLoaded/removeLoaded`) — fold into settings when needed

## Open risks the executor should watch

- **Elysia WS internals** (`ws.data.store.ctx`, `app.config.websocket.message` in tests, `import.meta.main`) — verify against the installed version; the TDD tests catch mismatches. The plan marks these with "Note" callouts.
- **Eden import path** (`@elysia/eden` vs `@elysiajs/eden`) — verify which the installed `@elysiajs/eden@^1.4.9` resolves; use whichever the package exports.
- **`getModel` generic cast** — `getModel(provider as never, modelId as never) as AnyModel` is intentional at the runtime-value boundary; biome may want a `noExplicitAny`-style ignore on `AnyModel` (already covered in the agent package).

---

## OpenSpec change split

This plan is decomposed into **4 OpenSpec changes**. They form a clean DAG: one foundation, then three independent leaves that can be built in parallel worktrees once the foundation lands.

```
                  server-rest-api          ← foundation (ships a usable typed CRUD API)
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
   agent-streaming   git-integration  session-utils
   (the real-time    (subprocess      (pure DB
    layer)            feature)          projections)
```

### Why these boundaries

Split by **capability boundary**, not by task. The test for each change: _could this ship on its own and be valuable?_

- **`server-rest-api`** — Tasks 1–6 + 10 (+ the REST-wiring half of Task 9). Independently shippable: a fully-typed CRUD API over the DB; the frontend can start building immediately. Splitting it smaller (e.g. "scaffold" alone) would ship an empty shell.
- **`server-agent-streaming`** — Tasks 7, 8, the WS-wiring half of Task 9, and Task 11 (e2e). The WS layer is architecturally distinct from REST (stateful vs stateless, streaming, mock-stream tests). It's the change that makes the agent come alive. Runner + WS only make sense together — splitting them yields a runner nothing calls and a WS with nothing to stream. Needs a `design.md` (fire-and-forget concurrency, ephemeral loop, abort registry).
- **`server-git-integration`** — Task 13 only. Git is a genuinely different beast from the other parity routes: it shells to a subprocess, needs temp-repo test setup, and raises a cwd-security surface. Bundling subprocess-driven git with pure-DB projections would muddy the change's story.
- **`server-session-utils`** — Tasks 14 + 15. Compaction route + stats route. Both are "compute/transform over session data" — cohesive enough to share a change. Both reuse existing repo calls, no new schema.

### Task → change mapping

| Plan task                | Change                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- |
| 1 Scaffold               | `server-rest-api`                                                               |
| 2 Health                 | `server-rest-api`                                                               |
| 3 Projects               | `server-rest-api`                                                               |
| 4 Sessions + Messages    | `server-rest-api`                                                               |
| 5 Settings/Models/Costs  | `server-rest-api`                                                               |
| 6 Available-models       | `server-rest-api`                                                               |
| 7 agent/ folder          | `server-agent-streaming`                                                        |
| 8 WS handler             | `server-agent-streaming`                                                        |
| 9 Wire index.ts + listen | split — REST wiring in `server-rest-api`, WS wiring in `server-agent-streaming` |
| 10 Eden client           | `server-rest-api`                                                               |
| 11 e2e concurrency       | `server-agent-streaming`                                                        |
| 12 Docs                  | last change to land (or its own small change)                                   |
| 13 Git routes            | `server-git-integration`                                                        |
| 14 Compaction route      | `server-session-utils`                                                          |
| 15 Stats route           | `server-session-utils`                                                          |

### Cross-cutting coordination points (handle in `server-rest-api`, the foundation)

1. **`index.ts` is edited by every change.** To keep the three leaves parallelizable without merge conflicts, make `buildServer` accept route modules as an array (auto-composition) in `server-rest-api`, so leaf changes add a route module + one line. Design this into the foundation, not bolted on later.
2. **Test-helper duplication.** Every change recreates `makeApp()` (initDatabase + createContext + `.state`). Make `apps/server/src/__tests__/helpers.ts` a deliverable of `server-rest-api`; the leaves reuse it.
3. **Spec granularity = one spec per change.** `server-rest-api` / `agent-streaming` / `git-integration` / `session-utils`. The capability split mirrors the change split, which is the correct alignment.

### Explicitly NOT a server change (deferred to a separate agent-domain change, v1.5)

**Thinking-level / per-session retry wiring** is an _agent-layer_ capability extension, not a server route. It crosses `packages/agent` (`AgentConfigInput` + `streaming.ts`'s `streamSimple` call) and deserves its own OpenSpec change in the agent domain. The server stores `thinkingLevel` today and the `server-session-utils` compaction route works without it — so it's correctly deferred, not bundled into a server change.
