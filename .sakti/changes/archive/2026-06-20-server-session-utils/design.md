## Context

This change delivers two session-level routes. The plan (Task 14/15) framed compaction as "a thin server-layer concern that calls the already-built agent function" and sketched `compactMessages(messages, opts?)` returning `AgentMessage[]`. **Verification of the real signatures invalidated both assumptions** — this design corrects them.

Verified facts (`packages/agent/src/compaction.ts`, pi-ai `0.79.8`):
- `compactMessages(options: CompactionOptions): Promise<CompactionResult>` — single options object.
- `CompactionOptions` = `{ apiKey: string, contextWindow: number, messages: AgentMessage[], model: Model<any>, keepRecentTokens?, reserveTokens?, signal? }`. `apiKey`, `contextWindow`, `model`, `messages` are **required**.
- `CompactionResult` = `{ messages: AgentMessage[], tokensBefore: number, tokensAfter: number }`.
- Internally `compactMessages` calls `completeSimple(model, ctx, { apiKey, ... })` — a **real network LLM call** that summarizes old history. It is NOT a pure text transform.
- `getEnvApiKey(provider): string | undefined` is **exported** by pi-ai and resolves a provider's key from env. `completeSimple` takes `apiKey` **explicitly** (unlike `streamSimple`, which reads env internally — that's why the agent runner never needed this).
- `compactMessages` is **not** re-exported from `@sakti-code/agent`'s barrel (only `estimateTokens`, `shouldCompact` are).
- `model.contextWindow` is available on the resolved pi-ai model.

Stats (plan Task 15) is genuinely pure-DB: `MessageRepo.countBySession` + `CostRepo.aggregateBySession` + `session.createdAt`. The plan sketch for stats is accurate.

Constraints: `exactOptionalPropertyTypes: true` (conditional spread for the optional `signal`), TS 6.0.3, route composition (no `index.ts` edits). `resolveModel(ctx, session)` is built by `server-agent-streaming` at `apps/server/src/agent/model-resolver.ts`.

## Goals / Non-Goals

**Goals:**
- `POST /api/sessions/:id/compact` that runs the agent summarizer on a session's history, persists the compacted messages, and returns before/after token counts.
- `GET /api/sessions/:id/stats` returning a unified `{ messageCount, totalInputTokens, totalOutputTokens, totalCostUsd, createdAt, durationMs }`.
- Both routes resolve the session (404 when unknown); both registered via route composition.
- Reuse `resolveModel` from agent-streaming (no duplication of the project-config → global-default → getModel logic).
- Resolve the summary model's API key from env via pi-ai's `getEnvApiKey`, with a clear error when no key is configured.

**Non-Goals:**
- Auto-compaction triggers / thresholds — the agent loop already self-compacts during a turn (`shouldCompact`); this route is **manual/on-demand** compaction for the UI. Wiring an auto-trigger off a setting is a follow-up.
- `thinkingLevel`/`maxRetries` wiring — agent-layer, deferred to v1.5 (reaffirmed; compaction doesn't need them).
- Compaction history/undo (keeping the pre-compaction messages) — not now; `replaceMessages` overwrites. If undo is wanted later, add an archive column then.
- Client-driven abort of a compaction in flight — compaction is a single POST; the request's lifecycle (client disconnect) is the natural bound. A dedicated abort endpoint is a follow-up only if long summaries become a problem.
- Choosing a *different* model for summarization than the session's configured model — out of scope; using the session's model is the consistent, predictable choice.

## Decisions

### 1. Reuse `resolveModel` from `server-agent-streaming` (→ corrected DAG)
**Decision:** the compaction route imports `resolveModel(ctx, session)` from `apps/server/src/agent/model-resolver.ts`. **Alternative considered:** duplicate the 5-line config→getModel resolution locally so session-utils stays a fully-parallel leaf. **Rejected:** the project-config→global-default→`getModel` fallback is a real decision (not a trivial lookup); duplicating it means two places to update when config resolution changes. **Cost:** `server-session-utils` now **depends on `server-agent-streaming`** (for the import). The corrected DAG is `rest-api → {agent-streaming → session-utils, git-integration}`. This is more honest than the original "4 independent leaves" claim — compaction and the runner genuinely share model resolution. agent-streaming and git remain parallel; session-utils lands after agent-streaming. **Why compaction still lives here (not in agent-streaming):** it's a *session-level* operation (transforms a session's history) and belongs with session-level concerns; moving it to agent-streaming would bloat the already-riskiest change.

### 2. API key via pi-ai's exported `getEnvApiKey`
**Decision:** `const apiKey = getEnvApiKey(cfg.provider); if (!apiKey) throw → 503/500 "No API key for <provider> in env"`. **Rationale:** `compactMessages` requires `apiKey` explicitly (it passes it to `completeSimple`), unlike `streamSimple` which reads env internally. pi-ai conveniently **exports** `getEnvApiKey(provider)` — so the route doesn't reinvent the env-var convention; it uses the same resolver pi-ai itself uses. This keeps the architecture's "keys from env, not DB" invariant intact: the key is never stored, never logged, only resolved transiently for the summary call. **Placement:** inline in `compaction.ts` (single consumer today; the future v1.5 thinking-level wiring might reuse it, but promote to a shared helper only when a second consumer actually appears — co-location principle).

### 3. `compactMessages` is LLM-backed — treat compaction as a network operation
**Decision:** the compaction route is async, can fail (no key, network, model error, summary-aborted), and is slower than stats. **Implications baked into the spec:** (a) the test mocks `completeSimple` (or `getEnvApiKey`+the model) rather than running a real LLM call; (b) `compactMessages` already degrades gracefully internally — if the summary `stopReason` is `error`/`aborted`, it returns the **original** messages unchanged (`tokensBefore === tokensAfter`), so the route returns 200 with equal counts rather than throwing (verified in `compaction.ts`); (c) the route's only real error paths are unknown session (404), no model config (500 with a clear message), and no API key (500/503). **Alternative considered:** make compaction synchronous/pure by using a non-LLM summarizer. **Rejected:** the agent package's compaction IS the LLM summarizer; building a parallel pure-text compactor in the server would duplicate the agent's compaction logic and diverge from what the loop does automatically.

### 4. Agent-package prerequisite: export `compactMessages`
**Decision:** add `export { compactMessages, type CompactionOptions, type CompactionResult } from "./compaction.ts";` to `packages/agent/src/index.ts`. **Rationale:** the route imports from `@sakti-code/agent` (package boundary), not from the deep internal path `@sakti-code/agent/src/compaction.ts`. This is an **additive** re-export (zero behavior change, zero risk to the 54 agent tests). **Alternative considered:** import from the deep path. **Rejected:** breaks package encapsulation, breaks if the internal file moves, and the barrel is the documented public surface. The plan's Task 14 sketch already assumed `compactMessages` was importable from `@sakti-code/agent` — this just makes that assumption true.

### 5. Stats is a pure read projection (matches the plan)
**Decision:** `stats.ts` composes three existing repo calls (`countBySession`, `aggregateBySession`, `session.createdAt`) into one response object. No LLM, no network, no new schema. `durationMs = Date.now() - session.createdAt`. Unknown session → 404. Empty costs → zeros (the repo returns zero aggregates, not null). **This part of the plan is accurate**; no divergence.

### 6. Registration via route composition
**Decision:** add `compactionRoutes` and `statsRoutes` to `buildServer`'s routes array. Do NOT edit `apps/server/src/index.ts`. Same pattern as the other leaves.

## Risks / Trade-offs

- **[Compaction makes a real network call]** a flaky network or a slow model makes `POST .../compact` slow; a missing key or model error makes it fail. → **Mitigation:** clear error mapping (404 session / 500 no-config / 500 no-key); `compactMessages` already returns original messages on summary failure so the route doesn't lose data; tests mock the LLM so they're deterministic and offline. Document latency expectation in AGENTS.md.
- **[DAG dependency on agent-streaming]** session-utils can't be built/merged before agent-streaming (resolveModel import). → **Acceptable:** agent-streaming was always slated early (it's the riskiest change); session-utils was always last (it folds docs). The serial ordering is natural, not imposed. git-integration stays fully parallel.
- **[No undo for compaction]** `replaceMessages` overwrites history. → **Accepted for v1:** the agent loop auto-compacts the same way during turns, so this matches existing behavior. An archive/undo column is a follow-up if users lose something they wanted.
- **[getEnvApiKey convention tied to pi-ai]** if pi-ai changes its env-var naming, compaction breaks but so would the agent runner (which relies on the same env vars via streamSimple). → **Acceptable:** shared risk, shared fix.
- **[No client abort for compaction]** a long summary can't be cancelled mid-flight from the client. → **Mitigation:** client disconnect tears down the request; a dedicated abort endpoint is a documented follow-up, not a v1 gap.
