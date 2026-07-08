## Purpose

The database schema defines all tables using Drizzle ORM with `node:sqlite`. Tables use UUID text primary keys, integer Unix timestamps (epoch ms), and are initialized with WAL mode and foreign key enforcement via migrations.

## Requirements

### Requirement: Schema defines projects table

The system SHALL define a `projects` table with columns: `id` (text, primary key, UUID), `name` (text, not null), `cwd` (text, not null, unique), `createdAt` (integer, not null), `updatedAt` (integer, not null).

#### Scenario: Create a new project
- **WHEN** a project is inserted with a unique `cwd`
- **THEN** the row is created with an auto-generated UUID `id` and current timestamp

#### Scenario: Duplicate cwd rejected
- **WHEN** a project is inserted with a `cwd` that already exists
- **THEN** a unique constraint violation occurs

### Requirement: Schema defines sessions table

The system SHALL define a `sessions` table with columns: `id` (text, primary key, UUID), `projectId` (text, FK to `projects.id`, not null), `parentSessionId` (text, FK to `sessions.id`, nullable), `title` (text, nullable), `modelId` (text, nullable), `profileId` (text, nullable — references a profile in `profiles.json`, not a DB FK), `kind` (text, not null, default `"mission"`), `status` (text, not null, default `"specify"`), `changeName` (text, nullable — links mission to SDD change), `worktreePath` (text, nullable — isolated git worktree), `pendingTransitionTo` (text, nullable), `pendingTransitionBody` (text, nullable), `thinkingLevel` (text, not null, default `"off"`), `leafId` (text, nullable — current leaf entry), `createdAt` (integer, not null), `updatedAt` (integer, not null).

#### Scenario: Create a session
- **WHEN** a session is inserted with a valid `projectId`
- **THEN** the row is created with `kind: "mission"`, `status: "specify"`, `thinkingLevel: "off"`, and current timestamp

#### Scenario: Create session with parent
- **WHEN** a session is inserted with a valid `parentSessionId`
- **THEN** the row is linked to the parent session

#### Scenario: ModelId is nullable
- **WHEN** a session is inserted without a `modelId`
- **THEN** the column is null

### Requirement: Schema defines session_entries table (session tree)

The system SHALL define a `session_entries` table with columns: `id` (text, primary key, UUID), `sessionId` (text, FK to `sessions.id` with cascade delete, not null), `parentId` (text, nullable — parent entry in the tree), `sequence` (integer, not null, unique per session), `kind` (text, not null — entry type like `"message"`, `"label"`, `"leaf"`), `content` (text, not null — JSON-encoded `SessionTreeEntry`), `timestamp` (text, not null), `createdAt` (integer, not null), `turnId` (text, nullable, FK to `turns.id` with cascade delete), `isTurnSummary` (integer, boolean, not null, default false).

Indexes: unique on `(sessionId, sequence)`, index on `(sessionId, kind)`, index on `turnId`, unique on `(turnId)` where `isTurnSummary = 1`.

#### Scenario: Insert a session entry
- **WHEN** a session entry is inserted
- **THEN** the `sequence` auto-increments within the session

#### Scenario: Session entries are deleted with session
- **WHEN** a session with entries is deleted
- **THEN** all its entries are cascade-deleted

### Requirement: Schema defines turns table

The system SHALL define a `turns` table with columns: `id` (text, primary key, UUID), `sessionId` (text, FK to `sessions.id` with cascade delete, not null), `sequence` (integer, not null), `startedAt` (integer, not null), `endedAt` (integer, nullable), `createdAt` (integer, not null). Unique index on `(sessionId, sequence)`.

#### Scenario: Record a turn
- **WHEN** a turn is inserted for a session
- **THEN** the sequence increments from the last turn

### Requirement: Schema defines settings table

The system SHALL define a `settings` table with columns: `key` (text, primary key), `value` (text, not null), `updatedAt` (integer, not null). Used for per-session runtime overrides (key convention `session:{sessionId}:{settingName}`).

#### Scenario: Upsert a setting
- **WHEN** a setting is upserted with a key and value
- **THEN** the value is updated or the row is created

### Requirement: Schema defines observational_memory table

The system SHALL define an `observational_memory` table with columns for Observational Memory (OM) state: `id` (text, primary key, UUID), `lookupKey` (text, not null, indexed), `scope` (text, not null — `"thread"` or `"resource"`), `resourceId` (text, FK to `projects.id` with cascade delete), `threadId` (text, FK to `sessions.id` with cascade delete), plus OM content fields (`activeObservations`, `bufferedObservationChunks`, `bufferedReflection`, etc.), generation tracking (`originType`, `generationCount`, `config`), token accounting, state flags (`isObserving`, `isReflecting`, etc.), cursors, and timestamps.

Index: on `lookupKey` for efficient lookup by `thread:{sessionId}` or `resource:{projectId}`.

#### Scenario: Record OM generation
- **WHEN** an OM record is inserted with a unique `lookupKey`
- **THEN** the row is persisted with all generation metadata

### Requirement: Database is initialized with WAL mode and migrations

The system SHALL initialize a `node:sqlite` `DatabaseSync` with PRAGMA `journal_mode = WAL` and `foreign_keys = ON`, then run Drizzle migrations.

#### Scenario: Initialize database
- **WHEN** `initDatabase(sqlite)` is called on a new database
- **THEN** WAL mode is enabled, foreign keys are enforced, and all table definitions are applied via migration

### Requirement: Schema file exports all table definitions

The system SHALL export all table definitions from a single `schema.ts` file.

#### Scenario: Schema exports all tables
- **WHEN** the schema module is imported
- **THEN** it exports `projects`, `sessions`, `settings`, `sessionEntries`, `turns`, `observationalMemory`
