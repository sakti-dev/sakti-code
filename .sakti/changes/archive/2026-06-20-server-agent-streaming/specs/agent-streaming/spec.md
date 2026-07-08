## ADDED Requirements

### Requirement: Per-prompt agent runner
The system SHALL provide `runPrompt(ctx, sessionId, message, store)` as an `AsyncGenerator<AgentEvent>` that, for a valid session+project, resolves the model from stored config, builds cwd-scoped tools, constructs a fresh ephemeral `createAgentLoop`, and forwards the loop's `AgentEvent` stream. Each invocation SHALL construct its own loop, model, tools, and store (no shared mutable state between prompts). Messages produced by the loop SHALL be persisted via the injected `SessionStore` so they survive across prompts. The runner manages an internal `AbortController` per invocation; callers do not provide a signal.

#### Scenario: streams events and persists messages for a valid session
- **WHEN** `runPrompt` is called with a valid `sessionId` and the loop's mocked `streamSimple` yields a `done` event
- **THEN** the generator yields events including `agent_start` and `agent_end`
- **AND** `store.loadMessages(sessionId)` returns messages after the generator completes

#### Scenario: unknown session
- **WHEN** `runPrompt` is called with a `sessionId` that does not exist
- **THEN** the generator throws an error matching `/Session not found/`

#### Scenario: unknown project
- **WHEN** `runPrompt` is called with a session whose `projectId` does not exist
- **THEN** the generator throws an error matching `/Project not found/`

### Requirement: Model resolution from stored config
The system SHALL resolve the pi-ai `Model` for a session by reading `ModelConfigRepo.getForProject(projectId)` and falling back to `ModelConfigRepo.getGlobalDefault()` when no project-specific config exists. Resolution SHALL call `getModel(provider, modelId)` using only values stored in the config row. API keys SHALL NOT be read from the DB — they come from the environment (pi-ai reads them). If neither a project config nor a global default exists, the resolver SHALL throw.

#### Scenario: resolves via project config
- **WHEN** a session's project has a stored model config and `runPrompt` constructs the loop
- **THEN** the loop's model is the one resolved from the project's config row

#### Scenario: falls back to global default
- **WHEN** a session's project has no stored config but a global default exists
- **THEN** the loop's model is the global default

#### Scenario: no config available
- **WHEN** neither a project config nor a global default exists
- **THEN** `runPrompt` throws an error mentioning the missing config

### Requirement: Cwd-scoped tools built per prompt
The system SHALL build the 7 coding tools (`createReadTool`, `createWriteTool`, `createEditTool`, `createBashTool`, `createGrepTool`, `createFindTool`, `createLsTool`) scoped to the session's project `cwd` on every `runPrompt` call. Each call SHALL construct fresh tool instances; tools SHALL NOT be shared across prompts or projects.

#### Scenario: tools use the project cwd
- **WHEN** `runPrompt` runs for a session whose project cwd is `/proj/a`
- **THEN** every tool constructed for that run is scoped to `/proj/a`

### Requirement: Abort registry
The system SHALL maintain an in-process registry mapping `sessionId` to an `AbortController` for the duration of an active run. `abortRun(sessionId)` SHALL signal the run's `AbortController` and return `true` if a run was active (or `false` otherwise). Runs SHALL unregister themselves when the stream ends (normally, via abort, or via error) so the registry does not leak.

#### Scenario: abort signals an active run
- **WHEN** a run is registered and `abortRun(sessionId)` is called
- **THEN** the run's `AbortSignal` becomes aborted
- **AND** `abortRun` returns `true`

#### Scenario: abort with no active run
- **WHEN** `abortRun(sessionId)` is called for a session with no active run
- **THEN** it returns `false` and does not throw

#### Scenario: registry entry removed after run ends
- **WHEN** a run completes (or throws)
- **THEN** its `sessionId` is removed from the active registry

### Requirement: WebSocket prompt/abort protocol
The system SHALL expose a WebSocket at `/ws`. Inbound messages SHALL be either `{type:"prompt", sessionId, message}` or `{type:"abort", sessionId}`. Outbound messages SHALL be either `{type:"event", sessionId, event}` (where `event` is an `AgentEvent`) or `{type:"error", sessionId, message}`. Every outbound frame SHALL carry the `sessionId` so the client can route frames to the correct conversation.

#### Scenario: prompt produces an event frame stream
- **WHEN** a `prompt` message is received for a valid session and the loop yields `agent_start`
- **THEN** the client receives an `event` frame whose `event.type` is `agent_start` and whose `sessionId` matches the request

#### Scenario: abort stops a run
- **WHEN** an `abort` message is received while a run is active on that `sessionId`
- **THEN** the run's `AbortSignal` is signaled and the run stops

#### Scenario: run failure emits an error frame
- **WHEN** a `prompt` triggers an error (e.g. session not found) and the error is caught
- **THEN** the client receives an `error` frame carrying the `sessionId` and a human-readable message

### Requirement: Same-connection concurrency
The system SHALL allow multiple prompts on a single WebSocket connection to run concurrently. The WS `message` handler SHALL NOT await the full prompt stream before returning; each prompt stream SHALL run independently on the event loop and interleave its outbound frames. This is what enables "two projects open at once" over one connection.

#### Scenario: second prompt is not blocked by the first
- **WHEN** a `prompt` message is received while a previous prompt on the same connection is still streaming
- **THEN** the second prompt's run begins without waiting for the first to finish
- **AND** both streams' frames are delivered to the client, each carrying its own `sessionId`

### Requirement: Multi-session persistence isolation
When two prompts run concurrently on two different sessions (different projects), each session's messages SHALL be persisted independently with no cross-contamination — each session's `MessageRepo.loadBySession` returns only that session's messages.

#### Scenario: two projects concurrent, independent persistence
- **WHEN** two `prompt` messages are sent (one per project/session) and both runs are allowed to complete
- **THEN** each session's loaded messages belong only to that session
- **AND** each client receives frames tagged with only its own `sessionId`

### Requirement: Registration via route composition
The WebSocket route SHALL be registered through `buildServer`'s array-composition (the pattern established by `server-rest-api`), not by editing the foundation's `index.ts`. This change SHALL add its route module to the composition and SHALL NOT modify `apps/server/src/index.ts` directly.

#### Scenario: WS available on a composed server
- **WHEN** `buildServer` is composed with this change's route module
- **THEN** the `/ws` endpoint is available on the resulting server
- **AND** the foundation's `index.ts` was not edited to register it
