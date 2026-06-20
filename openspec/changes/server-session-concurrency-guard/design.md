## Context

A second `prompt` on a session with an active run silently overwrites the first run's registry entry, orphaning it. Verified against our code and pi's source. Full evidence in `docs/plans/2026-06-20-agent-runtime-pi-alignment.md` (Task 5).

**pi's concurrency model** (`openspec/references/pi/packages/coding-agent/src/core/agent-session.ts:1037-1051`):

```ts
if (this.isStreaming) {
  if (!options?.streamingBehavior) {
    throw new Error(
      "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
    );
  }
  if (options.streamingBehavior === "followUp") {
    await this._queueFollowUp(expandedText, currentImages);
  } else {
    await this._queueSteer(expandedText, currentImages);
  }
  preflightResult?.(true);
  return;
}
```

pi's design is **reject-with-guidance by default, OR explicitly queue**. A concurrent prompt is never silently swallowed. The caller chooses: no `streamingBehavior` → rejection with an actionable message; `streamingBehavior: "steer"|"followUp"` → queued. This is the proven design we mirror.

**Our architecture already encodes pi's `streamingBehavior` choice at the WS message-type level** — this is the key structural mapping:

| pi `streamingBehavior` | Our WS message type | Current behavior | pi-aligned? |
|---|---|---|---|
| _(none)_ — reject path | `{type:"prompt"}` while active | **BUG: silent overwrite** | ✗ → must reject |
| `"steer"` — queue path | `{type:"steer"}` while active | `loop.steer()` queues | ✓ already wired |
| `"followUp"` — queue path | `{type:"followUp"}` while active | `loop.followUp()` queues | ✓ already wired |

So our fix is narrowly scoped to the `{type:"prompt"}` reject path — the queue paths are already correct.

**Our current code (the bug):**
- `ws-handler.ts:122` — `handleMessage` fires `runAgentStream(ctx, sessionId, message, store, ws)` fire-and-forget with no guard.
- `runner.ts:15-21` — `registerRun(sessionId, controller, loop)` does `activeRuns.set(sessionId, {controller, loop})` — **unconditional overwrite**.
- `runner.ts:126-128` — `finally { unregisterRun(sessionId) }` — the first run's cleanup deletes the second run's entry (since run 2 overwrote run 1's).
- Result: run 2 is invisible to `abortRun`/`getActiveLoop`; two runs interleave `appendMessage` on the same session.

**The check-then-act race (why a `handleMessage`-level check is insufficient):** `handleMessage` is synchronous; `runAgentStream` is fire-and-forget async; `runPrompt` has `await` gaps at `runner.ts:72` (`findById`), `:77` (`findById`), and inside `resolveModel`/`buildTools` — all before `registerRun` at `:123`. Two rapid `prompt` messages can both pass any check in `handleMessage` before either reaches `registerRun`. The guard must be **atomic at the `registerRun` site** (synchronous `has`+`set` — JS is single-threaded, so no interleaving is possible within one synchronous call).

## Goals / Non-Goals

**Goals:**
- A second `prompt` on an active session is rejected with an error frame carrying pi's guidance message — never silently overwritten.
- The guard is race-free: `registerRun` is the single atomic check-and-set; no `await` gap between the check and the set.
- Preserve the steer/followUp queue paths exactly as they are (pi's explicit-streamingBehavior paths).
- After a run terminates (normal, abort, or error), a new `prompt` on the same session succeeds.

**Non-Goals:**
- **Re-keying the session store by `sessionId` instead of `wsId`** (ws.ts:38). The plan deferred this with a TODO. Verified non-issue: once the guard prevents concurrent runs on the same session, two `SqliteSessionStore` instances can never race on the same session's rows (only one run is ever active). `steer`/`followUp` route through `getActiveLoop(sessionId)` — the active run's loop, using its own store — and never touch the second connection's store. Re-keying would be relevant only for connection-lifecycle-vs-session-lifecycle concerns (e.g., reconnecting to resume), which is a different change. Documented, not hand-waved.
- **A REST prompt endpoint.** Prompts are WS-only in our architecture; there is no HTTP status to return. The ship gate's "409" is the HTTP analog — our WS equivalent is an `error` frame, matching pi (which throws a string error, not an HTTP status).
- **Cross-session or cross-project concurrency limits.** pi and our spec both allow multiple sessions to run concurrently on one connection ("across sessions or projects," agent-streaming spec Purpose). Only same-session concurrency is guarded.
- **Queueing a second `prompt` automatically as a followUp.** pi requires the caller to explicitly opt in via `streamingBehavior`; we mirror that — the client sends `{type:"followUp"}` to queue, not `{type:"prompt"}`. Auto-promoting prompt→followUp would hide the caller's intent and diverge from pi.

## Decisions

### 1. Atomic guard in `registerRun` (race-free), not a check in `handleMessage`

**Decision:** Change `registerRun` to return `boolean`: `if (activeRuns.has(sessionId)) return false; activeRuns.set(...); return true;`. In `runPrompt`, after `registerRun(...)`, if it returned `false`, `throw new Error(<pi guidance message>)`. The throw propagates through the async generator to `runAgentStream`'s existing `catch`, which sends the `error` frame.

**Rationale:** The `has`+`set` inside `registerRun` is synchronous — JS's single-threaded event loop guarantees no other code interleaves between the two statements. This closes the check-then-act race that a `handleMessage`-level check cannot. The throw-in-generator → catch-in-`runAgentStream` path reuses the existing error-frame machinery (no new plumbing). This is the minimal race-free design.

**Alternatives considered:**
- *Check `isRunActive` in `handleMessage` only (the plan's original approach).* **Rejected:** does not close the race (3+ `await` gaps between `handleMessage` and `registerRun`). Useful as a fast-path optimization (see Decision 2) but insufficient for correctness.
- *Use an `AbortController`-per-session mutex or async lock library.* **Rejected:** over-engineered. JS's single-threaded synchronous `Map` operations are already a correct mutex for this case. No library needed.
- *Queue the second prompt as a followUp automatically.* **Rejected:** diverges from pi (which requires explicit `streamingBehavior`); hides caller intent.

### 2. Fast-path check in `handleMessage` (optimization, not correctness)

**Decision:** In `handleMessage`'s prompt branch, before firing `runAgentStream`, check `isRunActive(sessionId)`. If active, `sendError(ws, sessionId, <pi guidance message>)` and `return` immediately — skip the fire-and-forget.

**Rationale:** Without this, the common case (second prompt while active) pays the full `runPrompt` setup cost (session lookup, project lookup, model resolution, tool building, settings load) before hitting the atomic guard and throwing. The fast-path check catches the common case synchronously. The atomic `registerRun` guard (Decision 1) remains the correctness backstop for the race window (two messages pass the fast-path check before either registers).

**Alternatives considered:**
- *Fast-path only, no atomic guard.* **Rejected:** the race window between the fast-path check and `registerRun` is real (3+ `await` gaps). Both are needed: fast-path for efficiency, atomic guard for correctness.

### 3. Error message text: pi's guidance adapted to our WS vocabulary

**Decision:** The error frame message SHALL be: `"A run is already active for session <id>. Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first."` This adapts pi's `"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."` (agent-session.ts:1044-1048) to our WS message-type vocabulary (we don't have a `streamingBehavior` field; we have separate `steer`/`followUp` message types) and adds the `'abort'` option (pi's TUI has an Esc key; our WS equivalent is the `abort` message).

**Rationale:** pi's message is proven UX — it tells the caller exactly what to do. Adapting the vocabulary (not copying verbatim) is correct because our API surface differs (WS message types vs `streamingBehavior` field). Adding `'abort'` is additive guidance pi's TUI provides via a different mechanism.

**Alternatives considered:**
- *Copy pi's message verbatim.* **Rejected:** references `streamingBehavior`, which doesn't exist in our WS protocol. Would confuse our clients.
- *Generic "busy" message.* **Rejected:** the plan's original `"A run is already active for this session. Send 'abort' first."` doesn't mention steer/followUp, losing pi's queue-guidance. Our message includes all three options.

### 4. Store-keying by `wsId` is NOT changed (resolved as non-issue)

**Decision:** Leave `getOrCreateStore` keyed by `wsId` (ws.ts:38). Do NOT re-key by `sessionId`.

**Rationale (the proof):** `SqliteSessionStore` wraps the shared `db` (ws.ts:40 passes `ctx.db`); all CRUD goes through the shared SQLite instance. The only way two store instances race on the same session's rows is if two runs are active on the same session simultaneously — which the guard (Decision 1) now prevents. `steer`/`followUp` from a second connection route through `getActiveLoop(sessionId)` → the active run's loop (which uses its own store), never touching the second connection's store. Therefore: with the guard in place, the `wsId`-keyed store cannot produce a same-session data race. The plan's TODO ("re-key store by sessionId") addressed a problem that the guard already solves.

**Alternatives considered:**
- *Re-key by `sessionId` as the plan's TODO suggested.* **Rejected:** solves a problem the guard already prevents, adds connection-vs-session-lifecycle complexity (what happens to the store when the connection that created it closes but the session persists?), and risks introducing a new bug. YAGNI until a concrete need appears (e.g., connection-resume).

## Risks / Trade-offs

- **[Second prompt that previously "worked" now errors]** → **Accepted / correct:** a second `prompt` that previously silently overwrote was already broken (the first run was orphaned — invisible to abort, interleaving appends). Clients relying on this were relying on undefined behavior. The correct path to queue input is `steer`/`followUp` (already wired). The error frame tells them exactly what to do.
- **[Fast-path check + atomic guard = belt and suspenders]** → **Accepted:** two checks for the same condition. The redundancy is justified: the fast-path avoids wasted async setup (efficiency), the atomic guard closes the race (correctness). Removing either weakens the design.
- **[Termination window: abort fires but run hasn't unregistered yet]** → **Accepted / pi-consistent:** between `controller.abort()` and `finally { unregisterRun(sessionId) }`, `isRunActive` is still `true`. A new `prompt` in this window is rejected. This matches pi (`isStreaming` stays true until the stream fully terminates). The client should wait for the `agent_end` event before sending a new prompt. Correct behavior.
- **[Error message leaks session ID]** → **Accepted:** the session ID is already in every WS frame (`sessionId` field); the error frame adds no new exposure.

## Migration Plan

No migration. The change is a server-side runtime guard; no schema, route, event-shape, or persisted-data change. The `registerRun` signature change (`void` → `boolean`) is internal — the only caller is `runPrompt`. Rollback is reverting the commits.

## Open Questions

- Should the fast-path check also guard `steer`/`followUp` against a session that's active on a *different* connection? **Decision: no** — `getActiveLoop(sessionId)` already routes to the active run regardless of connection (ws-handler.ts:76). A steer from connection B on a session active on connection A correctly queues into A's run. That's the intended behavior (one active run per session, steerable from any connection).
- Should we emit a dedicated `{type:"busy"}` frame instead of reusing `{type:"error"}`? **Decision: no** — pi uses its generic error path (`throw` → RPC `error(id, "prompt", e.message)`). Our `error` frame is the WS analog. A dedicated frame type would diverge from pi and add client-side parsing burden for no benefit.
- Should the termination window (abort → unregister gap) be narrowed? **Decision: no for now** — pi has the same window; narrowing it would require moving `unregisterRun` before the stream fully drains, risking a new prompt starting before the old one's final events are sent. Pi-consistent behavior is correct.
