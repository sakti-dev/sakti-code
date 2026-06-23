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
The system SHALL expose endpoints for **global** application settings, file-backed by `settings.json` (see `app-config-files`): `GET /api/settings` (returns the parsed global settings object), `PUT /api/settings` (accepts a JSON body, deep-merged into `settings.json`, validated, atomic write). These endpoints SHALL NOT touch the `settings` DB table. Per-session runtime settings SHALL remain DB-backed and are exposed via the unchanged `GET`/`PATCH /api/sessions/:id/settings` routes (see `per-session-settings`).

#### Scenario: put then get round-trips via file
- **WHEN** `PUT /api/settings` with `{ "theme": "dark" }` then `GET /api/settings`
- **THEN** the PUT returns 204, `settings.json` contains `theme: "dark"`, and the GET returns it

#### Scenario: invalid body is rejected
- **WHEN** `PUT /api/settings` with a body that fails validation
- **THEN** the response is 400 and `settings.json` is unchanged

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

### Requirement: Profiles REST surface
The system SHALL expose `GET /api/profiles` returning the parsed, schema-validated contents of `profiles.json`, and `PUT /api/profiles` replacing the whole file atomically after validation. A `PUT` whose body is malformed JSON or violates the profiles schema SHALL return HTTP 400 and SHALL NOT modify the existing file. These routes SHALL be registered through the server's route-composition pattern and SHALL NOT edit the server foundation file directly.

#### Scenario: get returns parsed profiles
- **WHEN** `GET /api/profiles` is called
- **THEN** the response is the parsed JSON object from `profiles.json`

#### Scenario: put replaces the file
- **WHEN** `PUT /api/profiles` is called with a schema-valid body
- **THEN** the response is 204 and a subsequent `GET /api/profiles` returns the new content

#### Scenario: put with invalid body is rejected
- **WHEN** `PUT /api/profiles` is called with a body missing `defaultProfile`
- **THEN** the response is 400 and the existing `profiles.json` is unchanged

### Requirement: Auth REST surface
The system SHALL expose `GET /api/auth` returning a masked list of provider credentials (one entry per known provider: `{ provider, envVar, hasKey, maskedKey }`), `POST /api/auth/:provider` with body `{ key }` to set a provider's key, and `DELETE /api/auth/:provider` to remove it. `maskedKey` SHALL be the last four characters of the key prefixed by `...`, or null when no key is set. No response SHALL include a full API key. Setting an unknown provider or an empty/whitespace key SHALL return HTTP 400 and SHALL NOT modify `auth.json`. Writes SHALL set/clear the matching `process.env` variable.

#### Scenario: masked list
- **WHEN** `GET /api/auth` is called
- **THEN** the response is an array of `{ provider, envVar, hasKey, maskedKey }` entries with no full keys

#### Scenario: set then delete
- **WHEN** `POST /api/auth/openai` `{ key: "sk-test-1234567890abcdef" }` then `DELETE /api/auth/openai`
- **THEN** the POST returns 204 and sets `process.env.OPENAI_API_KEY`, the DELETE returns 204 and clears it, and a following `GET /api/auth` shows `hasKey: false` for openai

#### Scenario: unknown provider rejected
- **WHEN** `POST /api/auth/bogus` `{ key: "x" }`
- **THEN** the response is 400 and `auth.json` is unchanged

#### Scenario: empty key rejected
- **WHEN** `POST /api/auth/openai` `{ key: "   " }`
- **THEN** the response is 400 and `auth.json` is unchanged
