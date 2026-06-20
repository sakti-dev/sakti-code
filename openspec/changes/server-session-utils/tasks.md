## 1. Agent-package prerequisite export

- [ ] 1.1 Add to `packages/agent/src/index.ts`: `export { compactMessages, type CompactionOptions, type CompactionResult } from "./compaction.ts";` (additive re-export, no behavior change). Run `bun vitest run packages/agent/` → all 54 (5 mem-bench skipped) still pass. Typecheck + lint + commit. (This unblocks the compaction route's package-boundary import.)

## 2. Stats route (TDD — pure DB, do this first as the simpler half)

- [ ] 2.1 Write failing test `apps/server/src/__tests__/stats.test.ts`: seed a project + session + 2 messages; `GET /api/sessions/:id/stats` → 200 with `messageCount: 2`, `createdAt === session.createdAt`, `durationMs >= 0`, and `totalInputTokens/totalOutputTokens/totalCostUsd` all 0 (no costs recorded). Assert `GET /api/sessions/nope/stats` → 404. Run → RED.
- [ ] 2.2 Create `apps/server/src/routes/stats.ts` exporting `statsRoutes` (`new Elysia({ name: "routes.stats" })`). `GET /api/sessions/:id/stats`: resolve session via `store.ctx.repos.sessions.findById` (404 if missing), compose `messageCount = ctx.repos.messages.countBySession(id)`, `costs = ctx.repos.costs.aggregateBySession(id)` (default zeros if empty), `createdAt = session.createdAt`, `durationMs = Date.now() - session.createdAt`. Return the typed object (use `t.Object({...})` response schema).
- [ ] 2.3 Run → GREEN. Typecheck + lint.

## 3. Compaction route (TDD — LLM-backed)

- [ ] 3.1 Write failing test `apps/server/src/__tests__/compaction.test.ts`. Mock pi-ai (`vi.mock("@earendil-works/pi-ai", ...)`) so `getEnvApiKey` returns `"test-key"`, `getModel` returns a model object with a `contextWindow`, and `completeSimple` returns a short summary with `stopReason: "stop"` (so `compactMessages` actually compacts). Seed a project + a model-config row + a session + ≥50 messages. Assert `POST /api/sessions/:id/compact` → 200 with `tokensBefore > tokensAfter > 0`, and reloaded messages are smaller/fewer. Assert `POST /api/sessions/nope/compact` → 404. Run → RED.
- [ ] 3.2 Create `apps/server/src/routes/compaction.ts` exporting `compactionRoutes`. `POST /api/sessions/:id/compact`: resolve session (404 if missing); `resolveModel(ctx, session)` (import from `../agent/model-resolver.ts`) → on no config it throws → wrap to 500 "no model config"; `getEnvApiKey(cfg.provider)` → if undefined, return 500/503 "no API key for <provider> in env"; load messages via `new SqliteSessionStore(ctx.db).loadMessages(id)`; `tokensBefore = estimateTokens(messages)` (or use the result's field); `const result = await compactMessages({ model, apiKey, contextWindow: model.contextWindow, messages, keepRecentTokens: 20_000 })`; `await store.replaceMessages(id, result.messages)`; return `{ tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter }`. Note: `compactMessages` returns original messages on summary error/abort, so the 200-with-equal-counts graceful path is automatic — assert it in the next test.
- [ ] 3.3 Add graceful-degradation test: mock `completeSimple` to return `stopReason: "error"` (or `"aborted"`); assert `POST .../compact` → 200 with `tokensBefore === tokensAfter` and messages unchanged. Add missing-key test: mock `getEnvApiKey` to return `undefined`; assert 500/503 with a clear message and no LLM call. Run all compaction tests → GREEN. Typecheck + lint.

## 4. Register via route composition

- [ ] 4.1 Add `compactionRoutes` and `statsRoutes` to the server's route composition (the array/barrel surface `server-rest-api` exposes). Do NOT edit `apps/server/src/index.ts`. Add a composition test (reuse `makeApp()` from `server-rest-api`'s helper) asserting both endpoints respond on a composed server. Run → GREEN.

## 5. Documentation (plan Task 12, folded here)

- [ ] 5.1 Update `AGENTS.md`: add a **Server** section covering — the `dev:server` command (port 3001; `SAKTI_DB_PATH`/`SAKTI_PORT` env vars), the REST-for-state (Elysia over `@sakti-code/db` repos) + WS-for-streaming (`/ws` prompt/abort → event) split, the Eden treaty typed client, the **API keys from env (not DB)** invariant, the **model config (provider+modelId) in DB** note, and the **compaction is network-backed (LLM) / stats is a fast local read** caveat. Commit.

## 6. Verification

- [ ] 6.1 Run full server suite: `bun vitest run apps/server/` — stats + compaction + composition tests pass alongside the foundation's REST tests.
- [ ] 6.2 `bun typecheck` — 0 errors. `bun x ultracite check` — 0 errors.
- [ ] 6.3 Full repo suite green: `bun vitest run packages/agent/ packages/tools/` (unchanged) + `cd packages/db && bun test` (unchanged) — confirms the additive agent export broke nothing.

## Notes for the executor

- **CRITICAL — the plan's Task 14 sketch is WRONG about `compactMessages`.** The plan assumed `compactMessages(messages, opts?)` returning `AgentMessage[]` and called the route "thin." The **verified reality** (see design.md Context): `compactMessages(options: CompactionOptions): Promise<CompactionResult>` where `CompactionOptions` REQUIRES `{ apiKey, contextWindow, model, messages }` and the function makes a real `completeSimple` LLM call. Implement against the real signature, NOT the plan sketch. When this tasks file conflicts with the plan, **this file wins**.
- **Compaction is LLM-backed, not pure-DB.** Tests MUST mock pi-ai (`getEnvApiKey` + `getModel` + `completeSimple`); never hit a real network in tests. Pattern reference: `packages/agent/src/__tests__/loop.test.ts` for the `vi.mock` shape.
- **Reuse from `server-agent-streaming`:** `resolveModel` at `apps/server/src/agent/model-resolver.ts`. This is why session-utils depends on agent-streaming (must land after it). Do NOT duplicate the model-resolution logic.
- **Reuse from `server-rest-api`:** `ServerContext`, `buildServer` route composition, `makeApp()` test helper. Do not edit the foundation's `index.ts`.
- **`exactOptionalPropertyTypes: true` is on** — if you forward an optional `signal` into `compactMessages`, use conditional spread `...(signal ? { signal } : {})`, never pass `undefined`.
- **Conventions:** TDD (RED→GREEN→commit), `bun typecheck` + `bun x ultracite fix` before each commit, commit per GREEN.
- **Out of scope (reaffirmed):** `thinkingLevel`/`maxRetries` wiring (agent-layer, v1.5), auto-compaction triggers, compaction undo/archive, client abort of compaction. Stats needs none of these; compaction works without them (uses the session's configured model, same as a normal turn).
