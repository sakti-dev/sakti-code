## Purpose

REST API server for the sakti-code desktop app. Built on Elysia (Bun), backed by bun:sqlite + Drizzle repos, with compile-time-typed frontend access via Eden treaty.

## Requirements

### Requirement: Server scaffold and composition
The system SHALL provide an `apps/server` Bun workspace package (`@sakti-code/server`) that builds an Elysia application via a `buildServer({ db, routes })` function. `buildServer` SHALL accept an optional `routes` array of Elysia route instances and compose them via `.use()`, so downstream changes can register additional routes without editing the foundation's `index.ts`. When run directly (`import.meta.main`), the server SHALL listen on `SAKTI_PORT` (default 3001) and initialize its database from `SAKTI_DB_PATH` (default `sakti-code.db`).

#### Scenario: buildServer composes default routes
- **WHEN** `buildServer({ db })` is called with no `routes` argument
- **THEN** the resulting app responds to `GET /health`, `/api/projects`, `/api/sessions`, and all other foundation routes
- **AND** no additional routes are registered

#### Scenario: buildServer accepts extra route modules
- **WHEN** `buildServer({ db, routes: [customRoutes] })` is called
- **THEN** the resulting app responds to both the foundation routes and the custom routes
- **AND** the foundation's `index.ts` is not edited to register the custom routes

#### Scenario: server starts on configured port
- **WHEN** the entry point is executed directly with `SAKTI_PORT=4000`
- **THEN** the server listens on port 4000 and logs its URL

### Requirement: ServerContext injection
The system SHALL construct a single `ServerContext` object holding the `DrizzleDB` and instances of the repo classes (`ProjectRepo`, `SessionRepo`, `SettingsRepo`, `ModelConfigRepo`) and inject it into every route via Elysia `.state("ctx", ctx)`. Routes SHALL access repos via `store.ctx.repos.<name>` and SHALL NOT construct repos themselves. Session-scoped reads (messages, stats, export, fork, last-assistant-text) SHALL go through `SqliteSessionStorage` + `buildSessionContext` from `@sakti-code/agent` / `@sakti-code/db`, not through a per-session repo.

#### Scenario: context flows to a route handler
- **WHEN** a route handler reads `store.ctx.repos.projects`
- **THEN** it receives the `ProjectRepo` instance constructed at server startup
- **AND** the same instance is shared across all route handlers in the same server

### Requirement: Health endpoint
The system SHALL expose `GET /health` returning `{ status: "ok", uptime: <number> }` where `uptime` is the process uptime in seconds.

#### Scenario: health probe
- **WHEN** `GET /health` is requested
- **THEN** the response status is 200 and the body is `{ status: "ok", uptime: <number> }`

### Requirement: Projects CRUD
The system SHALL expose REST endpoints over `ProjectRepo`: `GET /api/projects` (list), `GET /api/projects/:id` (one), `POST /api/projects` (create with `{ name, cwd }`), `PUT /api/projects/:id` (partial update of `name`/`cwd`), `DELETE /api/projects/:id`. A request for an unknown project id SHALL return HTTP 404.

#### Scenario: create then list
- **WHEN** `POST /api/projects` with `{ name: "demo", cwd: "/tmp/demo" }` then `GET /api/projects`
- **THEN** the first response contains the created project with a generated `id`
- **AND** the list response contains exactly that project

#### Scenario: unknown project id
- **WHEN** `GET /api/projects/nope`
- **THEN** the response status is 404

### Requirement: Sessions CRUD with entry-tree message history
The system SHALL expose REST endpoints over `SessionRepo`: `GET /api/sessions?projectId=<id>` (list by project), `GET /api/sessions/:id` (one), `POST /api/sessions` (create with `{ projectId, modelId, title? }`), `PATCH /api/sessions/:id` (update `title`/`modelId`/`thinkingLevel`). Message history SHALL be readable via `GET /api/sessions/:id/messages` returning the session's messages projected from its entry tree (via `SqliteSessionStorage.getPathToRoot` + `buildSessionContext`) in chronological order; there SHALL be no standalone `/api/messages` route because messages belong to the Session aggregate. Unknown session ids SHALL return HTTP 404.

#### Scenario: create session under a project and list it
- **WHEN** `POST /api/sessions` with `{ projectId, modelId: "gpt-4o" }` then `GET /api/sessions?projectId=<id>`
- **THEN** the list contains exactly the created session

#### Scenario: message history is empty for a new session
- **WHEN** `GET /api/sessions/<new-id>/messages`
- **THEN** the response status is 200 and the body is `[]`

### Requirement: Settings key/value store
The system SHALL expose endpoints over `SettingsRepo`: `GET /api/settings` (all), `GET /api/settings/:key` (one, 404 if missing), `PUT /api/settings/:key` with `{ value }`.

#### Scenario: put then get round-trips
- **WHEN** `PUT /api/settings/theme` with `{ value: "dark" }` then `GET /api/settings/theme`
- **THEN** the PUT returns 204 and the GET returns `"dark"`

#### Scenario: unknown key
- **WHEN** `GET /api/settings/nonexistent`
- **THEN** the response status is 404

### Requirement: DB-backed model configs
The system SHALL expose endpoints over `ModelConfigRepo`: `GET /api/model-configs/global`, `GET /api/model-configs/projects/:projectId`, `POST /api/model-configs` (with `{ provider, modelId, thinkingLevel?, projectId? }`). The schema stores only `provider`, `modelId`, `thinkingLevel`, and optional `projectId` — it SHALL NOT store API keys.

#### Scenario: set then read project config
- **WHEN** `POST /api/model-configs` with `{ provider: "openai", modelId: "gpt-4o", projectId }` then `GET /api/model-configs/projects/<id>`
- **THEN** the read returns the stored config without an `apiKey` field

### Requirement: Available-models registry
The system SHALL expose `GET /api/available-models` returning the list of providers (via pi-ai `getProviders()`) and `GET /api/available-models/:provider` returning the models for that provider (via `getModels()`). This endpoint reads from the pi-ai static registry, not the DB.

#### Scenario: list providers
- **WHEN** `GET /api/available-models`
- **THEN** the response is an array of provider names

#### Scenario: list models for a provider
- **WHEN** `GET /api/available-models/openai`
- **THEN** the response is an array of model objects for that provider

### Requirement: Eden treaty client
The system SHALL export an Eden `treaty` client (`apps/app/src/lib/api.ts`) parameterized on the `buildServer` app type, giving the SolidJS frontend compile-time-typed access to every REST route (params, body, response inferred — no codegen step, no separate contracts package).

#### Scenario: client types reflect a route
- **WHEN** the frontend calls `api.api.projects.get()`
- **THEN** the return type is inferred from the `GET /api/projects` route's response type
- **AND** a rename of that route produces a compile error at the call site

### Requirement: Shared test helper
The system SHALL provide `apps/server/src/__tests__/helpers.ts` exporting a `makeApp(routes?)` helper that constructs an in-memory database (`new Database(":memory:")`), wraps it with `initDatabase`, builds a `ServerContext`, and applies `.state("ctx", ctx)`. Downstream changes SHALL reuse this helper instead of re-deriving the wiring.

#### Scenario: helper produces a working app
- **WHEN** `makeApp()` is called with no arguments
- **THEN** the returned app's `GET /health` responds with `{ status: "ok", ... }`
- **AND** the underlying database is in-memory (no file written)
