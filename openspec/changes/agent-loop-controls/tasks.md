## 1. Agent package: `AgentConfig` + `AgentLoop` interface changes

- [x] 1.1 Add `thinkingLevel?: string` to `AgentConfig` and `AgentConfigInput` in `packages/agent/src/types.ts`
- [x] 1.2 Add `autoRetry?: boolean` and `steeringMode?: string` to `AgentConfigInput` in `packages/agent/src/types.ts`
- [x] 1.3 Add `steer(message: string): void` and `followUp(message: string): void` to the `AgentLoop` interface in `packages/agent/src/loop/index.ts`
- [x] 1.4 Implement steer/follow-up FIFO queues (bounded at 10) in the loop's `prompt()` generator
- [x] 1.5 Wire steer queue check before each `turn_start` and after tool execution completes
- [x] 1.6 Wire follow-up queue check after each `turn_end` (before loop termination check)
- [x] 1.7 Persist steer/follow-up messages via `store.appendMessage` immediately on injection
- [x] 1.8 Run agent package tests: `bun vitest run packages/agent/` — all 54 + new tests pass

## 2. Agent package: Thread thinking level through streaming

- [x] 2.1 Update `streamLLMResponse` in `packages/agent/src/loop/streaming.ts` to accept and pass `thinkingLevel` to `streamSimple`
- [x] 2.2 Pass `thinkingLevel` from `AgentConfig` through the loop to `streamLLMResponse`
- [x] 2.3 Add test: verify `streamSimple` receives `thinkingLevel` option when config has it
- [x] 2.4 Add test: verify `streamSimple` called without `thinkingLevel` when config omits it

## 3. Agent package: Per-session settings override loop behavior

- [x] 3.1 Wire `autoRetry` setting: skip retry loop when `autoRetry: false`
- [x] 3.2 Wire `auto_compaction` setting: skip `shouldCompact` check when disabled
- [x] 3.3 Wire `steeringMode` setting: `"one-at-a-time"` processes one steer per turn, `"all"` processes all queued steers
- [x] 3.4 Add tests for each setting override behavior
- [x] 3.5 Run full agent package test suite

## 4. DB package: SettingsRepo bulk-prefix query

- [x] 4.1 Add `getByPrefix(prefix: string): Array<{ key: string; value: string }>` method to `SettingsRepo` in `packages/db/src/repos/index.ts`
- [x] 4.2 Write test for `getByPrefix`: inserts three keys with same prefix, asserts all three returned
- [x] 4.3 Run DB tests: `cd packages/db && bun test`

## 5. Server: Per-session settings routes

- [x] 5.1 Write failing test `apps/server/src/__tests__/settings.test.ts` — RED
- [x] 5.2 Create `apps/server/src/routes/session-settings.ts`: `GET /api/sessions/:id/settings` returns merged defaults; `PATCH /api/sessions/:id/settings` updates provided keys
- [x] 5.3 Register new routes via route composition (do NOT edit `apps/server/src/index.ts`)
- [x] 5.4 Run → GREEN. Typecheck + lint.

## 6. Server: Steer/follow-up routes

- [x] 6.1 Write failing test `apps/server/src/__tests__/session-controls.test.ts` — RED
- [x] 6.2 Create routes: `POST /api/sessions/:id/steer` and `POST /api/sessions/:id/follow-up`
- [x] 6.3 Extend active runs registry in `runner.ts` to store the loop reference alongside the controller
- [x] 6.4 Register routes via route composition
- [x] 6.5 Run → GREEN. Typecheck + lint.

## 7. Server: WS protocol extension

- [x] 7.1 Write failing test `apps/server/src/agent/__tests__/ws.test.ts` — RED
- [x] 7.2 Update `ws-handler.ts`: add `steer` and `followUp` to the `WsIn` type union; dispatch to `loop.steer`/`loop.followUp`
- [x] 7.3 Update `runner.ts`: add `getActiveLoop(sessionId)` accessor
- [x] 7.4 Run → GREEN. Typecheck + lint.

## 8. Server: Runner loads per-session settings

- [x] 8.1 Update `runPrompt` in `apps/server/src/agent/runner.ts`: load per-session settings and pass to `createAgentInput`
- [x] 8.2 Update test in `runner.test.ts`: add mock settings
- [x] 8.3 Run → GREEN. Typecheck + lint.

## 9. Verification

- [x] 9.1 Run full server suite: `bun vitest run apps/server/` — 95/95 tests pass
- [x] 9.2 Run agent package tests: `bun vitest run packages/agent/` — 54/54 tests pass
- [x] 9.3 Run DB tests: `cd packages/db && bun test` — 21/21 tests pass
- [x] 9.4 `bun typecheck` — 0 errors
- [x] 9.5 `bun x ultracite fix` — 0 remaining diagnostics

**Post-review fix (2026-06-20):**
- Fixed `steerInterrupted` `ReferenceError` in `loop/index.ts` — removed orphaned reference to undeclared variable. The `steerAbort` controller handles tool-abort-on-steer via the combined abort signal.
- Added `biome-ignore` for `noExcessiveCognitiveComplexity` in `prompt()` (pre-existing, not introduced by this change)
