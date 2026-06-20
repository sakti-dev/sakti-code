## 1. Fix thinkingLevel → reasoning field mapping (Task 1)

- [ ] 1.1 Write failing test in `packages/agent/src/__tests__/` (new `streaming.test.ts` or nearest existing): with `thinkingLevel: "high"` configured, assert `streamSimple` receives `{ reasoning: "high" }` in its options (NOT `{ thinkingLevel }`). RED.
- [ ] 1.2 Run `bun vitest run` on the new test — confirm RED (opts.reasoning is undefined, opts.thinkingLevel is "high").
- [ ] 1.3 Fix the mapping in `packages/agent/src/loop/streaming.ts:169`: rename the spread key `{ thinkingLevel }` → `{ reasoning: thinkingLevel }`.
- [ ] 1.4 Run the test → GREEN. Run full agent suite `bun vitest run packages/agent/` — no regressions.
- [ ] 1.5 Gate: `bun typecheck && bun x ultracite check`. Commit "fix(agent-loop): map thinkingLevel to pi-ai 'reasoning' option".

## 2. Capture stopReason on AssistantMessage (Task 6)

- [ ] 2.1 Write failing test in `packages/agent/src/__tests__/loop-behavior.test.ts`: after a normal text turn, assert the persisted `AssistantMessage` (e.g. via the `turn_end` event's message) carries `stopReason: "stop"`. RED.
- [ ] 2.2 Add optional `stopReason?: string` to `AssistantMessage` in `packages/agent/src/types.ts`.
- [ ] 2.3 Capture `stopReason` in the streaming layer's `done` handler (`streaming.ts:118-127`): set `finalAssistant.stopReason = event.message.stopReason`.
- [ ] 2.4 Run the test → GREEN. Run full agent suite.
- [ ] 2.5 Gate + commit "fix(agent-loop): preserve stopReason on AssistantMessage".

## 3. Skip error/aborted usage in estimateContextTokens (Task 4)

- [ ] 3.1 Write failing test in `packages/agent/src/__tests__/compaction.test.ts` (estimateContextTokens block): build a message list whose most recent assistant has `stopReason: "error"` with zero usage, and an earlier successful assistant with `usage.totalTokens: 500`; assert `estimateContextTokens` returns 500 (uses the earlier message), NOT 0. RED.
- [ ] 3.2 Update `estimateContextTokens` in `packages/agent/src/compaction.ts`: in the assistant-scanning loop, `continue` (skip) when `m.stopReason === "error" || m.stopReason === "aborted"`. Keep the existing `usageTokens > 0` guard.
- [ ] 3.3 Run the test → GREEN. Run full agent suite.
- [ ] 3.4 Gate + commit "fix(compaction): skip error/aborted usage in estimateContextTokens".

## 4. Persist error/aborted turns as assistant messages (Task 9)

- [ ] 4.1 Write failing test in `packages/agent/src/__tests__/loop-behavior.test.ts`: mock `streamSimple` to yield an `error` event; assert the loop emits the `error` event AND `store.loadMessages` returns one assistant message with `stopReason: "error"` and the error text as content. RED.
- [ ] 4.2 In `packages/agent/src/loop/streaming.ts` error handler: build a `finalAssistant` with `stopReason: "error"`, content `[{ type: "text", text: errorMessage }]`, zeroed usage, current timestamp (in addition to yielding the `error` event). Return it from `streamLLMResponse` as the result.
- [ ] 4.3 In `packages/agent/src/loop/index.ts`: after `streamResult`, if `streamResult.finalAssistant?.stopReason` is `"error"` or `"aborted"`, push + `store.appendMessage` it before terminating the loop (for the abort case, set `stopReason: "aborted"`).
- [ ] 4.4 Add an abort-path test: caller aborts mid-stream → persisted assistant message has `stopReason: "aborted"`.
- [ ] 4.5 Run the tests → GREEN. Run full agent suite.
- [ ] 4.6 Gate + commit "fix(agent-loop): persist error/aborted turns as assistant messages".

## 5. Verification

- [ ] 5.1 Run `bun vitest run packages/agent/` — all pass (expect ~72 + new tests).
- [ ] 5.2 Run `bun vitest run apps/server/src/agent/__tests__/` — all pass (no server-side change here, but guard against regressions in message handling).
- [ ] 5.3 Run `cd apps/server && bun test src/__tests__ src/terminal/__tests__` — no regressions.
- [ ] 5.4 Run `cd packages/db && bun test` — no regressions.
- [ ] 5.5 Run `bun typecheck` — 0 errors.
- [ ] 5.6 Run `bun x ultracite check` — 0 remaining diagnostics.
- [ ] 5.7 Cross-check each spec scenario in `specs/agent-loop/spec.md` and `specs/thinking-level-config/spec.md` against the implemented tests; every scenario SHALL have a covering test.
