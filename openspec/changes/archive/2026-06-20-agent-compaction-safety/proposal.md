## Why

Two verified correctness defects in `compactMessages()` (`packages/agent/src/compaction.ts`), each confirmed against pi's proven compaction implementation with file:line citations in `docs/plans/2026-06-20-agent-runtime-pi-alignment.md` (Tasks 2 and 8). They are bundled because both live in one file, one function cluster, and ship the single concrete guarantee stated in the change's ship gate: **compaction never returns an orphaned tool result**. The change is independent of the other alignment changes (no dependency on `agent-stream-message-correctness`'s `stopReason` work).

### The two defects

1. **The cut-point loop can land on a `tool` message, orphaning the tool result.** `compaction.ts` walks back from the newest message accumulating estimated tokens; when it exceeds `keepRecentTokens` it sets `cutIndex = i` **regardless of role**. If `i` is a `tool` message, `recentMessages = messages.slice(cutIndex)` starts with a tool result that has no preceding assistant tool-call in the kept window — an orphan. Sending that to the provider yields a hard rejection ("tool result without preceding tool_use"). pi prevents this with `findValidCutPoints` (`openspec/references/pi/packages/coding-agent/src/core/compaction/compaction.ts:300-318`), which builds the set of valid cut indices by **excluding `toolResult`** entirely, then picks "the closest valid cut point at or after" the over-budget index (`compaction.ts:~407-413`). We do neither.

2. **`messageToText` serializes tool results in full and drops thinking/toolcall blocks.** A single verbose tool result (e.g. a 50k-char file read) blows up the summarization prompt tokens for no benefit — the summary doesn't need verbatim output. pi's `serializeConversation` (`openspec/references/pi/packages/coding-agent/src/core/compaction/utils.ts:109-160`) truncates tool results to `TOOL_RESULT_MAX_CHARS = 2000` via `truncateForSummary` (`utils.ts:89-98`) and serializes assistant messages as **three separate labeled sections** — `[Assistant thinking]`, `[Assistant]`, `[Assistant tool calls]` — instead of our single `Assistant:` text-only line. Our `messageToText` (`compaction.ts`) drops thinking blocks and toolcall blocks entirely and emits one `Assistant:` line, so the summarizer loses reasoning and tool-invocation context that pi preserves.

### Why bundle them

Both are in `compactMessages()` / its helpers, both are verified against the same pi source tree, and both are low-risk single-file fixes. Splitting would create two changes that touch the same ~20 lines on top of each other. The ship gate is concrete and testable: after this change, `recentMessages` never starts with a `tool` message, and tool results in the summarization text never exceed 2000 chars.

## What Changes

- **Cut-point validity guard (Task 2).** After the walk-back loop determines the raw `cutIndex`, advance it forward past any `tool` messages so `recentMessages` always starts at a `user` or `assistant` boundary. This mirrors pi's "closest valid cut point at or after `i`" selection (`compaction.ts:~407-413`) — behaviorally equivalent for our simpler `user|assistant|tool` message model, where the only invalid cut role is `tool`. If advancing reaches the end of the array (no valid cut point — defensive), keep all messages (no compaction).

- **Faithful serializer (Task 8).** Rewrite `messageToText` to mirror pi's `serializeConversation` (`utils.ts:109-160`): serialize assistant messages as up to three labeled sections (`[Assistant thinking]`, `[Assistant]`, `[Assistant tool calls]`), serialize tool results with `truncateForSummary(content, TOOL_RESULT_MAX_CHARS)` where `TOOL_RESULT_MAX_CHARS = 2000` and the marker is `\n\n[... ${truncatedChars} more characters truncated]`, and keep the `[User]`/`[Tool result]` bracket labels. This replaces our lossy single-line `Assistant:` serializer and adds the truncation that bounds the summarization token cost.

### No Breaking Changes

- Both changes are internal to `compactMessages()` and its helpers. The `CompactionResult` shape (`{ messages, tokensBefore, tokensAfter }`), the loop's `compaction_start`/`compaction_end` events, the manual `POST /api/sessions/:id/compact` route, and the auto-compaction trigger are all unchanged.
- The cut-point guard can only **grow** `recentMessages` (keep more, summarize less) — it never summarizes more than before, so it cannot orphan data that was previously kept. Worst case: a conversation that previously compacted now doesn't (because the only valid cut point is past the budget), which is correct behavior (no safe compaction possible).
- The serializer change affects only the text fed to the summarization LLM, not the persisted messages or the WS event stream.

## Capabilities

### New Capabilities

_(None.)_

### Modified Capabilities

- `agent-loop`: ADDS two requirements to the existing compaction capability — (1) the compaction cut-point SHALL never produce a `recentMessages` slice that starts with an orphaned `tool` message (mirrors pi `findValidCutPoints`); (2) the summarization serializer SHALL mirror pi's `serializeConversation` (three-section assistant serialization + tool-result truncation at `TOOL_RESULT_MAX_CHARS = 2000`). These are added as new requirements (not modifying the existing "Agent loop supports compaction" trigger requirement) so this change stays independent of the pending `agent-stream-message-correctness` change, which also touches that requirement — avoiding the last-to-archive-wins merge hazard.

## Impact

- **`packages/agent/src/compaction.ts`** — add the cut-point advancement loop after the walk-back; rewrite `messageToText` to the three-section + truncation form; add `TOOL_RESULT_MAX_CHARS` and `truncateForSummary` constants/helpers.
- **`packages/agent/src/__tests__/compaction-execution.test.ts`** (and/or `compaction.test.ts`) — add tests: (a) `recentMessages` never starts with a `tool` message across cut positions; (b) a `tool` message whose tool-call sits in the summarize window is not orphaned; (c) tool results > 2000 chars are truncated with the pi marker in the summarization text; (d) assistant thinking blocks and toolcall blocks appear in the summarization text (not dropped).
- **No DB / server / WS changes.** Fully confined to `packages/agent`.
- **Dependencies** — none new; against the pinned `@earendil-works/pi-ai@0.79.8` (not even needed — pure local text math).
- **Independence** — no dependency on `agent-stream-message-correctness`. Can be implemented and archived in either order.
