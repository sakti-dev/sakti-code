## Context

sakti-code's agent/db/tools packages are built and tested (107 tests passing) but have no HTTP surface. The SolidJS frontend needs a typed API to read and mutate state. This change establishes `apps/server` as that surface and — critically — lays down the integration patterns that three subsequent changes (`server-agent-streaming`, `server-git-integration`, `server-session-utils`) will build on top of.

The existing `packages/db` already contains: 6 repo classes, `initDatabase(sqlite: Database)` (takes a `bun:sqlite` instance, enables WAL internally), `SqliteSessionStore`, and the Drizzle schema. The existing `packages/agent` exposes types only here (`AnyModel` for the available-models endpoint). `@earendil-works/pi-ai` provides `getProviders()` / `getModels(provider)` for the registry endpoint and will later provide `getModel(provider, modelId)` + `streamSimple` for streaming (not this change).

Constraints carried over from the codebase: `exactOptionalPropertyTypes: true` is on (use conditional spread), TS 6.0.3, Bun 1.3.14, Elysia `^1.4.28` + `@elysiajs/eden` `^1.4.9`. API keys are read from env by pi-ai — the DB stores only provider+modelId+thinkingLevel, never keys.

## Goals / Non-Goals

**Goals:**
- A runnable Elysia server exposing typed REST CRUD over all 6 repos.
- `ServerContext` injection so routes never construct repos themselves.
- Eden treaty client giving the SolidJS app compile-time-typed access (no codegen, no contracts package).
- A `buildServer` composition point that leaf changes can extend **without editing `index.ts`** (the dominant coordination risk across the 4 changes).
- A shared `__tests__/helpers.ts` so leaf changes don't re-derive test wiring.

**Non-Goals:**
- WebSocket / agent streaming — that's `server-agent-streaming`. This change is HTTP-only.
- Git routes, compaction route, stats route — leaf changes.
- Agent loop execution, model resolution per-prompt, the `agent/` folder — all in `server-agent-streaming`.
- Wiring `thinkingLevel` through to `streamSimple` — separate agent-domain change (v1.5).
- API key storage/encryption — keys come from env (schema has no `apiKey` column).
- Authentication / authorization / CORS — desktop app talks to localhost; defer.

## Decisions

### 1. REST for state, not WebSocket
**Decision:** All CRUD goes over HTTP. **Alternative considered:** PiBun's model puts ~51 methods over one WebSocket (a hand-rolled JSON-RPC layer). **Rejected:** request/response semantics are exactly what HTTP does; reinventing them over a socket adds a dispatch layer without value. The only thing that genuinely needs streaming is the agent loop (token deltas, tool updates) — that's the WS surface, scoped to `server-agent-streaming`. This keeps the WS protocol tiny (prompt/abort in, event out) instead of PiBun's 51 methods.

### 2. Repos ARE the service layer
**Decision:** Routes call repo methods directly through the injected `ServerContext`. **Alternative:** a `ProjectService` wrapping `ProjectRepo`, etc. **Rejected:** the repos already are the service layer (typed queries, invariants like "throw if not found after write"). A wrapping layer duplicates signatures and adds indirection without adding behavior. If business rules emerge that don't belong in a repo, add a thin helper — but don't pre-build empty wrappers.

### 3. `ServerContext` via Elysia `.state()`, not a DI container
**Decision:** `new Elysia().state("ctx", createContext(db))` — every route reads `store.ctx`. Full type inference from Elysia; no framework-specific container. The context is one object constructed once at startup. **Alternative:** constructor injection / a custom plugin. **Rejected:** `.state()` is the idiomatic Elysia pattern and gives the type inference for free.

### 4. `buildServer` accepts route modules as an array (composition over wiring)
**Decision:** `buildServer({ db, routes })` takes an array of Elysia route instances and folds them with `.use()`. The foundation supplies the default routes; leaf changes append theirs. **Alternative:** each change edits `index.ts` to add one `.use(xRoutes)` line. **Rejected for the merge-conflict reason:** three leaf changes all touching the same `index.ts` `.use()` chain in parallel worktrees is the dominant coordination failure mode. Array composition means a leaf adds `gitRoutes` to the array in *its own* file and never touches the foundation's `index.ts`. **Trade-off:** the array composition is a tiny abstraction (5-line helper) that only earns its keep because we already know 3 more changes are coming — it would be over-engineering for a one-off server.

### 5. Shared `__tests__/helpers.ts`
**Decision:** Ship `makeApp(routes?)` (in-memory DB + context + `.state()`) as part of this change. Leaf changes import it. **Alternative:** each test recreates the 3-line setup. **Rejected:** trivial duplication today, inconsistency tomorrow (different overrides, different teardown). One helper, one pattern.

### 6. Eden treaty import path
**Decision:** Use `import { treaty } from "@elysiajs/eden"` first; if the installed version only resolves `@elysia/eden` subpath, switch. **Rationale:** the npm package is `@elysiajs/eden`; docs reference both paths across versions. The TDD test (in agent-streaming's e2e, or a trivial client smoke test here) will fail loudly if the import is wrong. No codegen step — Eden derives client types from the Elysia app's type, which is the entire reason for choosing Elysia over bare `Bun.serve`.

### 7. No `lib/` directory
**Decision:** `context.ts` lives flat at `src/` root. There is no `lib/`. **Rationale:** `ServerContext` is the DI root used by every route via injection — it is not a reusable library. A one-file directory is a code smell. If genuinely-shared helpers (used by 3+ unrelated modules) emerge later, add them flat and promote only when there are several.

### 8. Route structure: flat `routes/`, no per-domain folders
**Decision:** All route files flat under `routes/`. The `agent/` folder (in `server-agent-streaming`) is the *only* promoted folder because its 4 files are mutually dependent. **Rationale:** these routes are thin transport adapters that rhyme — a folder per resource would be ceremony. (See the plan's structure section for the full reasoning.)

## Risks / Trade-offs

- **[Elysia version drift]** `ws.data.store.ctx` access, `.state()` typing, and `import.meta.main` semantics are version-sensitive. → **Mitigation:** every route has a TDD test that calls `app.handle(new Request(...))` through the real stack; any API mismatch surfaces as a test failure. The uncertain accessors are called out with notes in the plan.
- **[Eden import path]** `@elysia/eden` vs `@elysiajs/eden` differs across versions. → **Mitigation:** try the package-name import first; a trivial client smoke test catches the wrong path.
- **[Array composition is an early abstraction]** If leaf changes end up serializing rather than parallelizing, the array pattern is slightly more indirection than a plain `.use()` chain. → **Acceptable:** the cost is ~5 lines; the conflict-avoidance benefit is real even with serialization.
- **[No auth]** localhost-only is the assumption. → **Mitigation:** desktop binds to `localhost`; if the server is ever exposed, add auth before that. Out of scope here.
- **[Session aggregate couples message routes to sessions]** There's no standalone `/api/messages` route — you must go through `/api/sessions/:id/messages`. → **Intentional:** messages have no existence outside a session; the coupling reflects the domain. If a cross-session message query is ever needed, add it then.
