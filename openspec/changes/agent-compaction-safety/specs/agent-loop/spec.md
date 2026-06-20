## ADDED Requirements

### Requirement: Compaction cut-point never orphans a tool result
When `compactMessages()` selects the boundary between messages to summarize and messages to keep (`recentMessages = messages.slice(cutIndex)`), the selected `cutIndex` SHALL NOT point at a `tool` message. After the keep-recent-budget walk-back determines a raw cut index, the implementation SHALL advance `cutIndex` forward past any contiguous `tool` messages so that `recentMessages` always begins at a `user` or `assistant` boundary — matching pi's `findValidCutPoints` (`openspec/references/pi/packages/coding-agent/src/core/compaction/compaction.ts:300-318`), which excludes `toolResult` from the valid cut-point set, and its "closest valid cut point at or after `i`" selection. If advancement reaches the end of the message array (no valid cut point exists — defensive), compaction SHALL keep all messages (no summarization) rather than risk an orphan. This guarantees the ship gate: **compaction never returns a `recentMessages` slice that starts with an orphaned tool result** (a tool result with no preceding assistant tool-call in the kept window, which the provider would reject).

#### Scenario: Cut lands on a tool result is advanced past it
- **WHEN** the keep-recent budget walk-back sets the raw `cutIndex` at a `tool` message, and a later message is a `user` or `assistant`
- **THEN** `cutIndex` advances forward to that `user`/`assistant` message, and `recentMessages` does NOT start with a `tool` message

#### Scenario: Tool result with its tool-call in the summarize window is not orphaned
- **WHEN** an assistant tool-call and its `tool` result both fall in the summarize (old) window, and `recentMessages` begins at a later `user`/`assistant`
- **THEN** the `tool` result is summarized alongside its tool-call (not promoted into `recentMessages` as an orphan)

#### Scenario: No valid cut point keeps everything
- **WHEN** advancing `cutIndex` forward past `tool` messages reaches the end of the array (no `user`/`assistant` exists at or after the raw cut)
- **THEN** compaction keeps all messages and performs no summarization for that turn (returns `messages` unchanged), rather than producing an orphaned `recentMessages`

#### Scenario: Normal cut at a user or assistant is unchanged
- **WHEN** the raw `cutIndex` already points at a `user` or `assistant` message
- **THEN** no advancement occurs and `recentMessages` is exactly `messages.slice(cutIndex)` as before

### Requirement: Compaction serialization mirrors pi's serializeConversation
The `messageToText` serializer that feeds the summarization LLM SHALL mirror pi's `serializeConversation` (`openspec/references/pi/packages/coding-agent/src/core/compaction/utils.ts:109-160`). For each message: a `user` message SHALL serialize as `[User]: <content>`; an `assistant` message SHALL serialize as up to three labeled sections in order — `[Assistant thinking]: <thinking blocks>`, `[Assistant]: <text blocks>`, `[Assistant tool calls]: <name>(k=v, k=v); …` — one per present content-block type (only present sections emitted); a `tool` message SHALL serialize as `[Tool result]: <truncateForSummary(content, TOOL_RESULT_MAX_CHARS)>`. Tool results SHALL be truncated via `truncateForSummary` (`utils.ts:89-98`): when `content.length > TOOL_RESULT_MAX_CHARS`, emit `${content.slice(0, TOOL_RESULT_MAX_CHARS)}\n\n[... ${truncatedChars} more characters truncated]`; `TOOL_RESULT_MAX_CHARS` SHALL equal `2000`. This bounds the summarization prompt token cost and preserves assistant reasoning + tool-invocation context that the prior single-line `Assistant:` serializer dropped.

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
