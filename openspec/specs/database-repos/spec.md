## Purpose

Repository classes provide typed data access over the database schema. Each repo encapsulates queries for one domain (projects, sessions, messages, costs, settings, model configs) and accepts a shared `DrizzleDB` instance.

## Requirements

### Requirement: ProjectRepo manages project CRUD
`ProjectRepo` SHALL provide methods: `create(name, cwd)`, `findById(id)`, `findByCwd(cwd)`, `list()`, `update(id, data)`, `delete(id)`. All methods SHALL return typed objects.

#### Scenario: Create and retrieve a project
- **WHEN** `create("my-app", "/home/user/my-app")` is called
- **THEN** a project is created with a unique ID, the given name and cwd, and current timestamps, and the project object is returned

#### Scenario: Find project by cwd
- **WHEN** `findByCwd("/home/user/my-app")` is called
- **THEN** the matching project is returned or null if not found

#### Scenario: List all projects
- **WHEN** `list()` is called
- **THEN** all projects are returned ordered by `createdAt` descending

### Requirement: SessionRepo manages session CRUD
`SessionRepo` SHALL provide methods: `create(projectId, modelId, options?)`, `findById(id)`, `listByProject(projectId)`, `update(id, data)`, `delete(id)`.

#### Scenario: Create a session for a project
- **WHEN** `create("proj-1", "claude-sonnet-4-20250514")` is called
- **THEN** a session is created linked to the project with the given model

#### Scenario: List sessions for a project
- **WHEN** `listByProject("proj-1")` is called
- **THEN** all sessions for the project are returned ordered by `createdAt` descending

### Requirement: MessageRepo provides message queries
`MessageRepo` SHALL provide methods: `append(sessionId, message)`, `loadBySession(sessionId)`, `replaceForSession(sessionId, messages)`, `countBySession(sessionId)`.

#### Scenario: Append and load messages
- **WHEN** 3 messages are appended to a session and then `loadBySession()` is called
- **THEN** all 3 messages are returned in chronological order

#### Scenario: Replace messages atomically
- **WHEN** `replaceForSession(sessionId, newMessages)` is called
- **THEN** all existing messages for the session are deleted and the new messages are inserted within a transaction

#### Scenario: Count messages
- **WHEN** `countBySession(sessionId)` is called on a session with 10 messages
- **THEN** 10 is returned

### Requirement: CostRepo records and aggregates costs
`CostRepo` SHALL provide methods: `record(sessionId, projectId, usage, modelId)` and `aggregateByProject(projectId)`, `aggregateBySession(sessionId)`.

#### Scenario: Record LLM cost
- **WHEN** `record("sess-1", "proj-1", { inputTokens: 100, outputTokens: 50, costUsd: 0.002 }, "claude-sonnet-4-20250514")` is called
- **THEN** the cost row is persisted

#### Scenario: Aggregate project costs
- **WHEN** `aggregateByProject("proj-1")` is called
- **THEN** total input tokens, output tokens, and cost across all sessions are returned

### Requirement: SettingsRepo manages key-value settings
`SettingsRepo` SHALL provide methods scoped to per-session runtime overrides: `get(key)`, `set(key, value)`, `getAll()`, and `getByPrefix(prefix)`. It SHALL be used ONLY for keys matching the `session:{sessionId}:{settingName}` convention. Global application settings SHALL NOT pass through `SettingsRepo`; they are read and written via the file-backed settings store (see `app-config-files`).

#### Scenario: Set and get a per-session setting
- **WHEN** `set("session:sess_1:auto_compaction", "true")` is called, then `get("session:sess_1:auto_compaction")` is called
- **THEN** `"true"` is returned

#### Scenario: Get nonexistent setting
- **WHEN** `get("session:sess_1:nope")` is called
- **THEN** null is returned

#### Scenario: Global settings do not use SettingsRepo
- **WHEN** a global preference such as theme is read or written
- **THEN** the operation goes through the file-backed settings store, not `SettingsRepo`

### Requirement: All repos accept a Drizzle database instance
Each repo SHALL be constructed with a `DrizzleDatabase` instance. Repos are stateless — they don't own the connection.

#### Scenario: Create repos with shared database
- **WHEN** multiple repos are created with the same database instance
- **THEN** they share the same transaction context when called sequentially
