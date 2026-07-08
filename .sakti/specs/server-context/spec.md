## Purpose

The server context provides shared state to all route handlers and the WebSocket handler. It holds the database connection, repository instances, auth store, profiles store, settings file store, terminal manager, server loggers, and server hooks. Context is injected via Hono middleware and accessed via `getCtx(c)`.

## Requirements

### Requirement: ServerContext interface

The system SHALL define a `ServerContext` interface holding: `db` (DrizzleDB), `repos` (ProjectRepo, SessionRepo, SettingsRepo, TurnRepo), `auth` (AuthStore), `profiles` (ProfilesStore), `settingsFile` (SettingsFileStore), `terminalManager` (TerminalManager), `hooks` (ServerHooks), and optional `log` (ServerLoggers).

#### Scenario: All repos available
- **WHEN** `getCtx(c)` is called in a route handler
- **THEN** `ctx.repos.projects`, `ctx.repos.sessions`, `ctx.repos.settings`, and `ctx.repos.turns` are available

### Requirement: createContext constructs the context

The system SHALL provide `createContext(db, hooks, { auth, profiles, settingsFile, log? })` that constructs a `ServerContext` with initialized repository instances.

#### Scenario: Context creation
- **WHEN** `createContext(db, hooks, { auth, profiles, settingsFile })` is called
- **THEN** a `ServerContext` is returned with all repos initialized from the db

### Requirement: ctxMiddleware injects context

The system SHALL provide `ctxMiddleware(ctx)` that creates a Hono middleware setting `c.var.ctx = ctx`. This middleware is applied to the outer app in `buildApp` before routes are registered.

#### Scenario: Context available in routes
- **WHEN** a route handler calls `getCtx(c)`
- **THEN** the `ServerContext` that was passed to `ctxMiddleware` is returned

#### Scenario: Missing context throws
- **WHEN** `getCtx(c)` is called and no context was injected
- **THEN** an error is thrown with `"ServerContext not injected"`

### Requirement: createSessionStorage builds per-session storage

The system SHALL provide `createSessionStorage(ctx, sessionId)` that constructs a `SqliteSessionStorage` for a specific session, looking up the session metadata from the repo.

#### Scenario: Storage for existing session
- **WHEN** `createSessionStorage(ctx, sessionId)` and the session exists
- **THEN** a `SqliteSessionStorage` is returned with the session's metadata

#### Scenario: Storage for nonexistent session
- **WHEN** `createSessionStorage(ctx, "nonexistent")`
- **THEN** a `SqliteSessionStorage` is returned with a generated createdAt timestamp

### Requirement: Hono factory with typed variables

The system SHALL export a Hono factory from `factory.ts` that creates apps with typed `Variables: { ctx: ServerContext }`. All route modules use this factory.

#### Scenario: Route module uses factory
- **WHEN** a route module creates a sub-app via `factory.createApp()`
- **THEN** the sub-app's context type includes `ctx: ServerContext`

### Requirement: ServerHooks for desktop integration

The system SHALL define `ServerHooks` with optional `onOpenFolderDialog(): Promise<string | null>`. This hook allows the Electron main process to provide a native folder picker.

#### Scenario: Folder dialog hook
- **WHEN** `ctx.hooks.onOpenFolderDialog()` is called and the desktop provides a folder
- **THEN** the folder path is returned
