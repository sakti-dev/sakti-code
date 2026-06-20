## Purpose

The agent loop is the core execution engine: it sends prompts to an LLM, streams responses, executes tool calls, retries errors, and manages compaction. It persists messages via a `SessionStore` interface and supports abort via `AbortSignal`.

## Requirements

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

### Requirement: Errored and aborted turns are persisted as assistant messages
When the LLM stream terminates with an `error` event (provider error or caller abort), the agent loop SHALL take the pi-ai `event.error` `AssistantMessage` (which carries `stopReason: "error"` or `"aborted"` respectively and the `errorMessage`), push it onto the working message array, and persist it via `store.appendMessage()` before terminating the loop — matching pi's `agent-loop.ts:196`. The agent SHALL still yield the `error` event so live consumers receive the immediate signal. The persisted `stopReason` SHALL survive a reload (round-tripped through the message store) so that a subsequent resume/continue sees the failure and `estimateContextTokens` can skip it. No message is synthesized: the persisted message is the one pi-ai reported.

#### Scenario: Errored turn persists the pi-ai error message
- **WHEN** the LLM stream yields an `error` event (e.g. billing limit) during a turn
- **THEN** the loop appends pi-ai's error `AssistantMessage` (with `stopReason: "error"` and the real `errorMessage"`) to the session store, and it survives a reload

#### Scenario: Aborted turn persists the pi-ai aborted message
- **WHEN** the caller's abort signal fires mid-stream and pi-ai terminates with `stopReason: "aborted"`
- **THEN** the loop appends pi-ai's aborted `AssistantMessage` (with `stopReason: "aborted"`) to the session store

#### Scenario: The error event is still emitted live
- **WHEN** a turn errors or is aborted
- **THEN** the loop yields the `error` event (as before) in addition to persisting the assistant message — live UI consumers are unaffected

#### Scenario: No message is synthesized
- **WHEN** a turn errors or is aborted
- **THEN** the persisted assistant message is pi-ai's reported message (with its real `stopReason`, `errorMessage`, and zeroed usage), not a hand-constructed placeholder

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

### Requirement: Compaction cut-point never orphans a tool result
When `compactMessages()` selects the boundary between messages to summarize and messages to keep (`recentMessages = messages.slice(cutIndex)`), the selected `cutIndex` SHALL NOT point at a `tool` message. After the keep-recent-budget walk-back determines a raw cut index, the implementation SHALL advance `cutIndex` forward past any contiguous `tool` messages so that `recentMessages` always begins at a `user` or `assistant` boundary — matching pi's `findValidCutPoints` (`openspec/references/pi/packages/coding-agent/src/core/compaction/compaction.ts:300-318`), which excludes `toolResult` from the valid cut-point set, and its "closest valid cut point at or after `i`" selection (compaction.ts:~407-413). The equivalence is exact for our 3-role model: pi's valid cut-point set is `{user, assistant}` (it also accepts pi-specific roles bashExecution/custom/branchSummary/compactionSummary, which our model lacks), so "smallest valid cut point `>= i`" ≡ "smallest `j >= i` with `role !== "tool"`", which is precisely what the snap-forward computes; both algorithms also accumulate `tool`-message tokens in the budget walk (pi counts every `entry.type === "message"`, toolResult included), so they break at the same `i`. If advancement reaches the end of the message array (no valid cut point exists — the entire keep-window is `tool` messages, a malformed conversation), compaction SHALL keep all messages and perform no summarization, matching pi's `if (cutPoints.length === 0) return { firstKeptEntryIndex: startIndex, ... }` (compaction.ts:403). This keep-all-on-exhaustion SHALL be enforced by widening the existing `if (cutIndex <= 1)` guard to also fire when `cutIndex >= messages.length` — without that, an exhausted `cutIndex` (e.g. `messages.length` = 40) passes `<= 1` and produces `recentMessages = slice(40) = []` (summarize-all-keep-nothing). This guarantees the ship gate: **compaction never returns a `recentMessages` slice that starts with an orphaned tool result** (a tool result without its preceding assistant tool-call in the same window).

#### Scenario: Cut lands on a tool result is advanced past it
- **WHEN** the keep-recent budget walk-back sets the raw `cutIndex` at a `tool` message, and a later message is a `user` or `assistant`
- **THEN** `cutIndex` advances forward to that `user`/`assistant` message, and `recentMessages` does NOT start with a `tool` message

#### Scenario: Tool result with its tool-call in the summarize window is not orphaned
- **WHEN** an assistant tool-call and its `tool` result both fall in the summarize (old) window, and `recentMessages` begins at a later `user`/`assistant`
- **THEN** the `tool` result is summarized alongside its tool-call (not promoted into `recentMessages` as an orphan)

#### Scenario: No valid cut point keeps everything
- **WHEN** advancing `cutIndex` forward past `tool` messages reaches the end of the array (the entire keep-window is `tool` messages — no `user`/`assistant` exists at or after the raw cut)
- **THEN** compaction keeps all messages and performs no summarization for that turn (returns `messages` unchanged), matching pi's `cutPoints.length === 0` → keep-all. The keep-all guard SHALL fire (`cutIndex >= messages.length`), NOT produce an empty `recentMessages`

#### Scenario: Normal cut at a user or assistant is unchanged
- **WHEN** the raw `cutIndex` already points at a `user` or `assistant` message
- **THEN** no advancement occurs and `recentMessages` is exactly `messages.slice(cutIndex)` as before

### Requirement: Compaction serialization mirrors pi's serializeConversation
The `messageToText` serializer that feeds the summarization LLM SHALL mirror pi's `serializeConversation` (`openspec/references/pi/packages/coding-agent/src/core/compaction/utils.ts:109-163`) field-for-field, including the details pi's code encodes. For each message:
- `user` → `[User]: <content>` — emitted **only when content is non-empty** (pi `utils.ts:121`: `if (content) parts.push(...)`). Our `UserMessage.content` is always a `string`.
- `assistant` → emit, **in this order and each only when non-empty**, whichever of `[Assistant thinking]: <thinkingParts.join("\n")>`, `[Assistant]: <textParts.join("\n")>`, `[Assistant tool calls]: <calls.join("; ")>` are present. Each tool call serializes as `${block.name}(${argsStr})` where `argsStr = Object.entries(args).map(([k,v]) => \`${k}=${JSON.stringify(v)}\`).join(", ")` — pi's exact arg format (`utils.ts:151-153`). When multiple sections are present for one assistant message, they SHALL be joined with `"\n\n"` (pi joins ALL parts, across and within messages, with `parts.join("\n\n")`, `utils.ts:163`).
- `tool` → `[Tool result]: <truncateForSummary(content, TOOL_RESULT_MAX_CHARS)>` — emitted **only when content is non-empty** (pi `utils.ts:158`: `if (content) parts.push(...)`).

Tool results SHALL be truncated via `truncateForSummary` (`utils.ts:89-98`): when `content.length > TOOL_RESULT_MAX_CHARS`, emit `${content.slice(0, TOOL_RESULT_MAX_CHARS)}\n\n[... ${truncatedChars} more characters truncated]`; `TOOL_RESULT_MAX_CHARS` SHALL equal `2000`. pi calls `convertToLlm(currentMessages)` before serializing (compaction.ts:586-587) to map custom message types onto LLM roles; our model has only `user`/`assistant`/`tool` (no custom types), so `convertToLlm` is a no-op equivalent and is intentionally not replicated. This bounds the summarization prompt token cost and preserves assistant reasoning + tool-invocation context that the prior single-line `Assistant:` serializer dropped.

#### Scenario: Tool result over 2000 chars is truncated with the pi marker
- **WHEN** a `tool` message's content exceeds 2000 characters
- **THEN** the summarization text for that message is `content.slice(0, 2000)` followed by `\n\n[... <N> more characters truncated]` where N is the dropped character count — the full content is NOT serialized verbatim

#### Scenario: Tool result at or under 2000 chars is unchanged
- **WHEN** a `tool` message's content is 2000 characters or fewer
- **THEN** the summarization text serializes the full content with no truncation marker

#### Scenario: Assistant thinking blocks are preserved in the summary text
- **WHEN** an `assistant` message contains `thinking` content blocks
- **THEN** the summarization text includes a `[Assistant thinking]: <…>` section (not dropped, as the prior serializer did)

#### Scenario: Assistant tool calls are preserved in the summary text
- **WHEN** an `assistant` message contains `toolCall` content blocks
- **THEN** the summarization text includes a `[Assistant tool calls]: <name>(k=v, …); …` section listing each call and its arguments (not dropped)

#### Scenario: Assistant text-only message emits a single section
- **WHEN** an `assistant` message contains only `text` content blocks (no thinking, no tool calls)
- **THEN** the summarization text emits only `[Assistant]: <text>` — no empty thinking/toolcalls sections

#### Scenario: Empty user or tool content produces no line
- **WHEN** a `user` message has empty `content` (""), or a `tool` message's text content is empty
- **THEN** the summarization text omits that message entirely (pi `if (content)` guard) — no `[User]: ` or `[Tool result]: ` line with empty trailing content

#### Scenario: Multi-section assistant joins sections with double newline
- **WHEN** an `assistant` message contains thinking AND text AND tool-call blocks
- **THEN** the three sections appear in order (`[Assistant thinking]`, `[Assistant]`, `[Assistant tool calls]`) separated by `\n\n` (pi's `parts.join("\n\n")`), matching the separator used between distinct messages
