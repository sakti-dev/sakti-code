## Why

The foundation (`server-rest-api`) and agent layer (`server-agent-streaming`) cover state and the live loop, but two session-level conveniences are missing: a way to **manually compact** a session's message history (run the summarizer on demand to reclaim context), and a **unified stats** read (message count + token/cost totals + duration in one response). Both are "compute/transform over session data," so they share this change. This is the last of the four server changes and it also folds in the server documentation update (plan Task 12).

## What Changes

- Create `apps/server/src/routes/compaction.ts` — `POST /api/sessions/:id/compact` that loads a session's messages, runs the agent package's `compactMessages(...)` to summarize old history, persists the compacted messages, and returns `{ tokensBefore, tokensAfter }`.
- Create `apps/server/src/routes/stats.ts` — `GET /api/sessions/:id/stats` returning `{ messageCount, totalInputTokens, totalOutputTokens, totalCostUsd, createdAt, durationMs }`, a read-only projection composing `MessageRepo.countBySession`, `CostRepo.aggregateBySession`, and the session's `createdAt`.
- Register both routes via `buildServer`'s route-composition array (from `server-rest-api`) — no edit to the foundation's `index.ts`.
- **Prerequisite (agent package, additive):** export `compactMessages` + `CompactionOptions` + `CompactionResult` from `@sakti-code/agent`'s barrel. Today only `estimateTokens`/`shouldCompact` are exported; the route imports `compactMessages` from the package, not a deep internal path.
- **Reuse from `server-agent-streaming`:** the compaction route needs the **same** model resolution as the agent runner (`resolveModel`) — the summary runs on the session's configured model, just like a turn does. It imports `resolveModel` from `agent/model-resolver.ts`.
- **New (inline in compaction.ts):** API-key resolution via pi-ai's exported `getEnvApiKey(provider)`. Unlike `streamSimple` (which reads env internally), `compactMessages`→`completeSimple` takes `apiKey` explicitly, so the route must resolve it and fail clearly when no key is set.
- Update `AGENTS.md` with the full server section (REST + WS + Eden + env-keys + model-config; the `dev:server` command) — plan Task 12, folded here because this is the last change to land.

## Capabilities

### New Capabilities
- `session-utils`: Two session-level routes plus their wiring — (1) the LLM-backed manual compaction route (`compactMessages` from the agent package, model+key resolution, persistence of compacted history), (2) the pure-DB stats projection, and (3) the agent-package prerequisite export that the compaction route depends on.

### Modified Capabilities
<!-- None. Consumes `server-rest-api` (buildServer composition, ServerContext, makeApp helper), `server-agent-streaming` (resolveModel), and `@sakti-code/agent` (`compactMessages`, `estimateTokens`, types) without changing their existing requirements. The agent-package export is additive (new re-export), not a modification of existing behavior. -->

## Impact

- **New code**: `apps/server/src/routes/compaction.ts`, `apps/server/src/routes/stats.ts`, plus `apps/server/src/__tests__/{compaction,stats}.test.ts`. A one-line additive re-export in `packages/agent/src/index.ts`. An `AGENTS.md` edit.
- **Dependencies**: no new deps. Uses pi-ai's exported `getEnvApiKey`, `getModel`, and `completeSimple` (indirectly via `compactMessages`); the existing `@sakti-code/agent` (`compactMessages`, `estimateTokens`, `AgentMessage`) and `@sakti-code/db` (`SqliteSessionStore`, repos).
- **Consumes `server-rest-api`**: `ServerContext`, `buildServer` route composition, `makeApp()` test helper. MUST NOT edit the foundation's `index.ts`.
- **Consumes `server-agent-streaming`**: imports `resolveModel` from `apps/server/src/agent/model-resolver.ts`. → **This makes `server-session-utils` depend on `server-agent-streaming`**, not a fully-parallel leaf. (The original "4 independent leaves" framing was optimistic: compaction's model resolution genuinely overlaps with the runner's. The corrected DAG is `rest-api → {agent-streaming → session-utils, git-integration}` — agent-streaming and git stay parallel; session-utils follows agent-streaming.)
- **Runtime**: compaction makes a real LLM call (network latency, can fail on missing key / network / model error) and is slower than stats (which is pure local DB). Stats is fast and read-only.
- **Out of scope (deferred, reaffirmed)**: wiring `thinkingLevel` through to `streamSimple` / per-session `maxRetries` — these are agent-layer capability extensions (cross `AgentConfigInput` + `streaming.ts`) tracked in the v1.5 roadmap, NOT server routes. The compaction route works without them (it uses the session's configured model for the summary, same as a normal turn).
