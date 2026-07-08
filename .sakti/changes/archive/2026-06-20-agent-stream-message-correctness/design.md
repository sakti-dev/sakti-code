## Context

A line-by-line comparison against pi's proven agent-core surfaced four verified correctness bugs at the stream→message boundary. They share one root cause — **the streaming layer discards data pi-ai reports instead of treating pi-ai's message as the source of truth** — and one of them (capturing `stopReason`/`errorMessage`) is the foundation two others depend on. Full evidence in `docs/plans/2026-06-20-agent-runtime-pi-alignment.md` (Tasks 1, 6, 4, 9); each line-verified against both codebases and pi-ai's type definitions.

**The pi-ai stream contract (the crux):** every stream event carries an assembled `partial: AssistantMessage`, and the stream terminates with either a `done` event (`event.message`: full `AssistantMessage`) or an `error` event (`event.error`: full `AssistantMessage` with `stopReason: "error"|"aborted"` + `errorMessage`). See pi-ai `types.d.ts`, `AssistantMessageEvent` union, and the contract comment: *"Streams should emit `start` before partial updates, then terminate with either: `done` carrying the final successful AssistantMessage, or `error` carrying the final AssistantMessage with stopReason 'error' or 'aborted' and errorMessage."* pi-ai's `AssistantMessage` has 12 fields: `role`, `content`, `usage`, `timestamp`, `stopReason`, `errorMessage`, `api`, `provider`, `model`, `responseModel`, `responseId`, `diagnostics`.

**pi's consumption of that contract** (`openspec/references/pi/packages/agent/src/agent-loop.ts:345-369`) is minimal and faithful — it never cherry-picks:

```ts
case "done":
case "error": {
    const finalMessage = await response.result();   // the WHOLE pi-ai message
    context.messages.push(finalMessage);            // stored verbatim
    await emit({ type: "message_end", message: finalMessage });
    return finalMessage;
}
```

The `error` case is handled **identically** to `done` — pi trusts the message pi-ai gives it, including for failures.

**Our current state (the divergences):**
- `streaming.ts:169` — `{ ...(thinkingLevel ? { thinkingLevel } : {}) }`. Wrong key (pi-ai reads `reasoning`), no `model.reasoning` gate (pi gates at `compaction.ts:537`).
- `streaming.ts:117-124` (the `done` case) — manually builds `{ role, content, usage, timestamp }`, **dropping** `stopReason`, `errorMessage`, and all attribution (4 of 12 fields kept).
- `streaming.ts:128` (the `error` case) — yields `error` event, `return { status: "error", finalAssistant: null }`. The pi-ai `event.error` message (which carries real `stopReason`/`errorMessage`) is **discarded**.
- `index.ts:188-194` — on `!streamResult.ok`, just `return`s; nothing persisted.
- `compaction.ts:57-76` (`estimateContextTokens`) — takes the last assistant's `usage` unconditionally; pi's `getAssistantUsage` skips `stopReason === "aborted"|"error"` (`compaction.ts:144-152`).
- `types.ts:24-28` — our `AssistantMessage` has only `content`/`role`/`timestamp`/`usage`. No `stopReason`, no `errorMessage`.
- `db/schema.ts` `messages` table + `session-store.ts` `agentMessageToRow` — relational; **drops** `stopReason`, `errorMessage`, AND `thinking` content blocks on persistence.

The change is confined to `packages/agent` and `packages/db`. It deliberately mirrors pi's "pi-ai message is the source of truth" pattern rather than continuing our cherry-pick/synthesize approach.

## Goals / Non-Goals

**Goals:**
- Make `thinkingLevel` actually enable reasoning, gated on model capability (the headline fix — currently a universal silent no-op, and currently ungated so it would send bad directives to non-reasoning models once the key is fixed).
- Treat pi-ai's `event.message`/`event.error` as the source of truth — preserve the whole `AssistantMessage` (all 12 fields) in-memory, exactly as pi does.
- Persist error/aborted turns so the transcript is a faithful record and resume/continue can see failures.
- Round-trip `stopReason`/`errorMessage` through the DB so (a) error turns survive reload and (b) `estimateContextTokens` can skip them as pi does.

**Non-Goals:**
- **Persisting attribution** (`api`/`provider`/`model`/`responseModel`/`responseId`/`diagnostics`) to the DB. Carried in-memory (faithful at the boundary) but not persisted — no consumer reads it, and `toPiMessages`'s placeholder fabrication on context reload is harmless. Promotion to DB columns deferred to a future attribution change if a consumer appears. (These fields ARE on the in-memory message — the only thing deferred is their DB persistence.)
- **Persisting `thinking` content blocks / `thinkingSignature` / `textSignature`.** Discovered during comparison: `agentMessageToRow` drops non-text assistant content. Same message-boundary family, distinct DB-serialization concern. **Trigger for a follow-up change `agent-message-persistence-fidelity`** — out of scope here, documented not dropped.
- **Strictening `stopReason` to pi's `StopReason` union.** Kept as `string` for now to avoid importing pi-ai's union into our message type; the `===` comparisons here only need `string`.
- **Event-lifecycle completeness** (message_start/end around prompts/steers/tool results — plan Task 11). Separate change `agent-loop-event-lifecycle`.

## Decisions

### 1. Reasoning option: rename to `reasoning` AND gate on `model.reasoning` (match pi `compaction.ts:537`)

**Decision:** In `streamSimple`'s options, pass `reasoning` (not `thinkingLevel`) **only when** `model.reasoning && thinkingLevel && thinkingLevel !== "off"`. Keep `AgentConfig.thinkingLevel` and the `thinking_level` per-session setting names unchanged — only the pi-ai boundary key + the capability gate change.

**Rationale:** Verified against pi-ai's `Model<TApi>` type: `reasoning: boolean` is a required field, and `getModelAny` (our model-resolver) returns the real pi-ai Model object that already carries it. pi-ai does NOT gate reasoning internally (confirmed: no `model.reasoning` check in `stream.js`/`base.js`), so the caller must gate — pi does exactly this at `compaction.ts:537` (`if (model.reasoning && thinkingLevel && thinkingLevel !== "off")`). Without the gate, fixing only the key would send `reasoning: "high"` to a non-reasoning model, which providers may reject. Our runner already normalizes `"off" → undefined` upstream (`runner.ts:102`), so the gate's `!== "off"` clause is belt-and-suspenders with pi.

**Alternatives considered:**
- *Rename `AgentConfig.thinkingLevel` to `reasoning` everywhere.* **Rejected:** breaks the `thinking_level` setting, the settings route, and the session DB column; pure cost.
- *Fix only the key, skip the gate.* **Rejected:** recreates pi's correctness only for reasoning-capable models and introduces provider-rejection risk for the rest; the gate is one cheap `&&`.

### 2. Preserve the WHOLE pi-ai message at the boundary — pi's `response.result()` pattern (merges Tasks 6 + 9)

**Decision:** In `streaming.ts`, the `done` handler maps **all** fields of `event.message` onto our `AssistantMessage` (content, usage, timestamp, stopReason, errorMessage, api, provider, model, responseModel, responseId, diagnostics). The `error` handler takes `event.error` — which pi-ai guarantees is a full `AssistantMessage` with `stopReason: "error"|"aborted"` — **as the final message verbatim** (no synthesis). Both return the message so the loop can persist it. Widen our `AssistantMessage` type to carry the fields.

**Rationale:** This is pi's actual pattern (`agent-loop.ts:345-369`: `const finalMessage = await response.result(); context.messages.push(finalMessage);`). pi never cherry-picks fields and never synthesizes an error message — it trusts pi-ai's contract that the `error` event already carries a complete `AssistantMessage`. Our v1 design (capture only `stopReason`; synthesize `{ stopReason: "error", content: errText, usage: 0 }`) was **more work and less faithful** than pi's approach — it duplicated what pi-ai already provides and lost attribution. Mapping all fields is simpler, faithful, and gives us `stopReason` (needed by T4) and `errorMessage` (needed for error display) for free.

**Alternatives considered:**
- *Cherry-pick `stopReason` only, synthesize error messages (v1).* **Rejected:** more code than pi, less faithful, drops attribution, and the synthesis duplicates pi-ai's `errorMessage`.
- *Make our `AgentMessage.AssistantMessage` literally re-export pi-ai's type.* **Rejected:** pi-ai's `AssistantMessage` marks `stopReason` required; our DB rows predate this change and deserialize without it, so an optional field is required for safe round-tripping. We mirror the field set but keep our own type.

### 3. `stopReason` and `errorMessage` get REAL DB columns; attribution is in-memory only (pragmatic pi-fidelity)

**Decision:** Add nullable `stopReason` and `errorMessage` columns to the `messages` table; round-trip them in `session-store.ts`. Attribution fields (`api`/`provider`/`model`/`responseModel`/`responseId`/`diagnostics`) are carried on the **in-memory** `AssistantMessage` (faithful at the boundary + to pi-ai's type) but **not persisted** — `toPiMessages` fabricates harmless placeholders on context reload, as it does today.

**Rationale:** `stopReason` is consumed (T4 compaction skip; future error UI) and must survive reload to be meaningful — it needs a real column. `errorMessage` is the error turn's content and likewise should survive. Attribution has zero consumers; adding 6 nullable columns (or a metadata JSON blob) for data nothing reads is YAGNI. pi persists everything because for pi it's free (object storage); our relational schema makes each field a schema decision, so we persist what's consumed and document the rest as deferred. This is the pragmatic pi-faithful line: faithful where it matters (boundary + consumed fields), minimal where it doesn't.

**Alternatives considered:**
- *Add a nullable `metadata` JSON column capturing all attribution losslessly.* **Rejected:** genuinely lossless and pi-faithful, but stores data with no reader and adds a non-queryable blob; revisit if attribution becomes a feature.
- *Persist all attribution as real columns.* **Rejected:** 6 migrations for unconsumed data.

### 4. Error/abort persists the pi-ai message AND still emits the live `error` event

**Decision:** In the loop, when a stream result is non-OK but carries a `finalAssistant` (the pi-ai error/aborted message), push it and `store.appendMessage()` it **before** terminating. The streaming layer still yields the `error` event (so live UIs get the immediate signal). `StreamResult`'s non-OK variant gains the `finalAssistant` so the loop can persist it.

**Rationale:** Matches pi (`agent-loop.ts:196` pushes the failure message into the transcript). Keeping the live `error` event preserves current consumer behavior — the persisted message is additive. The `stopReason` on the persisted message is exactly what `estimateContextTokens` (Task 4) needs to skip it.

**Alternatives considered:**
- *Emit only the `error` event; persist a synthetic user-role "system note".* **Rejected:** invents a message shape pi doesn't use and pollutes the user transcript; the pi-ai error `AssistantMessage` is the proven representation.

### 5. `estimateContextTokens` skip rule keys off `stopReason`, not a zero-usage proxy (pi `getAssistantUsage`)

**Decision:** In `estimateContextTokens` (`compaction.ts`), when scanning back for the most recent usable assistant, `continue` past any assistant with `stopReason === "error" || stopReason === "aborted"`. Keep the existing `usageTokens > 0` guard as a secondary check. This is pi's `getAssistantUsage` exactly: `if (assistantMsg.stopReason !== "aborted" && assistantMsg.stopReason !== "error" && assistantMsg.usage) return assistantMsg.usage;`.

**Rationale:** This is why T4 is bundled HERE rather than in the compaction-safety change — the substantive fix depends on T6+T9 landing `stopReason`. A zero-usage proxy (the interim hack) mis-skips legitimately-zero-usage turns and is brittle; checking `stopReason` is exact and matches pi.

**Alternatives considered:**
- *Keep the zero-usage proxy; ship T4 in the compaction change.* **Rejected:** ships a known-imprecise check to avoid bundling; the dependency is real and verified.

## Risks / Trade-offs

- **[Persisted error messages change the transcript shape]** → **Mitigation:** additive (an `assistant` message with text content + optional `stopReason`/`errorMessage`). `loadMessages` consumers see one extra message where they previously saw none; verified by re-running the full agent + db + server suites. New DB columns are nullable — no destructive migration, no backfill needed.
- **[Reasoning now actually runs → latency/token cost for `thinking_level: "high"` sessions]** → **Accepted / expected:** that is the *intended* behavior the setting was supposed to enable. Default stays `"off"`, so no session changes behavior unless it opted in. Flagging explicitly because "fixing" a silent no-op is, by definition, a behavior change.
- **[`stopReason` typed as `string`, not pi's union]** → **Accepted for now:** strictening is a future type-safety change; `string` is sufficient for the `===` comparisons here and avoids importing pi-ai's union into our message type.
- **[Attribution not persisted → not byte-for-byte pi-faithful]** → **Accepted:** documented Non-Goal. Faithful at the boundary (in-memory carries all fields) and for consumed fields; the only divergence is unconsumed attribution data, deferred with rationale. No silent drop.
- **[Error message content could leak transport details]** → **Mitigation:** we use pi-ai's own `errorMessage` verbatim — no new surface area beyond what the live `error` event already exposes.

## Migration Plan

No destructive migration. New nullable columns `stop_reason`/`error_message` are added to `messages`; existing rows have NULL, which round-trips to `undefined`, which:
- `estimateContextTokens` treats as "usable" (falls through to the usage check) — correct, since pre-change rows were never error/aborted in the new sense.
- Consumers that never read these fields are unaffected.

Drizzle handles the additive columns; the existing init/migration path applies them on next open. Rollback is reverting the commits — the optional fields, columns, and the rename are all self-contained.

## Open Questions

- Should we add a `compaction_skipped` event when `estimateContextTokens` skips an error/aborted turn, for observability? **Decision: no** — the skip is silent and cheap; observability belongs in the future `agent-loop-event-lifecycle` change. Noted so it's not re-litigated.
- Should provider metadata be persisted alongside `stopReason`? **Decision: no for now** — see Decision 3; deferred with rationale, not silently dropped.
- The discovered `thinking`-content-persistence bug (`agentMessageToRow` drops non-text blocks + `thinkingSignature`) — **this change does NOT fix it**; it is the documented trigger for a follow-up `agent-message-persistence-fidelity` change. Surfacing it here so it isn't lost.
