## MODIFIED Requirements

### Requirement: Agent loop streams LLM responses
The agent SHALL accept a prompt message, send it to the LLM via `@earendil-works/pi-ai`'s `streamSimple()`, and yield streaming events (`text_delta`, `thinking_delta`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `done`, `error`) as an async iterable. The persisted `AssistantMessage` built from the stream's `done` event SHALL carry the `stopReason` reported by pi-ai (e.g. `"stop"`, `"toolUse"`, `"error"`, `"aborted"`), in addition to `content`, `usage`, and `timestamp`. `AssistantMessage.stopReason` is optional (older persisted messages may lack it and deserialize to `undefined`).

#### Scenario: Single text response with no tool calls
- **WHEN** the agent receives a prompt and the LLM responds with plain text
- **THEN** the agent yields `text_delta` events for each content chunk, followed by a `done` event, and the final `AssistantMessage` is returned with its `stopReason` set to the value pi-ai reported (e.g. `"stop"`)

#### Scenario: LLM response includes tool calls
- **WHEN** the agent receives a prompt and the LLM responds with one or more tool calls
- **THEN** the agent yields `toolcall_start`, `toolcall_delta`, and `toolcall_end` events for each tool call, then enters the tool execution phase

#### Scenario: LLM returns an error
- **WHEN** the LLM returns a non-retryable error (e.g., billing limit, invalid request)
- **THEN** the agent yields an `error` event with the error message AND materializes an `AssistantMessage` with `stopReason: "error"`, the error text as its content, and zeroed usage

#### Scenario: Stream is aborted mid-response
- **WHEN** the caller's abort signal fires while the LLM is streaming
- **THEN** the agent yields an `error` event AND materializes an `AssistantMessage` with `stopReason: "aborted"`

#### Scenario: stopReason is preserved on the message for downstream use
- **WHEN** a turn completes (success, error, or abort)
- **THEN** the persisted `AssistantMessage` carries its `stopReason` so downstream code (compaction token estimate, retry decisions, attribution) can distinguish successful turns from errored/aborted ones

### Requirement: Agent loop supports compaction
The agent SHALL check at the top of each turn (before sending to the LLM) whether the context window is near capacity, using `shouldCompact(estimateContextTokens(messages), model.contextWindow, reserveTokens)`. `estimateContextTokens` prefers the provider-reported `usage.totalTokens` from the most recent assistant message whose `stopReason` is neither `"error"` nor `"aborted"` (matching pi's `getAssistantUsage`, which skips stale/garbage usage from failed or aborted turns). It falls back to a char/4 estimate over all messages when no usable assistant usage is available — e.g. the first turn, or a history consisting only of error/aborted turns. When the check trips **and** `autoCompaction` is enabled in the agent config, the agent SHALL summarize old messages via the existing `compactMessages()` utility (reusing the same `model`, `reserveTokens`, and `keepRecentTokens` as the manual compaction route), splice the returned message list into the working message array, and call `store.replaceMessages()` to persist the compacted history. The agent SHALL yield `compaction_start` before summarization and `compaction_end` (carrying `tokensBefore` and `tokensAfter`) after. When `autoCompaction` is disabled (the default), the check SHALL be skipped entirely. Manual compaction via `POST /api/sessions/:id/compact` remains available regardless of this setting.

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

#### Scenario: Token estimate skips an errored or aborted turn
- **WHEN** the most recent assistant message has `stopReason: "error"` or `"aborted"`, and an earlier successful assistant message has usable usage
- **THEN** `estimateContextTokens` uses the earlier message's usage (plus a trailing estimate), NOT the stale/garbage usage of the failed turn

## ADDED Requirements

### Requirement: Errored and aborted turns are persisted as assistant messages
When the LLM stream fails (provider error) or is aborted, the agent loop SHALL materialize an `AssistantMessage` with `stopReason` set to `"error"` or `"aborted"` respectively, the error message text as content (for an abort, a short "aborted" marker), zeroed usage, and persist it via `store.appendMessage()` before terminating the loop. The agent SHALL still yield the `error` event so live consumers receive the immediate signal. This makes the transcript a faithful record of what happened and lets a subsequent resume/continue see the failure — matching pi's `agent-loop.ts`.

#### Scenario: Errored turn persists an assistant message
- **WHEN** the LLM stream yields an error event (e.g. billing limit) during a turn
- **THEN** the loop appends an assistant message with `stopReason: "error"`, the error text as content, and zeroed usage to the session store

#### Scenario: Aborted turn persists an assistant message
- **WHEN** the caller's abort signal fires mid-stream
- **THEN** the loop appends an assistant message with `stopReason: "aborted"` and a short marker as content to the session store

#### Scenario: The error event is still emitted live
- **WHEN** a turn errors or is aborted
- **THEN** the loop yields the `error` event (as before) in addition to persisting the assistant message — live UI consumers are unaffected
