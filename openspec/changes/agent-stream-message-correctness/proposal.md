## Why

A cross-reference against pi's proven agent-core (`openspec/references/pi/`) surfaced a cluster of bugs at the **stream→message boundary**: the agent loop silently drops data that pi-ai reports and that pi preserves. The headline defect — `thinkingLevel` is passed to `streamSimple` under the wrong field name (`thinkingLevel` instead of `reasoning`) — means **reasoning/extended thinking is never enabled for any session**, so every `thinking_level: "high"` setting is a silent no-op. Around it, `stopReason` and provider metadata are dropped from persisted `AssistantMessage`s, error/aborted turns are not persisted at all, and the compaction token estimate keys off garbage usage after an errored turn. These are all verified correctness bugs (file:line citations in `docs/plans/2026-06-20-agent-runtime-pi-alignment.md`, Tasks 1/6/4/9), and this change bundles them because they share a root cause and an internal dependency: capturing `stopReason` on the message (Task 6) is the foundation that the error-usage skip (Task 4) and error-persistence (Task 9) build on.

## What Changes

- **Fix the thinking-level field mapping (Task 1).** `streaming.ts:169` passes `{ thinkingLevel }` to pi-ai's `streamSimple`, but pi-ai's `SimpleStreamOptions` field is `reasoning?: ThinkingLevel` (`types.d.ts:147-148`). Rename the option key so reasoning/thinking actually engages. Verified against pi (`agent-loop.ts:232` threads it as `config.reasoning`).
- **Preserve `stopReason` on `AssistantMessage` (Task 6).** Add an optional `stopReason?: string` field to the `AssistantMessage` type and capture it from the stream's `done` event in the streaming layer. Currently only `content`/`usage`/`timestamp` survive — `stopReason` (and provider metadata) is dropped, breaking retry decisions, cost/provider attribution, and the ability to detect error/aborted turns downstream.
- **Skip error/aborted usage in `estimateContextTokens` (Task 4).** Once `stopReason` is on the message, the auto-compaction token estimate can — like pi's `getAssistantUsage` (`compaction.ts:128-135`) — skip assistants with `stopReason === "error"|"aborted"` instead of keying off their stale/garbage usage.
- **Persist error/aborted turns as an `AssistantMessage` (Task 9).** When the LLM stream errors or aborts, materialize an assistant message (`stopReason: "error"|"aborted"`, the error text as content, zeroed usage) and persist it to the store — matching pi's `agent-loop.ts:196`. Today the loop emits a bare `error` event and persists nothing, breaking retry/continue continuity.

### No Breaking Changes

All four changes are additive or behavior-correcting:
- `AssistantMessage.stopReason?` is optional; existing consumers and DB rows without it continue to work (it deserializes to `undefined`).
- The `reasoning` field rename is internal to the `streamSimple` call; the WS event contract and message shapes are unchanged.
- Persisting an error assistant message is net-new behavior that existing consumers already handle (an `assistant` message with text content + a `stopReason` they may ignore).

## Capabilities

### New Capabilities

_(None.)_

### Modified Capabilities

- `agent-loop`: the existing "Agent loop streams LLM responses" requirement is widened — the persisted `AssistantMessage` SHALL carry `stopReason`; the "Agent loop supports compaction" requirement's `estimateContextTokens` behavior is corrected to skip error/aborted turns. Added requirement for error/abort persistence.
- `thinking-level-config`: the "Thinking level is passed to LLM streaming" requirement's implementation is corrected — the level SHALL be threaded as `reasoning`, not `thinkingLevel`.

## Impact

- **`packages/agent/src/loop/streaming.ts`** — rename `thinkingLevel`→`reasoning` in the `streamSimple` options spread; capture `stopReason` (and `errorMessage` if present) in the `done`/`error` handlers; build an error/aborted `AssistantMessage` on stream failure.
- **`packages/agent/src/types.ts`** — add `stopReason?: string` to `AssistantMessage`.
- **`packages/agent/src/compaction.ts`** — `estimateContextTokens` skips assistants with `stopReason === "error"|"aborted"`.
- **`packages/agent/src/loop/index.ts`** — on stream failure, if an error/aborted `finalAssistant` was built, persist it via `store.appendMessage` before terminating.
- **Tests** — new agent-package tests for: reasoning field actually passed (Task 1); `stopReason` carried on the message (Task 6); error/aborted usage skipped in token estimate (Task 4); error assistant message persisted (Task 9). Existing agent tests remain green (currently 72 passing).
- **Dependencies** — none new. All within `packages/agent/` against the pinned `@earendil-works/pi-ai@0.79.8`.
- **Scope boundary** — this change does NOT add provider metadata (`api`/`provider`/`model`) fields, split-turn compaction, or event-lifecycle changes; those are separate changes in the alignment plan. It deliberately stops at `stopReason` because that's the field Task 4/9 actually need.
