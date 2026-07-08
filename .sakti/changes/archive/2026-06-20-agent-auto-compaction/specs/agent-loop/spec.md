## MODIFIED Requirements

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

## ADDED Requirements

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
