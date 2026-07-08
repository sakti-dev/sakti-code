## Purpose

Repository classes provide typed data access over the database schema. Each repo encapsulates queries for one domain (projects, sessions, settings, turns) and accepts a shared `DrizzleDB` instance.

## Requirements

### Requirement: ProjectRepo manages project CRUD

`ProjectRepo` SHALL provide methods: `create(name, cwd)`, `findById(id)`, `findByCwd(cwd)`, `list()`, `update(id, data)`, `delete(id)`. IDs are generated as UUIDs.

#### Scenario: Create and retrieve a project
- **WHEN** `create("my-app", "/home/user/my-app")` is called
- **THEN** a project is created with a UUID, the given name and cwd, and current timestamps

#### Scenario: Find project by cwd
- **WHEN** `findByCwd("/home/user/my-app")` is called
- **THEN** the matching project is returned or null if not found

#### Scenario: List all projects
- **WHEN** `list()` is called
- **THEN** all projects are returned ordered by `createdAt` descending

### Requirement: SessionRepo manages session CRUD

`SessionRepo` SHALL provide methods: `create(projectId, options?)`, `findById(id)`, `listByProject(projectId)`, `listChildPlansByProject(projectId)`, `findForkedChildren(parentId)`, `update(id, data)`, `delete(id)`.

#### Scenario: Create a session
- **WHEN** `create("proj-1", { modelId: "claude-sonnet-4-20250514" })` is called
- **THEN** a session is created linked to the project with default `kind: "mission"` and `status: "specify"`

#### Scenario: Create session with kind plan
- **WHEN** `create("proj-1", { kind: "plan" })` is called
- **THEN** a session with kind "plan" is created

#### Scenario: List sessions for a project
- **WHEN** `listByProject("proj-1")` is called
- **THEN** all sessions for the project are returned ordered by `createdAt` descending

#### Scenario: Find forked children
- **WHEN** `findForkedChildren("sess-1")` is called
- **THEN** all sessions with `parentSessionId = "sess-1"` are returned

### Requirement: TurnRepo manages turn lifecycle

`TurnRepo` SHALL provide methods: `create(sessionId, startedAt)`, `finalize(id, endedAt)`, `finalizeLatest(sessionId, endedAt)`, `listBySession(sessionId)`, `getLatest(sessionId)`, `markSummary(turnId)`.

#### Scenario: Create and finalize a turn
- **WHEN** `create("sess-1", 1000)` and then `finalize(id, 2000)` are called
- **THEN** a turn is created with null `endedAt`, then updated with the end time

#### Scenario: Finalize latest open turn
- **WHEN** `finalizeLatest("sess-1", 3000)` is called
- **THEN** the latest turn with null `endedAt` is finalized

#### Scenario: List turns in sequence order
- **WHEN** `listBySession("sess-1")` is called
- **THEN** all turns are returned ordered by sequence ascending

#### Scenario: Mark turn summary flags the last assistant entry
- **WHEN** `markSummary(turnId)` is called on a turn with an assistant message
- **THEN** the last assistant entry in that turn has `isTurnSummary: true`

### Requirement: SettingsRepo manages key-value settings

`SettingsRepo` SHALL provide methods: `get(key)`, `set(key, value)`, `getByPrefix(prefix)`, `getAll()`, `delete(key)`.

#### Scenario: Set and get a setting
- **WHEN** `set("session:sess_1:auto_compaction", "true")` is called, then `get("session:sess_1:auto_compaction")`
- **THEN** `"true"` is returned

#### Scenario: Get nonexistent setting
- **WHEN** `get("session:sess_1:nope")` is called
- **THEN** null is returned

#### Scenario: Get all by prefix
- **WHEN** `getByPrefix("session:sess_1:")` is called after storing two settings with that prefix
- **THEN** both settings are returned

#### Scenario: Delete a setting
- **WHEN** `delete("session:sess_1:setting")` is called
- **THEN** the setting row is removed

### Requirement: All repos accept a Drizzle database instance

Each repo SHALL be constructed with a `DrizzleDB` instance. Repos are stateless.

#### Scenario: Create repos with shared database
- **WHEN** multiple repos are created with the same database instance
- **THEN** they share the same connection
