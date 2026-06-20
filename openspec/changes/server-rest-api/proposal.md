## Why

sakti-code has working agent/db/tools packages but no way to expose them to the frontend. The SolidJS app needs a typed HTTP API over the existing repos so it can list projects, manage sessions, read message history, configure models, and track costs. This change builds that foundation: an Elysia server with typed REST routes injected through a single `ServerContext`, plus the Eden treaty client that gives the frontend zero-codegen type safety. It is the prerequisite for every subsequent server change (agent streaming, git, session-utils), so it must also establish the integration patterns those changes build on.

## What Changes

- Create `apps/server` — a new Bun workspace package (`@sakti-code/server`) running an Elysia HTTP server.
- Introduce `ServerContext` — a single object (`{ db, repos }`) injected into every route via Elysia `.state()`. Repos are the existing `@sakti-code/db` classes; there is no service layer wrapping them (repos *are* the service layer).
- Add REST routes (one file per resource, flat under `routes/`):
  - `health` — `GET /health` (uptime probe)
  - `projects` — CRUD over `ProjectRepo` (`/api/projects`)
  - `sessions` — CRUD over `SessionRepo` + message history (`/api/sessions`, `/api/sessions/:id/messages`). Messages live under sessions because they have no existence outside a session (Session aggregate).
  - `settings` — key/value over `SettingsRepo` (`/api/settings`)
  - `models` — DB-backed model-config CRUD over `ModelConfigRepo` (`/api/model-configs`)
  - `costs` — read-only cost aggregation over `CostRepo` (`/api/costs/projects/:id`, `/api/costs/sessions/:id`)
  - `available-models` — pi-ai registry listing via `getProviders()` / `getModels()` (`/api/available-models`)
- Wire all routes in `buildServer({ db })` — the composable entry point. **Route modules are passed as an array so leaf changes can add routes with one line** (avoids `index.ts` merge conflicts when agent-streaming/git/session-utils land in parallel).
- Create `apps/app/src/lib/api.ts` — the Eden treaty client. The SolidJS app imports it for fully-typed access to every REST route (params, body, response all inferred from the Elysia app type — no codegen, no contracts package).
- Create `apps/server/src/__tests__/helpers.ts` — shared `makeApp()` test helper (`initDatabase(":memory:")` + `createContext` + `.state()`). Leaf changes reuse it to avoid re-deriving the wiring in every test.
- Update root config: add `apps/*/src` to `tsconfig.json` include, `apps/**/__tests__/**` to `vitest.config.ts` include, and a `dev:server` script to root `package.json`.

## Capabilities

### New Capabilities
- `server-rest-api`: The typed REST API surface of `apps/server` — `ServerContext` injection, all CRUD routes (projects, sessions+messages, settings, model-configs, costs), the available-models registry endpoint, the composable `buildServer` entry point, the Eden treaty client, and the shared test helper. This is the foundation the three leaf changes (agent-streaming, git-integration, session-utils) build on.

### Modified Capabilities
<!-- None. This is a brand-new capability that consumes the existing agent-core-packages capabilities (database-repos, database-schema) without changing their requirements. -->

## Impact

- **New code**: `apps/server/` package (route files, `context.ts`, `index.ts`, tests, helper). `apps/app/src/lib/api.ts`. Root config edits.
- **Dependencies**: adds `elysia` + `@elysiajs/eden` to `apps/server` (and eden to `apps/app`). All other deps (`@sakti-code/agent|db|tools`, `@earendil-works/pi-ai`) are already in the workspace.
- **Consumes but does not modify**: `packages/db` (all 6 repo classes, `initDatabase`, `SqliteSessionStore`), `packages/agent` (types only — `AnyModel` for the available-models typing), `packages/tools` (not touched in this change; used by agent-streaming later).
- **Runtime**: server listens on port 3001 (`SAKTI_PORT`), DB at `sakti.db` (`SAKTI_DB_PATH`). API keys are NOT managed here — they come from env (pi-ai reads `OPENAI_API_KEY` etc.); the DB stores only provider+modelId+thinkingLevel.
- **No breaking changes** — net-new package, existing packages untouched.
