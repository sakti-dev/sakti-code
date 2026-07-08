## Why

A second `prompt` on a session that already has an active run is silently accepted, overwriting the first run's registry entry and corrupting state. Verified against our code and pi's source:

**Our bug (the silent overwrite):** `handleMessage` (`ws-handler.ts:122`) fires `runAgentStream` fire-and-forget with no guard. `runPrompt` (`runner.ts:123`) calls `registerRun(sessionId, ...)` which does `activeRuns.set(sessionId, ...)` — **overwriting** any existing entry unconditionally. The first run's `finally { unregisterRun(sessionId) }` (`runner.ts:128`) then deletes the second run's entry. Result: the second run is invisible to `abortRun`/`getActiveLoop`, and two runs interleave `appendMessage` calls on the same session's rows.

**pi's model (agent-session.ts:1037-1051):** when a prompt arrives while the agent is streaming (`this.isStreaming`), pi does NOT flatly reject. It rejects-with-guidance **by default** (`throw new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.")`) and **allows queueing** when the caller explicitly specifies `streamingBehavior: "steer"|"followUp"` (routing to `_queueSteer`/`_queueFollowUp`). This is the proven design: a concurrent prompt is never silently swallowed — it's either rejected with a clear actionable message, or explicitly queued.

**Our architecture already encodes pi's `streamingBehavior` choice at the WS message-type level:** a client sends `{type:"prompt"}` (no streamingBehavior — pi's reject path), `{type:"steer"}` (streamingBehavior:"steer" — pi's queue path), or `{type:"followUp"}` (streamingBehavior:"followUp" — pi's queue path). The steer/followUp queue paths are already wired (`ws-handler.ts:74-88` → `loop.steer()`/`loop.followUp()`). What's missing is the reject path: a second `prompt` while active must be rejected with pi's guidance message instead of silently overwriting.

### The check-then-act race (why the guard must be atomic)

The plan's original T5 proposed checking `isRunActive(sessionId)` in `handleMessage` before firing `runAgentStream`. This does **not** close the race. `handleMessage` is synchronous; `runAgentStream` is fire-and-forget async; and `runPrompt` has **3+ `await` gaps** before `registerRun` (`runner.ts:72` `await findById`, `:77` `await findById`, plus `resolveModel`/`buildTools`). Two rapid `prompt` messages on the same session can both pass a check in `handleMessage` before either reaches `registerRun`. The guard must be **atomic**: `registerRun` itself does a synchronous `Map.has` + `Map.set` (JS single-threaded — no interleaving possible within one sync call) and returns whether it won. `runPrompt` throws if it lost the race; `runAgentStream` catches the throw and sends the error frame.

## What Changes

- **Make `registerRun` atomic (the race-free guard).** Change `registerRun` from `void` to `boolean`: if `activeRuns.has(sessionId)`, return `false` (a run is already active); otherwise `set` and return `true`. This is the single source of truth — the synchronous `has`+`set` cannot be interleaved.
- **Reject in `runPrompt` on race loss.** After `registerRun` returns `false`, `runPrompt` throws with pi's guidance message (adapted to our WS vocabulary): `"A run is already active for session <id>. Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first."` `runAgentStream`'s existing `catch` sends this as an `error` frame — the WS analog of pi's thrown error (and the WS equivalent of the ship gate's "409"; there is no REST prompt endpoint, so no HTTP status applies).
- **Fast-path check in `handleMessage` (optimization, not correctness).** Before firing `runAgentStream` for a `prompt`, check `isRunActive(sessionId)` and send the error frame immediately if active. This avoids the wasted session/project/model setup work in `runPrompt` for the common case. The atomic `registerRun` remains the correctness backstop for the race window.
- **Add `isRunActive` helper.** Export `isRunActive(sessionId): boolean` from `runner.ts` (trivial `activeRuns.has(sessionId)`).

### No Breaking Changes

- The only behavior change: a second `prompt` on an active session that previously silently overwrote now receives an `error` frame. Clients that intended to queue should already be using `steer`/`followUp` (pi's model); a client sending a bare second `prompt` was already broken (its run was being orphaned).
- `steer`/`followUp`/`abort` paths are unchanged. `steer`/`followUp` while active continue to queue (pi's explicit-streamingBehavior path); `abort` continues to signal the active run's controller.
- `registerRun`'s signature change (`void` → `boolean`) is internal to `packages/server`; the only caller is `runPrompt`.

## Capabilities

### New Capabilities

_(None.)_

### Modified Capabilities

- `agent-streaming`: ADDS a requirement — a second `prompt` on a session with an active run SHALL be rejected with an error frame carrying pi's guidance message (not silently overwritten); the guard SHALL be race-free via atomic `registerRun`. This is pi's default-path (no `streamingBehavior`) rejection. The existing steer/followUp queue paths (pi's explicit-streamingBehavior paths) are already specified in `session-controls` and are unchanged.

## Impact

- **`apps/server/src/agent/runner.ts`** — `registerRun` returns `boolean` (atomic `has`+`set`); `runPrompt` checks the return and throws pi's guidance message on `false`; add `isRunActive` export.
- **`apps/server/src/agent/ws-handler.ts`** — `handleMessage` prompt path: fast-path `isRunActive` check before firing `runAgentStream` (sends error frame immediately if active).
- **`apps/server/src/agent/__tests__/ws.test.ts`** (or new `concurrency.test.ts`) — tests: (a) second `prompt` while active → error frame with guidance text; (b) `abort` + new `prompt` after termination succeeds; (c) steer/followUp while active still queues (unchanged); (d) race: two near-simultaneous prompts → exactly one succeeds, other gets error frame.
- **No DB / agent-package / route changes.** Fully confined to `apps/server/src/agent/`.
- **Store-keying by `wsId` (ws.ts:38) is NOT changed.** Verified non-issue: once the guard prevents concurrent runs on the same session, there is no scenario where two `SqliteSessionStore` instances race on the same session's rows. `steer`/`followUp` route through `getActiveLoop(sessionId)` (the active run's loop + its own store), never touching the second connection's store. The plan's deferred "re-key store by sessionId" TODO is resolved as a non-issue — documented here, not hand-waved.
- **Ship gate** — "second prompt on active session → clean rejection, not silent overwrite." The rejection is a WS `error` frame (the WS analog of an HTTP 409; there is no REST prompt endpoint so no HTTP status applies). This matches pi, which throws an error string (not an HTTP status) from `session.prompt()`.
