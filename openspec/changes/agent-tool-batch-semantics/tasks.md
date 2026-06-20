## 1. `shouldTerminateToolBatch` helper + AND semantics (T3)

- [ ] 1.1 Write failing test in `packages/agent/src/__tests__/loop-behavior.test.ts`: a batch of [toolA(terminate:true), toolB(terminate:false)] → assert the loop does NOT terminate after the batch (more than one `turn_end` / the run continues). RED (currently OR → terminates). Add the all-terminate case (both true → terminates) and the single-tool-terminate case (unchanged) as regression guards.
- [ ] 1.2 Confirm RED on the mixed case.
- [ ] 1.3 In `packages/agent/src/loop/tool-execution.ts`, extract `function shouldTerminateToolBatch(results: { terminate: boolean }[]): boolean { return results.length > 0 && results.every(r => r.terminate === true); }` (pi `agent-loop.ts:544-546`).
- [ ] 1.4 Replace the `if (result.terminate) shouldTerminate = true` accumulator + the `shouldTerminate` boolean with a `terminates: {terminate: boolean}[]` array (push `result` per tool), and `return { toolResultMessages, shouldTerminate: shouldTerminateToolBatch(terminates) };`.
- [ ] 1.5 Tests → GREEN. Run `bun vitest run packages/agent/`.
- [ ] 1.6 Gate: `bun typecheck && bun x ultracite check`. Commit "fix(agent-loop): terminate requires ALL tools to request it (AND, pi shouldTerminateToolBatch)".

## 2. Abort breaks the batch (T10)

- [ ] 2.1 Write failing test: a sequential 3-tool batch where the signal aborts after tool 2 completes (tool 2's execute resolves, then `controller.abort()` fires). Assert tool 3 is NOT executed (its execute not called) and tools 1-2's results are persisted. RED (currently all 3 run).
- [ ] 2.2 In the sequential `for…of` in `tool-execution.ts`, after `store.appendMessage(...)` (per tool), add `if (signal?.aborted) break;` (pi `agent-loop.ts:444-446`).
- [ ] 2.3 Test → GREEN. Run full agent suite — confirm C4b/C4c steer-abort tests still pass (single-tool, unaffected).
- [ ] 2.4 Gate + commit "fix(agent-loop): abort breaks the tool batch (pi:444-446)".

## 3. Thread `toolExecutionMode` into `executeToolCalls`

- [ ] 3.1 Add `toolExecutionMode: "sequential" | "parallel"` parameter to `executeToolCalls` signature in `packages/agent/src/loop/tool-execution.ts` (default `"parallel"` to preserve current call sites if any bypass — but the loop will always pass it).
- [ ] 3.2 In `packages/agent/src/loop/index.ts` at the `executeToolCalls(...)` call site (~line 201-208), add `resolved.toolExecutionMode` as the new argument.
- [ ] 3.3 `bun typecheck` — confirm no breakage.
- [ ] 3.4 Commit "feat(agent-loop): thread toolExecutionMode into executeToolCalls".

## 4. Parallel execution — pi's two-phase structure (T7)

- [ ] 4.1 Write failing timing test in `loop-behavior.test.ts`: `toolExecutionMode: "parallel"`, two tools each `await sleep(50)`; record start times via `Date.now()` inside each `execute`; assert `Math.abs(aStart - bStart) < 30` (concurrent). RED (currently sequential → `> 50`).
- [ ] 4.2 Write failing ordering test: parallel batch [toolA, toolB] where toolB resolves first; assert the tool-result messages are emitted in call order (toolA's result first). RED (no parallel path yet).
- [ ] 4.3 In `tool-execution.ts`, add the parallel branch: when `toolExecutionMode === "parallel" && toolCalls.length > 1`, run pi's two-phase structure:
  - **Phase 1 (prepare loop):** for each `tc`, `yield evt("tool_execution_start", {toolCallId: tc.id, toolName: tc.name})`; build an async thunk that runs `tool.execute(...)`, buffers its `tool_execution_update`/`tool_execution_end` events into an array, catches errors (existing error→isError logic), and returns `{events: AgentEvent[], result, tc}`. Push the thunk. `if (signal?.aborted) break;` after each push.
  - **Phase 2:** `const results = await Promise.all(thunks.map(t => t()));` — genuinely concurrent execution.
  - **Phase 3 (finalize loop):** `for (const {events, result, tc} of results)` — flush the buffered events (`for (const e of events) yield e;`), then build + persist the tool-result message. Push to `toolResultMessages` and `terminates`.
  - `return { toolResultMessages, shouldTerminate: shouldTerminateToolBatch(terminates) };`
- [ ] 4.4 Keep the sequential `for…of` as the `else` branch (mode `"sequential"` OR single tool call). Both branches use `shouldTerminateToolBatch` (from Task 1) and the `signal?.aborted` break (from Task 2).
- [ ] 4.5 Tests → GREEN (timing + ordering). Run full agent suite.
- [ ] 4.6 Gate + commit "feat(agent-loop): parallel tool execution via pi two-phase structure (pi:456-516)".

## 5. Parallel + abort interaction test

- [ ] 5.1 Write test: parallel 3-tool batch, abort fires during Phase 1 after preparing tool 2. Assert tool 3 is NOT prepared (no `tool_execution_start` for tool 3) and tools 1-2 run to completion.
- [ ] 5.2 Confirm the prepare-loop `if (signal?.aborted) break;` (Task 4.3) covers this. Adjust if needed.
- [ ] 5.3 Test → GREEN. Run full agent suite.
- [ ] 5.4 Gate + commit "test(agent-loop): parallel batch abort-breaks the prepare loop".

## 6. Regression sweep (steer-abort + single-tool)

- [ ] 6.1 Run `steer-behavior.test.ts` C4b/C4c (single-tool steer-abort) → GREEN. These MUST stay green (single-tool batches are equivalent in both modes).
- [ ] 6.2 Run the existing `loop-behavior.test.ts` tool tests (echo, terminate=true, message persistence) → GREEN.
- [ ] 6.3 Run `retry-abort.test.ts` → GREEN (abort during streaming, unrelated to tool batch).
- [ ] 6.4 If any regress, root-cause before adjusting — the single-tool path must be byte-for-byte equivalent to before.

## 7. Verification

- [ ] 7.1 `bun vitest run packages/agent/` — all pass (expect existing + new T3/T7/T10 tests).
- [ ] 7.2 `cd packages/db && bun test` — unchanged (no DB change); confirm no regressions.
- [ ] 7.3 `bun vitest run apps/server/src/agent/__tests__/` — no regressions (server forwards events unchanged).
- [ ] 7.4 `cd apps/server && bun test src/__tests__` — no regressions.
- [ ] 7.5 `bun typecheck` — 0 errors.
- [ ] 7.6 `bun x ultracite check` — 0 remaining diagnostics.
- [ ] 7.7 Cross-check every scenario in `specs/agent-streaming/spec.md` against the implemented tests; each scenario SHALL have a covering test.
- [ ] 7.8 Independence check: confirm this change did NOT modify `streaming.ts`, `compaction.ts`, `types.ts` (AssistantMessage), or the main spec other than `agent-streaming` — it must remain independent of Changes 1, 2, and 4 so archive order is free.
- [ ] 7.9 Confirm the parallel path's `Promise.all` actually runs thunks concurrently (not sequentially) — verify by the timing test (Task 4.1) AND by code inspection (thunks are invoked inside `Promise.all`, not in a `for…await`).
