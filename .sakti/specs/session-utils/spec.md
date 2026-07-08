## Purpose

Session utility routes provide session-level operations beyond the core CRUD: manual compaction (LLM-backed history summarization) and session statistics (read-only projection). Both are additive route modules that compose into the Elysia server via `buildServer`'s array composition.

## Requirements

### Requirement: Agent package exports compaction utilities
The `@sakti-code/agent` package SHALL re-export `prepareCompaction`, `compact`, `DEFAULT_COMPACTION_SETTINGS`, and related types (`CompactionPreparation`, `CompactionResult`, `CompactionSettings`) from its public barrel so server-layer code can import them through the package boundary (not a deep internal path). This is an additive re-export with no behavior change to existing agent functionality.

#### Scenario: compaction utilities importable from the package
- **WHEN** server code does `import { prepareCompaction, compact } from "@sakti-code/agent"`
- **THEN** the import resolves to the functions defined in `packages/agent/src/compaction.ts`
- **AND** the existing agent test suite still passes unchanged

### Requirement: Manual compaction route
The system SHALL expose `POST /api/sessions/:id/compact` that loads the session's entries via `SqliteSessionStorage`, resolves the session's configured model (reusing `resolveModel` from `server-agent-streaming`), resolves the model provider's API key from the environment, runs `prepareCompaction` + `compact` on the entry tree, persists the resulting compaction entry via `Session.appendCompaction()`, and returns `{ tokensBefore, summary, firstKeptEntryId }`.

#### Scenario: compaction summarizes and persists
- **WHEN** `POST /api/sessions/:id/compact` is called on a session with many entries (and the summary LLM is mocked to return a short summary)
- **THEN** the response status is 200 and the body contains `tokensBefore`, `summary`, and `firstKeptEntryId`
- **AND** a compaction entry is persisted in the session's entry tree

#### Scenario: unknown session
- **WHEN** `POST /api/sessions/nope/compact` is called
- **THEN** the response status is 404

#### Scenario: no model configured
- **WHEN** the session's project has no model config and no global default exists
- **THEN** the response status is 500 and the body indicates a missing model configuration

### Requirement: Compaction uses the session's configured model
The compaction summary SHALL run on the model resolved from the session's project config (falling back to the global default), using the same `resolveModel` logic as the agent runner. The route SHALL pass the resolved `Model` and `apiKey` resolved from the environment for that model's provider to the `compact()` function.

#### Scenario: provider key resolved from env
- **WHEN** a compaction runs for a session whose configured provider has a key in the environment
- **THEN** `compact` is invoked with an `apiKey` resolved via pi-ai's `getEnvApiKey(provider)` and the model resolved from the project or global config

#### Scenario: missing provider key surfaces a clear error
- **WHEN** the configured provider has no API key in the environment
- **THEN** the response status is 500 (or 503) and the body clearly states that no API key is configured for that provider
- **AND** no LLM call is attempted

### Requirement: Compaction returns 500 on summary failure
Because `compact` makes a real LLM call that can fail, the route SHALL return HTTP 500 when the summary's stop reason is `error` or `aborted` (i.e., `compact()` returns `err`). No compaction entry is persisted in this case. The session's existing entries remain unchanged.

#### Scenario: summary failure returns 500
- **WHEN** the mocked summary returns a `stopReason` of `error` or `aborted`
- **THEN** the response status is 500
- **AND** the session's persisted entries are unchanged from before the call

### Requirement: Session stats route
The system SHALL expose `GET /api/sessions/:id/stats` returning a unified read-only projection `{ activeMessageCount, totalInputTokens, totalOutputTokens, totalCostUsd, createdAt, durationMs }`. The stats SHALL be **derived from the entry tree** (`session_entries`) by loading the session's path entries via `SqliteSessionStorage.getPathToRoot`, projecting them to `AgentMessage[]` via `buildSessionContext`, then walking the assistant messages to sum `usage.input`, `usage.output`, and `usage.cost.total`. The `activeMessageCount` SHALL equal the projected message count (reflects active messages after compaction, not total lifetime messages). The route SHALL make no LLM or network calls and SHALL NOT read from any legacy `messages` or `costs` table.

#### Scenario: stats for a session with entries
- **WHEN** a session has 2 message entries (1 user + 1 assistant with `usage`) and `GET /api/sessions/:id/stats` is called
- **THEN** the response status is 200 and `body.activeMessageCount` is 2, `body.createdAt` equals the session's creation time, and `body.durationMs >= 0`
- **AND** `body.totalInputTokens`, `body.totalOutputTokens`, and `body.totalCostUsd` reflect the assistant message's `usage` fields

#### Scenario: stats for a session with no entries
- **WHEN** a session has no message entries
- **THEN** `activeMessageCount`, `totalInputTokens`, `totalOutputTokens`, and `totalCostUsd` are all 0 (not null, not 404)

#### Scenario: unknown session
- **WHEN** `GET /api/sessions/nope/stats` is called
- **THEN** the response status is 404

### Requirement: Registration via route composition
Both the compaction and stats route modules SHALL be registered through `buildServer`'s array-composition (the pattern established by `server-rest-api`), not by editing the foundation's `index.ts`.

#### Scenario: routes available on a composed server
- **WHEN** `buildServer` is composed with this change's route modules
- **THEN** `POST /api/sessions/:id/compact` and `GET /api/sessions/:id/stats` are available on the resulting server
- **AND** the foundation's `index.ts` was not edited to register them

### Requirement: Server documentation
The change SHALL update `AGENTS.md` with a server section documenting: the `dev:server` command (port 3001, env vars `SAKTI_DB_PATH`/`SAKTI_PORT`), the REST-for-state + WS-for-streaming architecture, the Eden treaty typed client, that API keys come from env (not DB), that model config (provider+modelId) lives in the DB, and that compaction is a network-backed (LLM) operation while stats is a fast local read.

#### Scenario: AGENTS.md describes the server
- **WHEN** a developer reads the `AGENTS.md` server section
- **THEN** it explains how to run the server, the REST/WS split, the env-key invariant, and the compaction-is-network-backed caveat
