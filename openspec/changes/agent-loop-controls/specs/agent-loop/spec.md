## ADDED Requirements

### Requirement: Steer/followUp on AgentLoop interface
The `AgentLoop` interface SHALL gain `steer(message: string): void` and `followUp(message: string): void` methods. These methods SHALL queue messages for injection into the active prompt stream. Calling these methods on an inactive loop (after prompt has returned) SHALL be a no-op.

#### Scenario: steer is available on AgentLoop
- **WHEN** a client calls `loop.steer("Try X instead")` during an active prompt
- **THEN** the method returns immediately (non-blocking) and the message is queued

#### Scenario: steer on inactive loop is no-op
- **WHEN** a client calls `loop.steer("...")` after the prompt generator has completed
- **THEN** no error is thrown and the message is silently dropped

### Requirement: AgentConfig gains thinkingLevel field
The `AgentConfig` interface SHALL gain an optional `thinkingLevel: string` field. When present, `streamLLMResponse` SHALL pass it to `streamSimple` in the streaming options. When absent, no thinking level is passed (default behavior).

#### Scenario: thinkingLevel passed through config
- **WHEN** `AgentConfig` has `thinkingLevel: "high"` and the loop sends to LLM
- **THEN** `streamSimple` receives `{ thinkingLevel: "high" }` in its options parameter

### Requirement: AgentConfigInput gains settings overrides
The `AgentConfigInput` interface SHALL gain optional `autoRetry: boolean` and `steeringMode: string` fields. When present, these override the corresponding default behaviors in `createAgentConfig`. The `maxRetries` field already exists but was not exposed per-session — it SHALL now be settable per-session.

#### Scenario: autoRetry false disables retries
- **WHEN** `AgentConfigInput` has `autoRetry: false` and the LLM returns a retryable error
- **THEN** the loop yields an `error` event immediately without retrying

#### Scenario: steeringMode one-at-a-time processes steers before each turn
- **WHEN** `steeringMode: "one-at-a-time"` is set and one steer is queued
- **THEN** the steer is processed at the next turn start, and subsequent steers are deferred until that turn completes

### Requirement: Auto-compaction respects per-session setting
When per-session settings disable `auto_compaction`, the loop SHALL NOT call `shouldCompact` or trigger automatic compaction during turns. Manual compaction via `POST /api/sessions/:id/compact` remains available regardless of this setting.

#### Scenario: auto-compaction disabled
- **WHEN** `auto_compaction` is `false` and tokens exceed the context window threshold
- **THEN** the loop continues without triggering automatic compaction
- **AND** no `compaction_start`/`compaction_end` events are yielded

## MODIFIED Requirements

### Requirement: Agent configuration
The agent SHALL accept a configuration object (`AgentConfig`) specifying: model, tools, session store, tool execution mode (sequential/parallel), retry settings (max retries, base delay), compaction settings (reserve tokens, keep-recent tokens), thinking level, auto-retry toggle, and steering mode.

#### Scenario: Configuration with custom settings
- **WHEN** an agent is created with `toolExecutionMode: "parallel"`, `maxRetries: 5`, and `thinkingLevel: "high"`
- **THEN** the agent uses parallel tool execution, retries up to 5 times, and passes thinking level to the LLM

### Requirement: Agent loop persists messages via SessionStore
The agent SHALL call `store.appendMessage()` for every new message (user prompt, assistant response, tool results, steer messages, follow-up messages) as they are produced during the loop.

#### Scenario: Steer message is persisted as user message
- **WHEN** a steer message is injected into the loop
- **THEN** it is appended to the store as a user message with role `"user"` and the steer text as content
