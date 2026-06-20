## 1. Reasoning option: rename `thinkingLevel` → `reasoning` AND gate on `model.reasoning` (Task 1)

- [x] 1.1 Write failing test in `packages/agent/src/__tests__/streaming.test.ts`: with a reasoning-capable model and `thinkingLevel: "high"`, assert `streamSimple` receives `{ reasoning: "high" }` (NOT `{ thinkingLevel }`). Add a second case: non-reasoning model (`reasoning: false`) + `thinkingLevel: "high"` → `streamSimple` called WITHOUT `reasoning`. RED.
- [x] 1.2 Confirm RED (opts.reasoning undefined; for non-reasoning model, opts currently carries the wrong `thinkingLevel` key).
- [x] 1.3 Fix `packages/agent/src/loop/streaming.ts:169`: gate + rename — `...(model.reasoning && thinkingLevel && thinkingLevel !== "off" ? { reasoning: thinkingLevel } : {})`. (`streamLLMResponse` already receives `model: AnyModel`, which carries pi-ai's `reasoning: boolean`.)
- [x] 1.4 Tests → GREEN. Run `bun vitest run packages/agent/` — no regressions.
- [x] 1.5 Gate: `bun typecheck && bun x ultracite check`. Commit "fix(agent-loop): map thinkingLevel→reasoning, gate on model.reasoning (pi compaction.ts:537)".

## 2. Widen `AssistantMessage` to carry the pi-ai fields (type prerequisite for Tasks 3+4)

- [x] 2.1 Add optional fields to `AssistantMessage` in `packages/agent/src/types.ts`: `stopReason?: string`, `errorMessage?: string`, `api?: string`, `provider?: string`, `model?: string`, `responseModel?: string`, `responseId?: string`, `diagnostics?: unknown[]`. (Optional, not required — pre-change DB rows lack them.)
- [x] 2.2 `bun typecheck` — fix any compile breakage from the widened type (the `TurnEndEvent.message` and consumers).
- [x] 2.3 Commit "feat(agent): widen AssistantMessage with stopReason/errorMessage/attribution (pi-ai fields)".

## 3. Preserve the WHOLE pi-ai message at the stream boundary (merges Tasks 6 + 9, streaming side)

- [x] 3.1 Write failing test in `packages/agent/src/__tests__/loop-behavior.test.ts`: after a normal text turn, assert the final `AssistantMessage` (via `turn_end`/store) carries `stopReason: "stop"` AND at least one attribution field (`api`/`provider`/`model`) that the mock `streamSimple` reported. RED.
- [x] 3.2 Write failing test: mock `streamSimple` to terminate with an `error` event carrying `event.error` = a full `AssistantMessage` (`stopReason: "error"`, `errorMessage: "billing"`, zeroed usage). Assert `streamLLMResponse`'s result carries that exact message (NOT a synthesized one, NOT `finalAssistant: null`). RED.
- [x] 3.3 In `streaming.ts` `done` handler: map ALL `event.message` fields onto `finalAssistant` (content, usage, timestamp, stopReason, errorMessage, api, provider, model, responseModel, responseId, diagnostics) instead of cherry-picking four.
- [x] 3.4 In `streaming.ts` `error` handler: set `finalAssistant = event.error` (the whole pi-ai error message), keep yielding the `error` event, and `return { status: "error", finalAssistant: event.error }`. (Abort case: pi-ai sets `stopReason: "aborted"` on `event.error` — no special-casing needed.)
- [x] 3.5 Widen `StreamResult`: the non-OK variant SHALL carry `finalAssistant: AgentMessage | null` so the loop can persist it (Tasks 4+5).
- [x] 3.6 Fix `toPiMessages` in `streaming.ts`: pass through the now-preserved `stopReason`/`api`/`provider`/`model`/`responseModel`/`responseId` from our `AssistantMessage` instead of fabricating `"stop"/"openai-completions"/"openai"/"unknown"`; keep fabrication as fallback for messages lacking them (old rows).
- [x] 3.7 Tests → GREEN. Run full agent suite.
- [x] 3.8 Gate + commit "fix(agent-loop): preserve whole pi-ai message (done+error), fix toPiMessages fabrication".

## 4. Persist error/aborted turns in the loop (Task 9, loop side)

- [x] 4.1 Write failing test in `packages/agent/src/__tests__/loop-behavior.test.ts`: mock `streamSimple` to error; assert the loop (a) yields the `error` event AND (b) `store.loadMessages` returns one assistant message with `stopReason: "error"` and the pi-ai `errorMessage`. RED (currently persists nothing).
- [x] 4.2 In `packages/agent/src/loop/index.ts`: after `streamLLMResponse`, if `!streamResult.ok && streamResult.finalAssistant`, push it onto `messages` and `await store.appendMessage(sessionId, it)` before yielding `agent_end` + `return`. (The `error` event is already yielded inside `streamLLMResponse`.)
- [x] 4.3 Add abort-path test: caller aborts mid-stream → persisted assistant message has `stopReason: "aborted"`.
- [x] 4.4 Tests → GREEN. Run full agent suite.
- [x] 4.5 Gate + commit "fix(agent-loop): persist error/aborted turns as assistant messages (pi agent-loop.ts:196)".

## 5. Round-trip stopReason/errorMessage through the DB (prerequisite for reload + Task 4)

- [x] 5.1 Write failing test in `packages/db/src/__tests__/session-store.test.ts`: `appendMessage` an assistant with `stopReason: "error"`, `errorMessage: "x"`, then `loadMessages` — assert both fields survive the round-trip. RED (currently dropped).
- [x] 5.2 Add nullable columns `stopReason text("stop_reason")` and `errorMessage text("error_message")` columns to the `messages` table in `packages/db/src/schema.ts`.
- [x] 5.3 Update `agentMessageToRow` (assistant branch) to emit `stopReason`/`errorMessage` when present; update `mapRowToAgentMessage` to read them back. (Attribution fields are NOT persisted — see design Decision 3.)
- [x] 5.4 Update `fork()` in `session-store.ts` to copy the two new columns through (it already copies columns explicitly).
- [x] 5.5 Test → GREEN. Run `cd packages/db && bun test` (currently 23 passing).
- [x] 5.6 Gate + commit "feat(db): persist stopReason/errorMessage on messages (prereq for error-turn reload)".

## 6. Skip error/aborted usage in estimateContextTokens (Task 4 — pi getAssistantUsage)

- [x] 6.1 Write failing test in `packages/agent/src/__tests__/compaction.test.ts`: message list where the most recent assistant has `stopReason: "error"`, zero usage, and an earlier successful assistant has `usage.totalTokens: 500`; assert `estimateContextTokens` returns ~500 (uses the earlier message), NOT 0. RED.
- [x] 6.2 In `packages/agent/src/compaction.ts` `estimateContextTokens`: when scanning back, `continue` past any assistant with `stopReason === "error" || stopReason === "aborted"` (pi `getAssistantUsage`). Keep the existing `usageTokens > 0` guard.
- [x] 6.3 Test → GREEN. Run full agent suite.
- [x] 6.4 Gate + commit "fix(compaction): skip error/aborted usage in estimateContextTokens (pi getAssistantUsage)".

## 7. Verification

- [ ] 7.1 `bun vitest run packages/agent/` — all pass (expect ~72 + new).
- [ ] 7.2 `cd packages/db && bun test` — all pass (expect ~23 + new round-trip test).
- [ ] 7.3 `bun vitest run apps/server/src/agent/__tests__/` — no regressions (server reads widened messages).
- [ ] 7.4 `cd apps/server && bun test src/__tests__ src/terminal/__tests__` — no regressions.
- [ ] 7.5 `bun typecheck` — 0 errors.
- [ ] 7.6 `bun x ultracite check` — 0 remaining diagnostics.
- [ ] 7.7 Cross-check every scenario in `specs/agent-loop/spec.md` and `specs/thinking-level-config/spec.md` against the implemented tests; each scenario SHALL have a covering test.
