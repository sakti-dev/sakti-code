## Context

The agent loop in `packages/agent/src/loop/index.ts` is a self-contained async generator. Its main spec already mandates compaction ("The agent SHALL check after each LLM response whether the context window is near capacity..."), but the check was never implemented — the loop has no call to `shouldCompact` or `compactMessages`. The only working compaction path is the manual `POST /api/sessions/:id/compact` route (`apps/server/src/routes/compaction.ts`), which calls `compactMessages()` on demand.

Three pieces already exist and are proven by the manual route:
- `compactMessages(options)` in `packages/agent/src/compaction.ts` — summarizes old messages via `completeSimple`, keeps ~`keepRecentTokens` of recent context, returns `{ messages, tokensBefore, tokensAfter }`. Gracefully returns the original messages on `stopReason: "error"`/`"aborted"`, and short-circuits (no LLM call) when there's nothing to cut (`cutIndex <= 1`).
- `shouldCompact(tokens, contextWindow, reserveTokens)` — pure threshold check.
- `estimateTokens(messages)` — rough chars/4 estimate.
- `CompactionStartEvent` / `CompactionEndEvent` already exist in the `AgentEvent` union and the WS layer forwards all events — so no protocol change is needed to surface compaction to the UI.

The agent package is pure: no `process.env` access, no DB. So any API key must be passed in via `AgentConfig`. The manual route resolves the key with `getEnvApiKey(provider)` where `provider` comes from the project's model config — this change reuses that exact pattern.

The in-progress `agent-loop-controls` change plumbs the `auto_compaction` per-session setting (`session:{id}:auto_compaction`, default `"false"`) and passes `autoCompaction` to `createAgentLoop`. That toggle is forward-compatible scaffolding with no behavior behind it today; this change consumes it.

## Goals / Non-Goals

**Goals:**
- Make the loop's existing "supports compaction" spec requirement true: a turn-level check that summarizes the context when it approaches the window limit.
- Gate it on `AgentConfig.autoCompaction` (default `off`), sourced from the `auto_compaction` per-session setting.
- Reuse `compactMessages` / `shouldCompact` / `estimateTokens` verbatim — no new summarization logic, no duplicate prompt engineering.
- Emit `compaction_start` / `compaction_end` events so the UI shows what happened.
- Plumb an `apiKey` through `AgentConfig` so the loop can make the summarization call without gaining env access.

**Non-Goals:**
- A separate/cheaper model for summarization — use the session's resolved model (same as the manual route). Switching to a cheaper summarization model is a future tuning decision.
- Manual compaction changes — `POST /api/sessions/:id/compact` is unchanged and works regardless of the `auto_compaction` setting.
- Persisting compaction history / undo — once messages are replaced, the old history is gone (same as the manual route's semantics).
- Adaptive threshold tuning — use the existing `reserveTokens` (16,000) / `keepRecentTokens` (20,000) defaults already on `AgentConfig`.

## Decisions

### 1. Check at the top of the turn loop, before sending to the LLM

**Decision:** The compaction check runs at the top of the `while(true)` turn loop, after draining steer messages and before `yield evt("turn_start")`. This is the natural "before sending to the LLM" point.

**Rationale:** The main spec says "check after each LLM response" — but compaction is only useful *before* the next expensive send (it shrinks the context so the upcoming LLM call fits). Checking at the top of the loop is equivalent to "after the previous turn's response, before the next turn's send," which matches the intent while avoiding sending an oversized context that would overflow.

**Alternative considered:** check immediately after `message_end` / before tool execution. **Rejected:** tool execution can add more messages; checking before tool exec could compact and then immediately re-grow. The top-of-loop placement gives the compaction the full turn's worth of new messages to evaluate and a clean boundary.

### 2. Gate on `autoCompaction`, default off

**Decision:** `AgentConfig.autoCompaction` (optional, default `undefined` → treated as `false`). The check only runs when `true`. The default is off to avoid surprising users with automatic summarization of their conversation; they opt in via `PATCH /api/sessions/:id/settings { auto_compaction: true }`.

**Rationale:** Auto-compaction discards verbatim history (replacing it with a summary). That's desirable for long-running sessions but unexpected if it happens silently. Defaulting off matches the `agent-loop-controls` setting default (`"false"`) and keeps existing sessions behaving identically. Manual compaction remains available regardless.

### 3. `apiKey` resolved by the runner, passed via `AgentConfig`

**Decision:** Add `apiKey?: string` to `AgentConfig`. `runPrompt` resolves it exactly like the manual route does — `getEnvApiKey(config?.provider ?? "")` from the project's `ModelConfigRepo.getForProject()` — and passes it to `createAgentLoop`. The agent package stays pure (no `process.env`).

**Alternative considered:** resolve the key lazily inside `compactMessages` by passing a provider string. **Rejected:** that would push env access into `packages/agent`, violating the "agent package is pure" boundary (AGENTS.md). The key is a runtime dependency best resolved at the server layer where the model config lives.

### 4. Graceful skip when key is missing

**Decision:** If `autoCompaction` is `true` but `apiKey` is absent/empty, the loop **skips compaction silently** for that turn (no event, no error) and continues. The next turn re-evaluates.

**Rationale:** Auto-compaction is a background optimization. A missing key must not kill a running conversation. Contrast with the manual `/compact` route, which returns HTTP 500 "No API key for {provider} in env" — that's appropriate for an explicit user action but wrong for an automatic background step. If the key is later configured, the next turn's check picks it up.

### 5. Compaction failure does not break the loop

**Decision:** `compactMessages` already returns the original messages unchanged on `stopReason: "error"` or `"aborted"`. The loop trusts this contract: after calling it, it always splices the returned `messages` into the working list and emits `compaction_end` with the (possibly unchanged) token counts. No try/catch around the summarization call is needed beyond what `compactMessages` already does.

**Rationale:** Duplicating error handling that `compactMessages` already owns would be brittle. A failed summarization degrades to "no compaction this turn," which is safe — the loop continues with the existing context and re-tries next turn.

### 6. Reuse the same model for summarization

**Decision:** Pass the loop's resolved `model` (the same `AnyModel` used for the main stream) to `compactMessages`. No model-selection logic.

**Alternative considered:** use a cheaper/faster model for summarization. **Rejected for now:** it adds a model-resolution path (which provider? which id?) with no existing source of truth. The manual route uses the same model; consistency wins. This is a tuning knob for a future change.

## Risks / Trade-offs

- **[Summarization adds latency to a turn]** when it triggers, the loop blocks on a `completeSimple` call before the user sees the next `text_delta`. → **Mitigation:** it only triggers near the context limit (a turn that would otherwise likely fail with overflow); the latency trades off against a hard failure. The UI shows `compaction_start`/`compaction_end` so the delay is explained.
- **[Repeated compaction every turn if recent context alone is large]** if `keepRecentTokens` of recent messages already exceeds the window, `compactMessages` short-circuits (`cutIndex <= 1`) and returns without an LLM call, but `shouldCompact` keeps tripping. → **Mitigation:** the short-circuit makes repeated no-op compaction cheap (no LLM call, just a token estimate). If this becomes a real problem, a per-loop "already compacted, don't retry this turn" flag is a future optimization — not needed for v1.
- **[History loss is irreversible]** summarized messages replace verbatim ones in the store. → **Accepted:** identical to the manual route's semantics and to the existing main spec. Opt-in (default off) mitigates surprise.
- **[Rough token estimate]** `estimateTokens` (chars/4) can under/over-count vs. real tokenizer usage, causing compaction to trigger too early or too late. → **Accepted:** the manual route uses the same estimate; a real tokenizer integration is a separate cross-cutting change.
- **[Soft dependency on `agent-loop-controls`]** this change consumes the `auto_compaction` setting plumbed by `agent-loop-controls`. If `agent-loop-controls` is not yet merged, the runner can still pass `autoCompaction: false` by default and this change's loop logic is inert until the setting arrives. The two changes compose cleanly regardless of merge order.

## Open Questions

- Should the UI get a distinct event when compaction is skipped due to a missing key, so it can surface "auto-compaction is on but no API key is configured"? **Decision for v1: no** — silent skip keeps the loop output clean. A future `compaction_skipped` event is a nice-to-have, not a blocker.
- Should `estimateTokens` exclude already-summarized messages from re-estimation? Not needed — once compacted, the summary message is short and the recent window dominates; the estimate is naturally lower after a successful compaction.
