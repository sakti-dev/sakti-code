## Context

Our agent loop emits `message_start`/`message_end` only around the assistant LLM stream (`packages/agent/src/loop/index.ts:133,157`), and those events carry no payload (`types.ts:69-72`: bare `{type, timestamp}`). Verified against pi, which emits the lifecycle around **every** message entering the transcript and **carries the message**. Full evidence in `docs/plans/2026-06-20-agent-runtime-pi-alignment.md` (Task 11).

**pi's emit sites (all verified by reading the source):**
- **Prompt(s):** `agent-loop.ts:111-113` — `for (const prompt of prompts) { emit({type:"message_start", message:prompt}); emit({type:"message_end", message:prompt}); }`. Emitted after `agent_start`+`turn_start` (L108-109), before the inner run loop.
- **Pending/steer messages:** `:181-188` — a `for (const message of pendingMessages)` loop, each iteration `emit({type:"message_start", message}); emit({type:"message_end", message}); currentContext.messages.push(message); newMessages.push(message);`. This is the per-message loop (not batched) — pi wraps each pending message individually.
- **Assistant stream:** `:319` `emit({type:"message_start", message:{...partialMessage}})` on first delta; `:351` `emit({type:"message_start", message:{...finalMessage}})` if no deltas emitted before done; `:353`/`:366` `emit({type:"message_end", message:finalMessage})` on done/error.
- **Tool results:** `:746-747` `emitToolResultMessage` — `emit({type:"message_start", message:toolResultMessage}); emit({type:"message_end", message:toolResultMessage});` called for each finalized tool result.

**pi's `message` field:** every `message_start`/`message_end` carries `message: <the message object>`. This is load-bearing: a `message_start` without a payload tells the consumer nothing about *which* message is starting — useless for prompt/steer/tool-result cases where there's no delta stream to disambiguate.

**Our current code (the divergences):**
- `loop/index.ts:89` — `await injectMessage(messages, message)` (the prompt) with **no** `message_start`/`message_end` around it.
- `loop/index.ts:67-86` — `drainSteers` is `async (messages): Promise<boolean>`; it `shift`s and `injectMessage`s in a `while` loop, returns whether any steers ran. **No events emitted**, and it's a `Promise` (not a generator) so it *cannot* yield per-steer events.
- `loop/index.ts:133,157` — `message_start`/`message_end` emitted around the assistant stream, but **payload-less** (`evt("message_start")` with no second arg).
- `loop/tool-execution.ts` — emits `tool_execution_start/update/end` but **no** `message_start`/`message_end` around the `toolResult` message it constructs and persists.
- `types.ts:69-72` — `MessageStartEvent`/`MessageEndEvent` have no `message` field.

The change is confined to `packages/agent/src/loop/` and `packages/agent/src/types.ts`.

## Goals / Non-Goals

**Goals:**
- Every message that enters the transcript (prompt, each injected steer, each tool result message, each assistant message) is wrapped in a `message_start`/`message_end` pair — a single uniform message-boundary signal for consumers.
- Each such event carries the message payload, so a consumer knows *which* message the bracket refers to.
- The ordering of existing events is preserved; only new `message_start`/`message_end` pairs are inserted.

**Non-Goals:**
- **pi's partial-message pattern on assistant `message_start`** (`agent-loop.ts:319`: `{...partialMessage}` on first delta). pi emits an *evolving* partial message as the stream progresses, with `message_start` carrying the first partial. Our `message_update` events already carry the streaming deltas; replicating pi's partial-on-start would duplicate that signal and require threading the assembled partial through. Our assistant `message_start` carries the *initial* (pre-stream or empty) message context; the payload value we put there mirrors pi's `{...finalMessage}` at `:351` (the no-delta case) and `:366` (end). Documented divergence: we don't do pi's "partial on start" because `message_update` covers it.
- **pi's `AgentEventSink` abstraction** (a typed `emit` callback). Over-engineering for our single-consumer async-generator model. We keep `yield evt(...)`.
- **Restructuring the event taxonomy** (new event types, renaming). This change adds *emit sites* and a *payload field*; it does not add event types.
- **Emitting `message_start`/`message_end` around the compaction summary message** (the `[Session Summary]` user message injected by `compactMessages`). Compaction runs as a separate sub-loop (`compaction.ts`), not inside `runAgentLoop`; pi emits its own `compaction` events there. Our `compaction_start`/`compaction_end` events cover the boundary. The summary message is implementation detail of compaction, not a turn message. Out of scope.
- **Persisting `thinking` content blocks through the DB.** Unrelated (Change 1's follow-up). The assistant `message_start`/`message_end` here carry whatever the in-memory message has.

## Decisions

### 1. Payload field is `message?: AgentMessage` (optional, not required)

**Decision:** Add `message?: AgentMessage` to `MessageStartEvent` and `MessageEndEvent`. Optional. New emissions populate it; old persisted events and bare test constructions (`{type:"message_start", timestamp:0}`) typecheck without it.

**Rationale:** pi marks `message` required on these events. We mark it optional because (a) pre-change persisted events in any replay log lack it, and (b) `event-types.test.ts:53-54` constructs bare events — making it required breaks those and any consumer doing partial construction. Optional is additive and safe; the implementation always sets it. This mirrors the `stopReason?` optional-field decision in Change 1.

**Alternatives considered:**
- *Required, mirroring pi exactly.* **Rejected:** breaks existing tests and any hand-constructed events; no upside since every new emission sets it anyway.
- *Separate `MessageStartWithPayloadEvent` variant.* **Rejected:** needlessly splits the union; consumers would have to narrow. One optional field is simpler.

### 2. `drainSteers` becomes an async generator (to yield per-steer, like pi's per-message loop)

**Decision:** Change `drainSteers(messages): Promise<boolean>` to `async function* drainSteers(messages): AsyncGenerator<AgentEvent, boolean>`. It yields `message_start`/`message_end` (carrying the steer message) around each `injectMessage`. The generator's **return value** is the "had any steers" boolean (used by the loop to decide whether to `turnIndex++`/`continue`). The **three** call sites change from `await drainSteers(messages)` to `yield* drainSteers(messages)` — `yield*` forwards yielded events to the outer generator and evaluates to the inner generator's return value. (The three sites: line ~93 inside the while loop before the compaction check, line ~179 after a no-tool-call turn, line ~223 after tool execution — verified by grep `drainSteers(` in `index.ts`.)

**Rationale:** pi wraps each pending message individually in a `for` loop (`agent-loop.ts:181-188`), emitting `message_start`/`message_end` per message. To mirror that, `drainSteers` must emit per-steer, which requires it to be a generator (a `Promise` cannot yield mid-execution). The return-value-as-flag pattern preserves the existing "did we process any steers" semantics with zero behavioral change beyond the new events. This is the only structural change in the change; it's localized to `drainSteers` and its two callers.

**Alternatives considered:**
- *Keep `drainSteers` a Promise; have the loop emit one `message_start`/`message_end` pair around the whole batch.* **Rejected:** diverges from pi's per-message wrapping; defeats the purpose (a batch bracket doesn't tell the consumer how many steers or which messages).
- *Have the loop itself iterate the steer queue and emit per-steer (moving the queue iteration out of `drainSteers`).* **Rejected:** scatters the steer-handling logic across `drainSteers` and the loop; the generator approach keeps it encapsulated, matching pi's structure where the per-message loop is in the inner run loop.
- *Inline the steer queue into the main loop body.* **Rejected:** the steer queue is also consumed at the tool-execution drain site; factoring it out would duplicate logic.

### 3. Tool-result lifecycle lives in `tool-execution.ts` (matches pi's `emitToolResultMessage`)

**Decision:** In `packages/agent/src/loop/tool-execution.ts`, after constructing each `toolResult` message and before/after persisting it, `yield evt("message_start", {message: toolResult});` ... `yield evt("message_end", {message: toolResult});`. This mirrors pi's `emitToolResultMessage` (`agent-loop.ts:744-748`), which is called per finalized tool result. The existing `tool_execution_start/update/end` events (the *execution* lifecycle) are unchanged — this adds the *message* lifecycle for the resulting message specifically.

**Rationale:** pi distinguishes tool *execution* (`tool_execution_start/end` analogs) from tool-result *message* lifecycle (`message_start/end` on the `toolResult` message). The former tracks the tool running; the latter tracks the message entering the transcript. They're orthogonal and pi emits both. Colocating the message lifecycle in `tool-execution.ts` (where the `toolResult` message is built) matches pi's structure (`emitToolResultMessage` is called from `executeToolCalls`).

**Alternatives considered:**
- *Emit tool-result message lifecycle from the loop (`index.ts`) after `executeToolCalls` returns.* **Rejected:** the loop sees only the *list* of tool result messages after the fact (`toolExec.toolResultMessages`); it doesn't see them as they're built. Emitting after-the-fact would put `message_start`/`message_end` for all tool results in a burst at the end, losing the per-result interleaving with `tool_execution_end` that pi has.
- *Skip tool-result message lifecycle (only do prompt + steer + assistant).* **Rejected:** leaves a gap vs pi; a tool result is a persisted message and deserves the bracket like any other.

### 4. Assistant-stream `message_start`/`message_end` get the payload (no partial-message pattern)

**Decision:** The existing `message_start` (index.ts:133) and `message_end` (index.ts:157) around the assistant stream gain the payload: `message_start` carries the assistant message *as it starts streaming* (we emit it before the stream yields content, so it's the initial/empty assistant context — equivalent to pi's `{...finalMessage}` at `:351` for the no-delta case); `message_end` carries the final assistant message (the `streamResult.finalAssistant`).

**Rationale:** pi's `message_end` always carries `finalMessage` (`:353`, `:366`) — the consumer gets the complete message at the boundary. pi's `message_start` carries either the first partial (`:319`) or the final message if no deltas (`:351`). We do NOT replicate the partial-on-start pattern (see Non-Goals) because `message_update` carries the streaming signal. Our `message_start` carries the initial assistant message context; `message_end` carries the final. This is faithful to pi's *boundary* semantics (start = message begins, end = message complete with payload) without duplicating the streaming signal.

**Alternatives considered:**
- *Replicate pi's partial-message pattern exactly (`message_start` carries the evolving partial).* **Rejected:** duplicates `message_update`; requires threading the assembled partial through the stream consumer. YAGNI for our single-consumer model.

## Risks / Trade-offs

- **[More `message_start`/`message_end` pairs than before]** → **Accepted / intended:** every message now gets a bracket. Consumers that counted `message_start` events will see more. Verified no consumer does this (no UI exists; tests assert ordering, not counts, except `turnEnds.length` which is unaffected). Existing ordering assertions (`message_start` < `message_end` < `turn_end`) remain valid because the new pairs are inserted at the *start* of each phase (prompt before turn, steer before turn, tool result inside execution), not interleaved with the assistant-stream pair.
- **[`drainSteers` signature change is a refactor]** → **Mitigation:** localized to `packages/agent/src/loop/`; **three** call sites (verified: line ~93 pre-compaction, ~179 post-no-tool-call, ~223 post-tool-execution), all mechanical (`await` → `yield*`). The return-value-as-flag semantics are preserved (two sites use the boolean, one discards it). Covered by the existing drain tests + new per-steer event tests.
- **[`message?` optional field weakens the type contract]** → **Accepted:** the implementation always sets it; optional is for backward-compat with old/hand-constructed events. A future type-safety change could promote it to required once all construction sites are audited. Same tradeoff as Change 1's `stopReason?`.
- **[Tool-result `message_start` interleaves with `tool_execution_end`]** → **Accepted / pi-consistent:** pi emits `tool_execution_end`-analogs then `message_start`/`message_end` for the result (`executeToolCalls` calls `emitToolResultMessage` after the execution events). The ordering is `tool_execution_start` → `tool_execution_update`* → `tool_execution_end` → `message_start` → `message_end` per tool. Verified against pi's structure.

## Migration Plan

No migration. The change is event-stream-only: no schema, no persisted data (events are ephemeral), no WS wire-format change (events forwarded as-is inside `{type:"event", event, sessionId}`). The `message?` field is additive. `drainSteers`'s signature change is internal. Rollback is reverting the commits.

## Open Questions

- Should the assistant `message_start` carry an empty-content assistant message (current plan) or be deferred until the first delta (so `message_start` always carries real content)? **Decision: carry the initial context now** — pi emits `message_start` before any delta (`:319` on first delta, but the *event* precedes the delta's content in the stream; `:351` emits with final message if no deltas). The boundary semantics ("message started") are what matter; the content arrives via `message_update`. Deferring would diverge from pi's boundary placement.
- Should the prompt `message_start`/`message_end` be emitted before or after `agent_start`/`turn_start`? **Decision: after** — pi emits `agent_start`+`turn_start` first (L108-109), then the prompt lifecycle (L111-113). We mirror that: `agent_start` → `turn_start` → `message_start`(prompt) → `message_end`(prompt) → ... wait, our loop currently emits `turn_start` *inside* the while loop (per-turn), not once at the start. **Resolution:** emit the prompt `message_start`/`message_end` right after `agent_start` and before the while loop (matching pi's "prompt lifecycle before runLoop"), NOT inside the turn loop. The turn loop's `turn_start` then wraps each *turn's* assistant stream. This matches pi's structure (prompt lifecycle at L111-113 is before `runLoop` at L115; turn_start at L178 is inside runLoop).
