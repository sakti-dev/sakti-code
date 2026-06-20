## 1. Atomic `registerRun` guard (race-free core — Task 5)

- [ ] 1.1 Write failing test in `apps/server/src/agent/__tests__/ws.test.ts` (or new `concurrency.test.ts`): start a prompt that hangs (mock `streamSimple` to return a stream that never completes), confirm `isRunActive("s1")` is true, then send a second `prompt` for `"s1"`. Assert the second prompt receives an `error` frame matching `/A run is already active.*steer.*followUp.*abort/` AND the first run's registry entry is preserved (a subsequent `abort` still returns `true`). RED (currently: second prompt silently overwrites, no error frame, first run orphaned).
- [ ] 1.2 Write the race test: fire two `prompt` messages for the same session back-to-back without awaiting (both enter `runAgentStream` before either calls `registerRun`). Assert exactly one starts a run and the other gets an `error` frame. RED (currently: both overwrite, neither rejected).
- [ ] 1.3 Confirm both RED against current code.
- [ ] 1.4 In `apps/server/src/agent/runner.ts`, change `registerRun` to return `boolean`: `if (activeRuns.has(sessionId)) return false; activeRuns.set(sessionId, {controller, loop}); return true;` — the `has`+`set` is synchronous (race-free; JS single-threaded).
- [ ] 1.5 Add `export function isRunActive(sessionId: string): boolean { return activeRuns.has(sessionId); }`.
- [ ] 1.6 In `runPrompt`, after `registerRun(sessionId, controller, loop)`, check the return: `if (!ok) throw new Error(\`A run is already active for session ${sessionId}. Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first.\`);` — BEFORE the `try { yield* ... }` block, so no `unregisterRun` runs on the rejected path. Move `registerRun` + guard ABOVE the `try`/`finally` (register is pre-try; unregister is in finally — the rejected throw never enters try, so it never unregisters).
- [ ] 1.7 Tests → GREEN. Run `bun vitest run apps/server/src/agent/__tests__/` — no regressions.
- [ ] 1.8 Gate: `bun typecheck && bun x ultracite check`. Commit "fix(server): atomic registerRun rejects concurrent same-session prompts (pi agent-session.ts:1037)".

## 2. Fast-path check in `handleMessage` (optimization)

- [ ] 2.1 In `apps/server/src/agent/ws-handler.ts`, import `isRunActive` from `runner.ts`. In the `prompt` branch (before `runAgentStream`), add: `if (isRunActive(msg.sessionId)) { sendError(ws, msg.sessionId, "A run is already active for session " + msg.sessionId + ". Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first."); return; }` — same message text as the `runPrompt` throw (extract to a shared constant or helper to avoid drift).
- [ ] 2.2 Verify the error message string is identical between the fast-path and the `runPrompt` throw (extract to a shared `BUSY_MESSAGE(sessionId)` helper in `runner.ts` or a constants module; both call sites use it).
- [ ] 2.3 Run the concurrency tests → still GREEN (the fast-path catches the common case; the atomic guard catches the race).
- [ ] 2.4 Gate + commit "feat(server): fast-path busy check in handleMessage (avoids wasted setup on concurrent prompt)".

## 3. Preserve steer/followUp/abort paths (regression guard)

- [ ] 3.1 Add test: while a run is active, send `{type:"steer"}` → assert it queues (no error frame; the active run processes it). Verify `{type:"followUp"}` similarly.
- [ ] 3.2 Add test: while a run is active, send `{type:"abort"}` → assert `abortRun` returns `true` and the run terminates; after `agent_end`, send a new `{type:"prompt"}` → assert it succeeds (session is no longer guarded).
- [ ] 3.3 Add test: `steer`/`followUp` on a session with NO active run → still gets the existing `"No active run for session X"` error frame (unchanged).
- [ ] 3.4 Run full server agent-layer suite → GREEN.
- [ ] 3.5 Gate + commit "test(server): concurrency guard preserves steer/followUp/abort paths".

## 4. Verification

- [ ] 4.1 `bun vitest run apps/server/src/agent/__tests__/` — all pass (expect existing + new concurrency tests).
- [ ] 4.2 `cd apps/server && bun test src/__tests__` — no regressions (REST routes unaffected).
- [ ] 4.3 `bun vitest run packages/agent/` — no regressions (agent package unchanged).
- [ ] 4.4 `cd packages/db && bun test` — no regressions (DB unchanged).
- [ ] 4.5 `bun typecheck` — 0 errors.
- [ ] 4.6 `bun x ultracite check` — 0 remaining diagnostics.
- [ ] 4.7 Cross-check every scenario in `specs/agent-streaming/spec.md` against the implemented tests; each scenario SHALL have a covering test. Specifically confirm the ship gate: second `prompt` on active session → clean error frame (not silent overwrite), first run still abortable.
- [ ] 4.8 Independence check: confirm this change did NOT modify `packages/agent/` or any main spec other than `agent-streaming` — it must remain independent of Changes 1 and 2 so archive order is free.
- [ ] 4.9 Confirm `registerRun`'s `has`+`set` is synchronous (no `await` between them) — this is the race-free invariant; verify by code inspection (no async gap between the `has` check and the `set`).
