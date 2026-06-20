## MODIFIED Requirements

### Requirement: Agent loop streams LLM responses
The agent SHALL accept a prompt message, send it to the LLM via `@earendil-works/pi-ai`'s `streamSimple()`, and yield streaming events (`text_delta`, `thinking_delta`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `done`, `error`) as an async iterable. The persisted `AssistantMessage` SHALL be the message pi-ai reports — pi-ai's stream contract terminates with a `done` event carrying the final `AssistantMessage` (`event.message`) or an `error` event carrying the final `AssistantMessage` (`event.error`, with `stopReason: "error"|"aborted"` and `errorMessage`). The streaming layer SHALL treat that pi-ai message as the source of truth and map ALL its fields onto our `AssistantMessage` (content, usage, timestamp, `stopReason`, `errorMessage`, and attribution: `api`, `provider`, `model`, `responseModel`, `responseId`, `diagnostics`) — it SHALL NOT cherry-pick a subset or synthesize a message for the error case. This mirrors pi's `messages.push(await response.result())` pattern (`agent-loop.ts:345-369`), where the `done` and `error` cases are handled identically. `AssistantMessage.stopReason`/`errorMessage` are optional in our type only because pre-change DB rows lack them; newly written messages SHALL always carry `stopReason`.

#### Scenario: Successful turn preserves the whole pi-ai message
- **WHEN** the agent receives a prompt and the LLM responds with plain text (no tool calls)
- **THEN** the agent yields `text_delta` events followed by a `done` event, and the final `AssistantMessage` carries `content`, `usage`, `timestamp`, `stopReason` (the value pi-ai reported, e.g. `"stop"`), and any attribution fields pi-ai reported — not a cherry-picked subset

#### Scenario: LLM response includes tool calls
- **WHEN** the agent receives a prompt and the LLM responds with one or more tool calls
- **THEN** the agent yields `toolcall_start`, `toolcall_delta`, and `toolcall_end` events for each tool call, then enters the tool execution phase

#### Scenario: Errored turn uses pi-ai's error message verbatim
- **WHEN** the LLM stream terminates with an `error` event (e.g. billing limit, invalid request)
- **THEN** the final `AssistantMessage` is pi-ai's `event.error` message (carrying `stopReason: "error"`, the real `errorMessage`, zeroed usage) — the streaming layer SHALL NOT synthesize one

#### Scenario: Aborted turn uses pi-ai's aborted message verbatim
- **WHEN** the LLM stream terminates because the caller's abort signal fired
- **THEN** the final `AssistantMessage` is pi-ai's `event.error` message carrying `stopReason: "aborted"`

#### Scenario: stopReason is preserved for downstream use
- **WHEN** a turn completes (success, error, or abort)
- **THEN** the final `AssistantMessage` carries its `stopReason` so downstream code (compaction token estimate, retry decisions, attribution) can distinguish successful turns from errored/aborted ones

### Requirement: Agent loop supports compaction
The agent SHALL check at the top of each turn (before sending to the LLM) whether the context window is near capacity, using `shouldCompact(estimateContextTokens(messages), model.contextWindow, reserveTokens)`. `estimateContextTokens` prefers the provider-reported `usage.totalTokens` from the most recent assistant message whose `stopReason` is neither `"error"` nor `"aborted"` — matching pi's `getAssistantUsage` (`compaction.ts:144-152`: `if (stopReason !== "aborted" && stopReason !== "error" && usage) return usage`), which skips stale/garbage usage from failed or aborted turns. It falls back to a char/4 estimate over all messages when no usable assistant usage is available — e.g. the first turn, or a history consisting only of error/aborted turns. When the check trips **and** `autoCompaction` is enabled in the agent config, the agent SHALL summarize old messages via the existing `compactMessages()` utility (reusing the same `model`, `reserveTokens`, and `keepRecentTokens` as the manual compaction route), splice the returned message list into the working message array, and call `store.replaceMessages()` to persist the compacted history. The agent SHALL yield `compaction_start` before summarization and `compaction_end` (carrying `tokensBefore` and `tokensAfter`) after. When `autoCompaction` is disabled (the default), the check SHALL be skipped entirely. Manual compaction via `POST /api/sessions/:id/compact` remains available regardless of this setting.

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
When the LLM stream terminates with an `error` event (provider error or caller abort), the agent loop SHALL take the pi-ai `event.error` `AssistantMessage` (which carries `stopReason: "error"` or `"aborted"` respectively and the `errorMessage`), push it onto the working message array, and persist it via `store.appendMessage()` before terminating the loop — matching pi's `agent-loop.ts:196`. The agent SHALL still yield the `error` event so live consumers receive the immediate signal. The persisted `stopReason` SHALL survive a reload (round-tripped through the message store) so that a subsequent resume/continue sees the failure and `estimateContextTokens` can skip it. No message is synthesized: the persisted message is the one pi-ai reported.

#### Scenario: Errored turn persists the pi-ai error message
- **WHEN** the LLM stream yields an `error` event (e.g. billing limit) during a turn
- **THEN** the loop appends pi-ai's error `AssistantMessage` (with `stopReason: "error"` and the real `errorMessage`) to the session store, and it survives a reload

#### Scenario: Aborted turn persists the pi-ai aborted message
- **WHEN** the caller's abort signal fires mid-stream and pi-ai terminates with `stopReason: "aborted"`
- **THEN** the loop appends pi-ai's aborted `AssistantMessage` (with `stopReason: "aborted"`) to the session store

#### Scenario: The error event is still emitted live
- **WHEN** a turn errors or is aborted
- **THEN** the loop yields the `error` event (as before) in addition to persisting the assistant message — live UI consumers are unaffected

#### Scenario: No message is synthesized
- **WHEN** a turn errors or is aborted
- **THEN** the persisted assistant message is pi-ai's reported message (with its real `stopReason`, `errorMessage`, and zeroed usage), not a hand-constructed placeholder
