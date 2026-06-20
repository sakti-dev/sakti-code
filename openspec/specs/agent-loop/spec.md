## Purpose

The agent loop is the core execution engine: it sends prompts to an LLM, streams responses, executes tool calls, retries errors, and manages compaction. It persists messages via a `SessionStore` interface and supports abort via `AbortSignal`.

## Requirements

### Requirement: Agent loop streams LLM responses
The agent SHALL accept a prompt message, send it to the LLM via `@earendil-works/pi-ai`'s `streamSimple()`, and yield streaming events (`text_delta`, `thinking_delta`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `done`, `error`) as an async iterable.

#### Scenario: Single text response with no tool calls
- **WHEN** the agent receives a prompt and the LLM responds with plain text
- **THEN** the agent yields `text_delta` events for each content chunk, followed by a `done` event, and the final `AssistantMessage` is returned

#### Scenario: LLM response includes tool calls
- **WHEN** the agent receives a prompt and the LLM responds with one or more tool calls
- **THEN** the agent yields `toolcall_start`, `toolcall_delta`, and `toolcall_end` events for each tool call, then enters the tool execution phase

#### Scenario: LLM returns an error
- **WHEN** the LLM returns a non-retryable error (e.g., billing limit, invalid request)
- **THEN** the agent yields an `error` event with the error message and stops the loop

### Requirement: Agent loop executes tool calls
The agent SHALL execute tool calls returned by the LLM, append tool results as messages, and re-send to the LLM for the next turn. This continues until the LLM responds without tool calls or a tool result sets `terminate: true`.

#### Scenario: Single tool call followed by text response
- **WHEN** the LLM returns one tool call and the tool executes successfully
- **THEN** the agent appends the tool result message, sends to the LLM again, and yields the text response events

#### Scenario: Multiple tool calls in parallel
- **WHEN** the LLM returns multiple tool calls and tool execution mode is `parallel`
- **THEN** the agent executes all tool calls concurrently, appends all results, and sends them together to the LLM

#### Scenario: Multiple tool calls in sequence
- **WHEN** the LLM returns multiple tool calls and tool execution mode is `sequential`
- **THEN** the agent executes tool calls one at a time, appending each result before the next

#### Scenario: Tool execution fails
- **WHEN** a tool call throws an error or returns `isError: true`
- **THEN** the agent appends the error as a tool result message and continues the loop (sends to LLM for recovery)

#### Scenario: Tool result sets terminate flag
- **WHEN** a tool result includes `terminate: true`
- **THEN** the agent stops the loop after all pending tool results are collected, without sending back to the LLM

### Requirement: Agent loop reports tool execution progress
The agent SHALL yield `tool_execution_start`, `tool_execution_update`, and `tool_execution_end` events during tool execution, allowing the UI to show progress.

#### Scenario: Tool emits partial updates
- **WHEN** a tool calls its `onUpdate` callback with partial result text
- **THEN** the agent yields a `tool_execution_update` event with the accumulated partial result

### Requirement: Agent loop persists messages via SessionStore
The agent SHALL call `store.appendMessage()` for every new message (user prompt, assistant response, tool results, steer messages, follow-up messages) as they are produced during the loop.

#### Scenario: Messages are persisted as they are produced
- **WHEN** the agent loop processes a turn with multiple tool calls
- **THEN** each user message, assistant message (on done), and tool result message is appended to the store immediately

#### Scenario: Steer message is persisted as user message
- **WHEN** a steer message is injected into the loop
- **THEN** it is appended to the store as a user message with role `"user"` and the steer text as content

### Requirement: Agent loop supports compaction
The agent SHALL check at the top of each turn (before sending to the LLM) whether the context window is near capacity, using `shouldCompact(estimateContextTokens(messages), model.contextWindow, reserveTokens)`. `estimateContextTokens` prefers the provider-reported `usage.totalTokens` from the most recent assistant message (falling back to a char/4 estimate over all messages when no assistant usage is available — e.g. the first turn) so the threshold decision uses a real token count, matching the proven pi agent's `estimateContextTokens`. When the check trips **and** `autoCompaction` is enabled in the agent config, the agent SHALL summarize old messages via the existing `compactMessages()` utility (reusing the same `model`, `reserveTokens`, and `keepRecentTokens` as the manual compaction route), splice the returned message list into the working message array, and call `store.replaceMessages()` to persist the compacted history. The agent SHALL yield `compaction_start` before summarization and `compaction_end` (carrying `tokensBefore` and `tokensAfter`) after. When `autoCompaction` is disabled (the default), the check SHALL be skipped entirely. Manual compaction via `POST /api/sessions/:id/compact` remains available regardless of this setting.

#### Scenario: Context window approaching limit triggers compaction
- **WHEN** `autoCompaction` is enabled and `estimateTokens(messages)` exceeds `model.contextWindow - reserveTokens` (default reserve: 16,000)
- **THEN** the agent yields `compaction_start`, summarizes the oldest messages (keeping ~`keepRecentTokens` of recent context, default 20,000), calls `store.replaceMessages()` with the compacted list, and yields `compaction_end` with `tokensBefore` and `tokensAfter`

#### Scenario: Context window not near limit
- **WHEN** `autoCompaction` is enabled but the total tokens are within budget
- **THEN** no compaction occurs and the loop continues to `turn_start` normally

#### Scenario: Auto-compaction disabled by default
- **WHEN** `autoCompaction` is not set (the default) or is `false`, regardless of token count
- **THEN** no compaction check runs, no `compaction_*` events are yielded, and the loop proceeds turn-by-turn as before

#### Scenario: Compaction check position
- **WHEN** a turn begins
- **THEN** the compaction check runs after processing any queued steer messages but before the `turn_start` event

### Requirement: Auto-compaction resolves its API key via the runner
The summarization LLM call requires a provider API key. Because the agent package is pure (no environment or DB access), the key SHALL be supplied via `AgentConfig.apiKey`, resolved by the runner using the same provider-resolution logic as the manual compaction route (`getEnvApiKey(provider)` from the project's model config). When `autoCompaction` is enabled but no API key is available, the agent SHALL skip compaction silently for that turn (no event, no error) and continue the loop; the next turn re-evaluates. A failed or aborted summarization SHALL NOT terminate the loop — `compactMessages` returns the original messages unchanged in that case, and the loop continues with the un-compacted context.

#### Scenario: Missing API key is skipped gracefully
- **WHEN** `autoCompaction` is enabled, the context window threshold is exceeded, but `AgentConfig.apiKey` is absent or empty
- **THEN** the loop continues to `turn_start` without yielding any `compaction_*` event and without throwing

#### Scenario: Summarization failure does not break the loop
- **WHEN** `autoCompaction` is enabled and the summarization LLM call returns `stopReason: "error"` or is aborted
- **THEN** `compactMessages` returns the original message list unchanged, the loop continues normally, and no `error` event is emitted for the summarization failure

#### Scenario: API key plumbed through config
- **WHEN** `runPrompt` constructs the agent loop for a session whose project has a provider configured with an env API key
- **THEN** `createAgentLoop` receives `apiKey` derived from `getEnvApiKey(provider)`, and `AgentConfig.apiKey` is populated

### Requirement: Agent loop retries retryable errors
The agent SHALL catch retryable LLM errors (HTTP 429, 5xx) and retry with exponential backoff (base delay × 2^(attempt-1)). Max retries default to 3. Context overflow errors SHALL NOT be retried (handled by compaction instead).

#### Scenario: Rate limit triggers retry
- **WHEN** the LLM returns HTTP 429
- **THEN** the agent waits with exponential backoff and retries the LLM call up to 3 times, yielding retry events for each attempt

#### Scenario: Max retries exceeded
- **WHEN** the LLM fails 3 consecutive times with retryable errors
- **THEN** the agent yields an `error` event and stops the loop

#### Scenario: Context overflow is not retried
- **WHEN** the LLM returns a context window overflow error
- **THEN** the agent triggers compaction instead of retrying

### Requirement: Agent loop emits lifecycle events
The agent SHALL yield `agent_start`, `turn_start`, `message_start`, `message_update`, `message_end`, `turn_end`, and `agent_end` events to provide full observability of the loop's lifecycle.

#### Scenario: Full turn lifecycle
- **WHEN** the agent processes a prompt that results in one tool call and a final text response
- **THEN** the agent yields events in order: `agent_start` → `turn_start` → `message_start` → (streaming events) → `message_end` → `tool_execution_start` → `tool_execution_end` → `turn_start` → `message_start` → (streaming events) → `message_end` → `turn_end` → `agent_end`

### Requirement: Agent supports abort
The agent SHALL support cancellation via an `AbortSignal`. When aborted, the agent SHALL stop the current LLM stream, cancel pending tool executions, and yield an `agent_end` event.

#### Scenario: Abort during LLM streaming
- **WHEN** the abort signal fires while the LLM is streaming
- **THEN** the agent stops consuming the LLM stream and yields `agent_end`

#### Scenario: Abort during tool execution
- **WHEN** the abort signal fires while a tool is executing
- **THEN** the agent cancels the tool execution and yields `agent_end`

### Requirement: Agent configuration
The agent SHALL accept a configuration object (`AgentConfig`) specifying: model, tools, session store, tool execution mode (sequential/parallel), retry settings (max retries, base delay), compaction settings (reserve tokens, keep-recent tokens), thinking level, auto-retry toggle, and steering mode.

#### Scenario: Configuration with custom settings
- **WHEN** an agent is created with `toolExecutionMode: "parallel"`, `maxRetries: 5`, and `thinkingLevel: "high"`
- **THEN** the agent uses parallel tool execution, retries up to 5 times, and passes thinking level to the LLM

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
- **WHEN** `AgentConfig` has `thinkingLevel: "high"` and the loop sends to the LLM
- **THEN** `streamSimple` receives `{ thinkingLevel: "high" }` in its options parameter

### Requirement: AgentConfigInput gains settings overrides
The `AgentConfigInput` interface SHALL gain optional `autoRetry: boolean` and `steeringMode: string` fields. When present, these override the corresponding default behaviors in `createAgentConfig`. The `maxRetries` field already exists but was not exposed per-session — it SHALL now be settable per-session.

#### Scenario: autoRetry false disables retries
- **WHEN** `AgentConfigInput` has `autoRetry: false` and the LLM returns a retryable error
- **THEN** the loop yields an `error` event immediately without retrying

#### Scenario: steeringMode one-at-a-time processes steers before each turn
- **WHEN** `steeringMode: "one-at-a-time"` is set and one steer is queued
- **THEN** the steer is processed at the next turn start, and subsequent steers are deferred until that turn completes

### Requirement: Per-session auto_compaction setting is persisted and inert pending auto-compaction
The `auto_compaction` setting (`session:{id}:auto_compaction`, default `"false"`) SHALL be readable and writable via the settings routes and loaded by `runPrompt` at loop construction. It is persisted correctly and round-trips. Automatic turn-level compaction is NOT yet implemented in the loop; the setting is forward-compatible scaffolding consumed by the dedicated `agent-auto-compaction` change. Manual compaction via `POST /api/sessions/:id/compact` remains available regardless of this setting.

#### Scenario: auto_compaction default is false
- **WHEN** a session has no stored `auto_compaction` setting
- **THEN** `loadSessionSettings` returns `auto_compaction: "false"`

#### Scenario: setting round-trips
- **WHEN** `PATCH /api/sessions/:id/settings { auto_compaction: true }` then `GET /api/sessions/:id/settings`
- **THEN** the response has `auto_compaction: true`

#### Scenario: no compaction events are ever yielded
- **WHEN** `auto_compaction` is enabled or disabled and tokens exceed the context window threshold
- **THEN** the loop continues without yielding any `compaction_start`/`compaction_end` events (the gate exists but the feature behind it is implemented in `agent-auto-compaction`)
