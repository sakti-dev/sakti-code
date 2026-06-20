## Context

A cross-reference against pi's proven agent-core (`openspec/references/pi/packages/agent/`) surfaced four verified correctness bugs at the stream→message boundary. They cluster here because they share a root cause — the streaming layer discards data pi-ai actually reports — and because one of them (capturing `stopReason`) is the foundation two others depend on. Full evidence in `docs/plans/2026-06-20-agent-runtime-pi-alignment.md` (Tasks 1, 6, 4, 9); each line-verified against both codebases.

The current state:
- `packages/agent/src/loop/streaming.ts:169` spreads `{ thinkingLevel }` into `streamSimple`'s options. pi-ai's `SimpleStreamOptions` (`node_modules/.bun/@earendil-works+pi-ai@0.79.8*/dist/types.d.ts:147-148`) has field `reasoning?: ThinkingLevel`, not `thinkingLevel` — so reasoning is silently never enabled. pi threads it as `config.reasoning` (`agent-loop.ts:232`).
- `streaming.ts:118-127` builds the final `AssistantMessage` from the stream's `done` event keeping only `content`, `usage`, `timestamp`. `stopReason` (and `errorMessage`) are dropped. `AssistantMessage` (`types.ts:27-31`) has no `stopReason` field at all.
- `compaction.ts:57-66` `estimateContextTokens` (added in the `agent-auto-compaction` change) uses the last assistant message's usage unconditionally. pi's `getAssistantUsage` (`compaction.ts:128-135`) skips `stopReason === "aborted"|"error"`.
- On stream error/abort, `streaming.ts:128` emits a bare `error` event and the loop (`index.ts:155-163`) persists nothing — the errored turn leaves no trace. pi (`agent-loop.ts:196`) materializes an error `AssistantMessage` into the transcript.

The agent package is pure (no env/DB access) and all four fixes are confined to `packages/agent/`.

## Goals / Non-Goals

**Goals:**
- Make `thinkingLevel` actually enable reasoning (the headline fix — currently a universal silent no-op).
- Capture `stopReason` on `AssistantMessage` so downstream code (compaction, retry, attribution) can tell a successful turn from an errored/aborted one.
- Make `estimateContextTokens` skip error/aborted turns so the compaction threshold isn't keyed off garbage usage.
- Persist errored/aborted turns as assistant messages so the transcript reflects reality and resume/continue works.

**Non-Goals:**
- **Provider metadata fields (`api`/`provider`/`model`).** The plan's Task 7 catalog mentions these, but Task 4 and Task 9 only need `stopReason`. Adding unused fields is scope creep; deferred to a future attribution change.
- **Event-lifecycle completeness** (message_start/end around prompts/steers/tool results — plan Task 11). Separate change (`agent-loop-event-lifecycle`); touches the same loop file but a different concern.
- **Split-turn compaction, summary chaining, file-ops tracking.** Separate deferred changes in the alignment plan.
- **WS contract changes.** The events and wire format are unchanged; consumers that ignore `stopReason` continue to work.

## Decisions

### 1. Field rename: `thinkingLevel` → `reasoning` (internal to the `streamSimple` call)

**Decision:** Change only the key in the options spread at `streaming.ts:169` (`...(thinkingLevel ? { reasoning: thinkingLevel } : {})`). Keep the `AgentConfig.thinkingLevel` and per-session setting names unchanged — those are our public API; only the pi-ai boundary key is wrong.

**Rationale:** This is a pure mechanical fix verified against pi-ai's type definitions. Renaming the config field would be a breaking change to the settings routes and session row with no benefit.

**Alternative considered:** Rename `AgentConfig.thinkingLevel` to `reasoning` everywhere. **Rejected:** breaks the `thinking_level` per-session setting, the settings route, and the session DB column; pure cost.

### 2. `stopReason` as an OPTIONAL field on `AssistantMessage`

**Decision:** Add `stopReason?: string` to `AssistantMessage` (`types.ts`). Capture it from the `done` event's `event.message.stopReason`. Optional, not required.

**Rationale:** Existing DB rows and any hand-constructed test messages don't have it; making it required breaks deserialization and tests. Optional is additive and safe. pi's `AssistantMessage` carries it as a required `StopReason` union, but we type it loosely (`string`) for now — strictening to a union is a separate type-safety change.

**Alternative considered:** A separate `TranscriptEntry` wrapper carrying metadata alongside the message. **Rejected:** over-engineered for what Task 4/9 need (one field on the existing message); pi keeps it directly on the message.

### 3. Error/abort produces a persisted assistant message, not just an event

**Decision:** In the streaming layer's `error` handler, build a `finalAssistant` with `stopReason: "error"` (or `"aborted"` when the abort signal fired mid-stream), content = the error message text, and zeroed usage. In the loop, if a stream result carries such a `finalAssistant`, persist it via `store.appendMessage` before terminating. Emit the `error` event too (so live UIs still get the immediate signal).

**Rationale:** Matches pi's `agent-loop.ts:196`. The transcript becomes a faithful record (a future resume/continue can see the failure), and the `stopReason` on the persisted message is exactly what `estimateContextTokens` (Task 4) needs to skip it.

**Alternative considered:** Emit only the error event, persist a synthetic `user`-role "system note" message. **Rejected:** invents a new message shape pi doesn't use and pollutes the user transcript; an assistant message with `stopReason: "error"` is the proven representation.

### 4. `estimateContextTokens` skip rule keys off `stopReason`, not a zero-usage proxy

**Decision:** After Task 6 lands `stopReason`, `estimateContextTokens` checks `m.stopReason === "error" || m.stopReason === "aborted"` explicitly and continues scanning. Keep the existing `usageTokens > 0` guard as a secondary fallback.

**Rationale:** This is why Task 4 is bundled in THIS change rather than the compaction-safety change — the substantive fix depends on Task 6. A zero-usage proxy (the interim hack noted in the plan) mis-skips legitimately-zero-usage turns and is brittle. Checking `stopReason` is exact and matches pi.

**Alternative considered:** Keep the zero-usage proxy, ship Task 4 in the compaction change. **Rejected:** ships a known-imprecise check just to avoid bundling; the dependency is real.

### 5. Abort detection in the error path uses the caller's `signal`

**Decision:** When the loop detects `signal?.aborted` after a failed stream, set the persisted message's `stopReason` to `"aborted"` rather than `"error"`. If the stream itself reported an error (not an abort), use `"error"`.

**Rationale:** Distinguishes "the LLM/transport failed" from "the user aborted" — both are non-success, but they mean different things for retry vs resume. pi tracks this distinction via the stream's stop reason.

## Risks / Trade-offs

- **[Persisted error messages change the transcript shape]** → **Mitigation:** additive (`assistant` message with text content + an optional `stopReason` consumers may ignore). Existing `loadMessages` consumers see one extra message where they previously saw none; verified by re-running the full agent + server suites. No DB migration (the column set for an assistant message is unchanged; `stopReason` rides in the existing serialized content/usage blob if at all, or is simply dropped on rows written before this change — they get `undefined`, which the skip rule treats as "use it").
- **[Reasoning now actually runs → latency/token cost increase for sessions with `thinking_level: high`]`** → **Accepted / expected:** that's the *intended* behavior the setting was supposed to enable. Default remains `"off"` (per-session setting default), so no session changes behavior unless it opted in. Flagging explicitly because "fixing" a silent no-op is, by definition, a behavior change.
- **[stopReason type loosened to `string`]`** → **Accepted for now:** strictening to pi's `StopReason` union is a future type-safety change; `string` is sufficient for the `===` comparisons here and avoids importing pi-ai's union into our message type.
- **[Error message content in the assistant message could leak transport details]** → **Mitigation:** use the same error message text we already emit in the `error` event (`event.error?.errorMessage ?? "LLM error"`); no new surface area.

## Migration Plan

No deployment migration needed. Existing DB rows without `stopReason` deserialize to `undefined`, which:
- `estimateContextTokens` treats as "usable" (falls through to the usage check) — correct, since pre-change rows were never error/aborted in the new sense.
- Consumers that never read `stopReason` are unaffected.

Rollback is reverting the commits; the optional field and the rename are both self-contained.

## Open Questions

- Should we add a `compaction_skipped` event or similar when `estimateContextTokens` skips an error/aborted turn, for observability? **Decision for this change: no** — the skip is silent and cheap; observability belongs in a future event-lifecycle change. Noted here so it's not re-litigated.
- Should provider metadata (`api`/`provider`/`model`) be added to `AssistantMessage` now alongside `stopReason`? **Decision: no** — no current consumer needs it (attribution is a separate concern); adding unused fields is scope creep. Explicitly listed as a Non-Goal.
