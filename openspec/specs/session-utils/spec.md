## Purpose

Session utility routes provide session-level operations beyond the core CRUD: manual compaction (LLM-backed history summarization) and session statistics (read-only projection). Both are additive route modules that compose into the Elysia server via `buildServer`'s array composition.

## Requirements

### Requirement: Agent package exports compactMessages
The `@sakti-code/agent` package SHALL re-export `compactMessages`, `CompactionOptions`, and `CompactionResult` from its public barrel so server-layer code can import them through the package boundary (not a deep internal path). This is an additive re-export with no behavior change to existing agent functionality.

#### Scenario: compactMessages importable from the package
- **WHEN** server code does `import { compactMessages } from "@sakti-code/agent"`
- **THEN** the import resolves to the function defined in `packages/agent/src/compaction.ts`
- **AND** the existing agent test suite still passes unchanged

### Requirement: Manual compaction route
The system SHALL expose `POST /api/sessions/:id/compact` that loads the session's messages via `SqliteSessionStore`, resolves the session's configured model (reusing `resolveModel` from `server-agent-streaming`), resolves the model provider's API key from the environment, runs `compactMessages`, persists the resulting compacted messages back via the store, and returns `{ tokensBefore, tokensAfter }`.

#### Scenario: compaction reduces token count and persists
- **WHEN** `POST /api/sessions/:id/compact` is called on a session with many messages (and the summary LLM is mocked to return a short summary)
- **THEN** the response status is 200 and the body is `{ tokensBefore, tokensAfter }` with `tokensBefore > tokensAfter > 0`
- **AND** reloading the session's messages yields the compacted set (fewer/smaller messages than before)

#### Scenario: unknown session
- **WHEN** `POST /api/sessions/nope/compact` is called
- **THEN** the response status is 404

#### Scenario: no model configured
- **WHEN** the session's project has no model config and no global default exists
- **THEN** the response status is 500 and the body indicates a missing model configuration

### Requirement: Compaction uses the session's configured model
The compaction summary SHALL run on the model resolved from the session's project config (falling back to the global default), using the same `resolveModel` logic as the agent runner. The route SHALL pass `contextWindow` from the resolved model and `apiKey` resolved from the environment for that model's provider.

#### Scenario: provider key resolved from env
- **WHEN** a compaction runs for a session whose configured provider has a key in the environment
- **THEN** `compactMessages` is invoked with an `apiKey` resolved via pi-ai's `getEnvApiKey(provider)` and a `contextWindow` equal to the resolved model's `contextWindow`

#### Scenario: missing provider key surfaces a clear error
- **WHEN** the configured provider has no API key in the environment
- **THEN** the response status is 500 (or 503) and the body clearly states that no API key is configured for that provider
- **AND** no LLM call is attempted

### Requirement: Compaction degrades gracefully on summary failure
Because `compactMessages` makes a real LLM call that can fail, the route SHALL NOT lose data on failure: when the summary's stop reason is `error` or `aborted`, `compactMessages` returns the original messages unchanged (`tokensBefore === tokensAfter`), and the route SHALL return HTTP 200 with equal before/after counts rather than throwing or returning an error status.

#### Scenario: summary failure preserves history
- **WHEN** the mocked summary returns a `stopReason` of `error` or `aborted`
- **THEN** the response status is 200 with `tokensBefore === tokensAfter`
- **AND** the session's persisted messages are unchanged from before the call

### Requirement: Session stats route
The system SHALL expose `GET /api/sessions/:id/stats` returning a unified read-only projection `{ messageCount, totalInputTokens, totalOutputTokens, totalCostUsd, createdAt, durationMs }`, composed from `MessageRepo.countBySession`, `CostRepo.aggregateBySession`, and the session's `createdAt` (`durationMs = Date.now() - createdAt`). The route SHALL make no LLM or network calls.

#### Scenario: stats for a session with messages
- **WHEN** a session has 2 appended messages and `GET /api/sessions/:id/stats` is called
- **THEN** the response status is 200 and `body.messageCount` is 2, `body.createdAt` equals the session's creation time, and `body.durationMs >= 0`

#### Scenario: stats with no recorded costs
- **WHEN** a session has messages but no recorded costs
- **THEN** `totalInputTokens`, `totalOutputTokens`, and `totalCostUsd` are all 0 (not null, not 404)

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
