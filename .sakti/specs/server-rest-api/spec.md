## Purpose

The Hono REST server exposes CRUD endpoints for projects, sessions, settings, profiles, models, git operations, workspace management, and terminal access. Routes are organized as Hono sub-apps with `basePath()`, composed via chained `.route()` in `buildApp(ctx)`. Context is injected via `ctxMiddleware` and accessed via `getCtx(c)`. Validation uses `@hono/typebox-validator`.

## Requirements

### Requirement: Server scaffold via buildApp

The system SHALL provide `buildApp(ctx: ServerContext)` that composes all REST route modules under `/api` and the WebSocket route under `/ws`. Each route module is a Hono sub-app created via `factory.createApp()` with `.basePath()`. The outer app applies `ctxMiddleware` to inject `ServerContext` into `c.var.ctx`.

#### Scenario: REST routes under /api
- **WHEN** `buildApp(ctx)` is called
- **THEN** all REST routes are accessible under `/api` (e.g. `GET /api/health`, `GET /api/projects`)

#### Scenario: WS route at /ws
- **WHEN** `buildApp(ctx)` is called
- **THEN** the WebSocket endpoint is available at `/ws`

### Requirement: Server startup via createServer

The system SHALL provide `createServer(options?)` that initializes the SQLite database, auth store, profiles store, settings file store, server loggers, terminal manager, and context; builds the Hono app; optionally serves static files with SPA fallback; and starts the `@hono/node-server` with WebSocket upgrade support. Port defaults to `SAKTI_PORT` (3001), hostname to `SAKTI_HOST` (localhost).

#### Scenario: Server starts on default port
- **WHEN** `createServer()` is called with no options
- **THEN** the server listens on port 3001

#### Scenario: Server starts on custom port
- **WHEN** `createServer({ port: 4000 })` is called
- **THEN** the server listens on port 4000

#### Scenario: Static file serving with SPA fallback
- **WHEN** `createServer({ staticDir: "/dist" })` is called
- **THEN** `/*` serves static files from `/dist` and unknown routes serve `index.html`

### Requirement: Health endpoint

The system SHALL expose `GET /api/health` returning `{ status: "ok", uptime: <number> }`.

#### Scenario: Health probe
- **WHEN** `GET /api/health` is requested
- **THEN** the response is `{ status: "ok", uptime: <seconds> }`

### Requirement: Projects CRUD

The system SHALL expose `GET /api/projects` (list), `GET /api/projects/:id` (one), `POST /api/projects` (create with `{ name, cwd }`), `PUT /api/projects/:id` (partial update), `DELETE /api/projects/:id`. Unknown IDs return 404.

#### Scenario: Create and list
- **WHEN** `POST /api/projects { name, cwd }` then `GET /api/projects`
- **THEN** the list contains the created project

#### Scenario: Unknown project
- **WHEN** `GET /api/projects/nonexistent`
- **THEN** the response is 404

### Requirement: Sessions CRUD with tree-backed history

The system SHALL expose `GET /api/sessions?projectId=<id>` (list by project), `GET /api/sessions/:id` (one), `POST /api/sessions` (create with projectId, optional kind/title/profileId/changeName/worktreePath/parentSessionId), `PATCH /api/sessions/:id` (update title/profileId etc.). Session messages are accessible via the context endpoint using tree-backed `SqliteSessionStorage`. Unknown IDs return 404.

#### Scenario: Create session with all options
- **WHEN** `POST /api/sessions { projectId, kind: "mission", changeName: "feat-x" }`
- **THEN** the session is created with those fields set

#### Scenario: List by project
- **WHEN** `GET /api/sessions?projectId=<id>`
- **THEN** only sessions for that project are returned

### Requirement: Session context endpoint

The system SHALL expose `GET /api/sessions/:id/context` returning the session's message context built from its entry tree via `buildSessionContextFromEntries`.

#### Scenario: Context for empty session
- **WHEN** `GET /api/sessions/<new-id>/context`
- **THEN** the response contains empty messages array

### Requirement: Settings, profiles, and model endpoints

The system SHALL expose `GET/PUT /api/settings` (global file-backed settings), `GET/PUT /api/profiles` (model profiles from profiles.json), `GET /api/available-models` and `GET /api/available-models/:provider` (catalog), and `GET /api/connected-models` (configured providers).

#### Scenario: Settings round-trip
- **WHEN** `PUT /api/settings { key: value }` then `GET /api/settings`
- **THEN** the updated settings are returned

#### Scenario: Profiles round-trip
- **WHEN** `GET /api/profiles`
- **THEN** the parsed profiles.json content is returned

### Requirement: Session utility endpoints

The system SHALL expose session utilities: `GET /api/sessions/:id/stats`, `POST /api/sessions/:id/fork`, `GET /api/sessions/:id/export`, `GET /api/sessions/:id/last-assistant-text`, `GET /api/sessions/:id/edit-mode`, `GET /api/sessions/:id/turns`, and `GET/DELETE /api/sessions/:id/skills`.

#### Scenario: Fork a session
- **WHEN** `POST /api/sessions/:id/fork`
- **THEN** a new session is created branching from the specified entry

### Requirement: Route validation via TypeBox

Route handlers SHALL use `tbValidator("json", schema)` from `@hono/typebox-validator` for request body validation. Invalid bodies return 400.

#### Scenario: Invalid request body
- **WHEN** a POST endpoint receives a body that fails TypeBox validation
- **THEN** the response is 400
