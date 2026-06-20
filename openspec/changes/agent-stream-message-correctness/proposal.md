## Why

A line-by-line comparison against pi's proven agent-core (`openspec/references/pi/`) surfaced a cluster of correctness bugs at the **stream→message boundary**. They share a single root cause — **the streaming layer discards data pi-ai actually reports, instead of treating pi-ai's message as the source of truth the way pi does** — and one of them (capturing `stopReason` on the message) is the foundation two others build on. Every divergence below is verified against both codebases with file:line citations in `docs/plans/2026-06-20-agent-runtime-pi-alignment.md` (Tasks 1/6/4/9) and the pi-ai type definitions.

The four verified defects:

1. **`thinkingLevel` is passed under the wrong key AND ungated.** `streaming.ts:169` spreads `{ thinkingLevel }` into `streamSimple`, but pi-ai's `SimpleStreamOptions` field is `reasoning?: ThinkingLevel` (`types.d.ts:147-148`) — so reasoning/thinking is **never enabled for any session**; every `thinking_level: "high"` is a silent no-op. Pi additionally gates the option on `model.reasoning` (`compaction.ts:537`): `if (model.reasoning && thinkingLevel && thinkingLevel !== "off")`. We do neither.

2. **The streaming layer cherry-picks 4 of pi-ai's 12 `AssistantMessage` fields.** pi-ai's stream contract terminates with either a `done` event carrying the full final `AssistantMessage` (`event.message`) or an `error` event carrying the full final `AssistantMessage` (`event.error`, with `stopReason: "error"|"aborted"` + `errorMessage`) — *every* stream event also carries an assembled `partial` message (`types.d.ts`, `AssistantMessageEvent` union). pi simply does `messages.push(await response.result())` (`agent-loop.ts:345-369`) and keeps the whole object. We manually build `{ role, content, usage, timestamp }` and **drop** `stopReason`, `errorMessage`, and all attribution (`api`, `provider`, `model`, `responseModel`, `responseId`, `diagnostics`).

3. **Error/aborted turns are not persisted at all.** On a stream error our loop (`streaming.ts:128` → `index.ts:189`) emits a bare `error` event and `return`s, leaving no trace in the transcript. pi's `agent-loop.ts:196` pushes the error `AssistantMessage` (stopReason `"error"`/`"aborted"`, the error text, zeroed usage) so the transcript is a faithful record and resume/continue can see the failure.

4. **`estimateContextTokens` keys off garbage usage after a failed turn.** pi's `getAssistantUsage` (`compaction.ts:144-152`) explicitly skips assistants with `stopReason === "aborted" || stopReason === "error"`. Ours (`compaction.ts:57-76`) takes the last assistant's `usage` unconditionally — once (1)–(3) land `stopReason`, we can skip stale/failed-turn usage exactly as pi does.

These are bundled because they share a root cause and an internal dependency: (2) capturing `stopReason`/`errorMessage` is what makes both (3) error-persistence and (4) usage-skip possible.

## What Changes

- **Gate + rename the reasoning option (Task 1).** `streamLLMResponse` already receives the pi-ai `model` (which exposes `reasoning: boolean`, verified in `types.d.ts`). Pass `reasoning` (not `thinkingLevel`) to `streamSimple`, **only when `model.reasoning && thinkingLevel && thinkingLevel !== "off"`** — pi's exact gate (`compaction.ts:537`). Our `AgentConfig.thinkingLevel` and the `thinking_level` setting name are unchanged; only the pi-ai boundary key + the capability gate change.

- **Preserve the whole pi-ai message at the stream boundary (merges Tasks 6 + 9).** In the `done` handler, build the final `AssistantMessage` by mapping **all** fields pi-ai reports on `event.message` (content, usage, timestamp, stopReason, errorMessage, api, provider, model, responseModel, responseId, diagnostics) instead of cherry-picking four. In the `error` handler, treat `event.error` (which pi-ai guarantees is a full `AssistantMessage` with `stopReason: "error"|"aborted"`) **as the final message** — do not synthesize one. Return it from `streamLLMResponse` so the loop can persist it. Widen our `AssistantMessage` type to carry these fields. This is pi's `messages.push(response.result())` pattern (`agent-loop.ts:345-369`): the pi-ai message is the source of truth, not a template we hand-fill.

- **Persist error/aborted turns (Task 9, loop side).** In the loop, when a stream result carries a non-OK `finalAssistant` (stopReason `"error"`/`"aborted"`), push + `store.appendMessage()` it before terminating — in addition to (not instead of) yielding the `error` event for live consumers. Matches pi's `agent-loop.ts:196`.

- **Persist `stopReason`/`errorMessage` through the DB (prerequisite for Task 9).** The DB is relational (`packages/db/src/schema.ts` `messages` table), and `session-store.ts`'s `agentMessageToRow` currently drops `stopReason`/`errorMessage` (and `thinking` content blocks). Add `stopReason` and `errorMessage` columns and round-trip them, so an error/aborted turn survives a reload and `estimateContextTokens` sees the real `stopReason`.

- **Skip error/aborted usage in `estimateContextTokens` (Task 4).** Mirror pi's `getAssistantUsage`: skip assistants whose `stopReason` is `"error"` or `"aborted"`; keep the existing char/4 fallback.

### No Breaking Changes

- `AssistantMessage` gains optional fields (`stopReason`, `errorMessage`, attribution); existing rows/messages without them deserialize to `undefined`, which the skip rule and consumers treat correctly. `stopReason` is kept **optional** in our type (pi-ai marks it required) only because pre-change DB rows lack it — newly written messages always carry it.
- The `reasoning` key + gate are internal to the `streamSimple` call; the WS event contract and `thinking_level` setting are unchanged.
- Persisting an error assistant message is net-new behavior that existing consumers already handle (an `assistant` message with text content).
- Fixing a silent no-op (`thinkingLevel`) is, by definition, a behavior change for sessions that opted into `thinking_level: "high"` — that is the intended effect, flagged explicitly.

### Discoveries During pi-Comparison (deferred, not silently dropped)

- **`agentMessageToRow` drops `thinking` content blocks** (and pi-ai's `thinkingSignature`/`textSignature`) on persistence — non-text assistant content is silently lost on reload. Same message-boundary family, but a distinct DB-serialization concern. Recommend a **separate follow-up change `agent-message-persistence-fidelity`** as the trigger; out of scope here.
- **Attribution persistence** (`api`/`provider`/`model`/`responseModel`/`responseId`/`diagnostics`): carried on the **in-memory** message (faithful at the boundary) but **not persisted** to the DB — rationale: no current consumer, and `toPiMessages` fabricates harmless placeholder values on context reload. Adding speculative DB columns is YAGNI; promotion to real columns deferred to a future attribution change if a consumer appears.

## Capabilities

### New Capabilities

_(None.)_

### Modified Capabilities

- `agent-loop`: the "Agent loop streams LLM responses" requirement is rewritten — the persisted `AssistantMessage` SHALL be the pi-ai message (carrying `stopReason`, `errorMessage`, and attribution), and error/aborted turns SHALL be persisted; the "Agent loop supports compaction" requirement's `estimateContextTokens` is corrected to skip `stopReason === "error"|"aborted"` (pi's `getAssistantUsage`).
- `thinking-level-config`: the "Thinking level is passed to LLM streaming" requirement is corrected — the level SHALL be threaded as `reasoning`, gated on `model.reasoning`, matching pi.

## Impact

- **`packages/agent/src/loop/streaming.ts`** — `done` handler maps all pi-ai `event.message` fields; `error` handler takes `event.error` as the final message (no synthesis); `streamSimple` options gain the gated `reasoning` key; `toPiMessages` passes through preserved fields instead of fabricating `"stop"/"openai-completions"/"openai"/"unknown"`.
- **`packages/agent/src/types.ts`** — `AssistantMessage` gains optional `stopReason`, `errorMessage`, `api`, `provider`, `model`, `responseModel`, `responseId`, `diagnostics`.
- **`packages/agent/src/compaction.ts`** — `estimateContextTokens` skips `stopReason === "error"|"aborted"` (pi `getAssistantUsage`).
- **`packages/agent/src/loop/index.ts`** — on non-OK `finalAssistant`, push + `store.appendMessage()` before terminating; `StreamResult` carries the error/aborted message.
- **`packages/db/src/schema.ts`** + **`packages/db/src/session-store.ts`** — new nullable `stopReason`/`errorMessage` columns + round-trip (no destructive migration; columns are nullable).
- **Tests** — agent-package: reasoning gate (T1), whole-message preservation incl. error message (T6+T9), usage skip (T4); db-package: stopReason/errorMessage round-trip. Existing suites remain green (agent 72, db 23, server suites unchanged).
- **Scope expansion note** — this change spans `packages/agent` and `packages/db`; the v1 proposal scoped it to `packages/agent` only, which was incorrect because T9 cannot persist `stopReason` without the DB round-trip.
- **Dependencies** — none new; all against the pinned `@earendil-works/pi-ai@0.79.8`.
