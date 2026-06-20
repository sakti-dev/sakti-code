## 1. Agent package: `AgentConfig` + `AgentLoop` interface changes

- [ ] 1.1 Add `thinkingLevel?: string` to `AgentConfig` and `AgentConfigInput` in `packages/agent/src/types.ts`
- [ ] 1.2 Add `autoRetry?: boolean` and `steeringMode?: string` to `AgentConfigInput` in `packages/agent/src/types.ts`
- [ ] 1.3 Add `steer(message: string): void` and `followUp(message: string): void` to the `AgentLoop` interface in `packages/agent/src/loop/index.ts`
- [ ] 1.4 Implement steer/follow-up FIFO queues (bounded at 10) in the loop's `prompt()` generator
- [ ] 1.5 Wire steer queue check before each `turn_start` and after tool execution completes
- [ ] 1.6 Wire follow-up queue check after each `turn_end` (before loop termination check)
- [ ] 1.7 Persist steer/follow-up messages via `store.appendMessage` immediately on injection
- [ ] 1.8 Run agent package tests: `bun vitest run packages/agent/` — all 54 + new tests pass

## 2. Agent package: Thread thinking level through streaming

- [ ] 2.1 Update `streamLLMResponse` in `packages/agent/src/loop/streaming.ts` to accept and pass `thinkingLevel` to `streamSimple`
- [ ] 2.2 Pass `thinkingLevel` from `AgentConfig` through the loop to `streamLLMResponse`
- [ ] 2.3 Add test: verify `streamSimple` receives `thinkingLevel` option when config has it
- [ ] 2.4 Add test: verify `streamSimple` called without `thinkingLevel` when config omits it

## 3. Agent package: Per-session settings override loop behavior

- [ ] 3.1 Wire `autoRetry` setting: skip retry loop when `autoRetry: false`
- [ ] 3.2 Wire `auto_compaction` setting: skip `shouldCompact` check when disabled
- [ ] 3.3 Wire `steeringMode` setting: `"one-at-a-time"` processes one steer per turn, `"all"` processes all queued steers
- [ ] 3.4 Add tests for each setting override behavior
- [ ] 3.5 Run full agent package test suite

## 4. DB package: SettingsRepo bulk-prefix query

- [ ] 4.1 Add `getByPrefix(prefix: string): Array<{ key: string; value: string }>` method to `SettingsRepo` in `packages/db/src/repos/index.ts`
- [ ] 4.2 Write test for `getByPrefix`: inserts three keys with same prefix, asserts all three returned
- [ ] 4.3 Run DB tests: `cd packages/db && bun test`

## 5. Server: Per-session settings routes

- [ ] 5.1 Write failing test `apps/server/src/__tests__/settings.test.ts`: `GET /api/sessions/:id/settings` returns merged defaults; `PATCH /api/sessions/:id/settings` round-trips; unknown session returns 404 (reuse `makeApp` from helpers). Run → RED.
- [ ] 5.2 Create `apps/server/src/routes/settings.ts` (or extend existing `settings.ts`): `GET /api/sessions/:id/settings` resolves session, loads `session:{id}:*` keys via `getByPrefix`, merges with defaults; `PATCH /api/sessions/:id/settings` updates provided keys
- [ ] 5.3 Register new routes via route composition (do NOT edit `apps/server/src/index.ts`)
- [ ] 5.4 Run → GREEN. Typecheck + lint.

## 6. Server: Steer/follow-up routes

- [ ] 6.1 Write failing test `apps/server/src/__tests__/session-controls.test.ts`: `POST /api/sessions/:id/steer` with active run (mock via `registerRun`) returns 200; without active run returns 404. Run → RED.
- [ ] 6.2 Create routes: `POST /api/sessions/:id/steer` and `POST /api/sessions/:id/follow-up` — look up active run, call `steer`/`followUp` on the loop instance
- [ ] 6.3 The routes need a way to access the active loop instance (not just its `AbortController`). Extend the active runs registry in `runner.ts` to store the loop reference alongside the controller.
- [ ] 6.4 Register routes via route composition
- [ ] 6.5 Run → GREEN. Typecheck + lint.

## 7. Server: WS protocol extension

- [ ] 7.1 Write failing test `apps/server/src/agent/__tests__/ws.test.ts`: add test that a `steer` WS message calls `loop.steer` for an active session; a `steer` without active session returns error frame. Run → RED.
- [ ] 7.2 Update `ws-handler.ts`: add `steer` and `followUp` to the `WsIn` type union; in the handler, dispatch to `loop.steer`/`loop.followUp` via the active runs registry
- [ ] 7.3 Update `runner.ts`: extend `registerRun` to accept and store the loop reference; add `getActiveLoop(sessionId)` accessor
- [ ] 7.4 Run → GREEN. Typecheck + lint.

## 8. Server: Runner loads per-session settings

- [ ] 8.1 Update `runPrompt` in `apps/server/src/agent/runner.ts`: after resolving session+project, load per-session settings via `ctx.repos.settings.getByPrefix("session:{sessionId}:")` and pass them to `createAgentInput`
- [ ] 8.2 Update test in `runner.test.ts`: add mock settings, assert they flow through to config
- [ ] 8.3 Run → GREEN. Typecheck + lint.

## 9. Verification

- [ ] 9.1 Run full server suite: `bun vitest run apps/server/` — all existing + new tests pass
- [ ] 9.2 Run agent package tests: `bun vitest run packages/agent/` — all 54 + new tests pass
- [ ] 9.3 Run DB tests: `cd packages/db && bun test` — all pass
- [ ] 9.4 `bun typecheck` — 0 errors
- [ ] 9.5 `bun x ultracite fix` — 0 remaining diagnostics
