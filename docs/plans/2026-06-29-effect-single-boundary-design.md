# Single Effect Boundary — Design

**Date:** 2026-06-29
**Status:** Approved
**Follows:** `2026-06-29-agent-effect-end-to-end.md` (Phases A–G shipped)
**Goal:** Deliver the plan's stated goal — *single `Effect.runPromise` boundary at the WS edge* — by converting `runPrompt`, the harness internals, and `RetryRunnerDeps` to Effect-native.

## Context

Phases A–G delivered: tool-input-delta streaming, Effect-native `SessionStorage`/`SessionShape`, PubSub-backed `subscribeStream`, redundant `Agent` class deleted. But the production run path still has many Promise↔Effect boundaries:

- `apps/server/src/agent/runner.ts:runPrompt` — Promise-orchestrated; calls `executeWithRetry` (Promise wrapper around `executeWithRetryEffect`).
- `packages/agent/src/agent/agent-harness.ts` — 11 internal `Effect.runPromise` calls (mostly `Effect.runPromise(Effect.gen(...))` + `try/catch` patterns wrapping session writes that already return `Effect`).
- `packages/agent/src/agent/agent-harness.ts:promptEffect`/`continueEffect`/`abortEffect`/`waitForIdleEffect` (Phase C) — implemented as `Effect.tryPromise(() => this.prompt(...))`. They re-bridge to Promise, so consuming them from `Effect.gen` doesn't actually reduce boundary count.
- `packages/agent/src/compaction/retry-loop.ts:RetryRunnerDeps` — callbacks return `Promise`. `executeWithRetryEffect` bridges via `Effect.promise(() => deps.X())` ~5× per turn.
- `packages/agent/src/session/session.ts:PromiseSession` — legacy adapter; only consumers are `runner.ts:512` and `routes/sessions/compaction.ts:62`.

`SessionShape` is already fully Effect-typed, and the harness's `session` field is already `SessionShape`. So the conversion is mostly mechanical: replace `await Effect.runPromise(this.session.X())` with `yield* this.session.X()` inside an `Effect.gen`.

## Scope

**In scope:**
- Harness: 11 internal `Effect.runPromise` → 4 (one per public method).
- `promptEffect`/`continueEffect`/`abortEffect`/`waitForIdleEffect`: drop `tryPromise`, become the true core.
- `RetryRunnerDepsEffect` (Effect-typed); `executeWithRetryEffect` consumes it.
- `runPrompt` → `Effect.gen`; WS handler = single `Effect.runPromise` boundary.
- `PromiseSession` deleted.
- ws/e2e tests rewritten to deterministic `Stream` draining (drop `setTimeout` pattern).

**Out of scope (deferred):**
- REST routes under `apps/server/src/routes/sessions/*` — 10 `Effect.runPromise` wrappers. Latency-dominated by DB/JSON; converting requires Effect-native Hono middleware. Negligible UX payoff.
- Compaction Promise wrappers (`compact`/`runAutoCompaction`/`generateBranchSummary`) — they become dead once H4 lands; deletion is H5 cleanup.

## Final shape (after all phases)

- `runPromptEffect(...)` returns `Effect<void, Error>`; WS handler has the single `Effect.runPromise(runPromptEffect(...))` boundary.
- Harness: each public method has an `*Effect` core; Promise methods are one-line `Effect.runPromise(this.XEffect())` wrappers.
- `executeWithRetryEffect` takes `RetryRunnerDepsEffect` (Effect-typed callbacks).
- `PromiseSession` deleted; `SessionShape` (already Effect-native) used directly.
- ws/e2e tests use `Stream`-based deterministic draining.

## Phases

### Phase H1 — Low-risk harness methods (off run/emit path)

Convert 7 mechanical `Effect.runPromise(Effect.gen(...))` patterns to private `*Effect` methods + Promise wrappers.

**Affected methods (agent-harness.ts):**
- `appendMessage`, `appendFollowUp` (queued-writes pattern)
- `setLabel`, `setModel`, `setThinkingLevel`, `setTools` (setter pattern)
- `flushPendingSessionWrites` (helper used by H2 — must land first)

**Pattern:**
```ts
private XEffect(...): Effect.Effect<ReturnType, SessionError | AgentHarnessError> {
  return Effect.gen(this, function* (self) { /* yield* self.session.X() */ });
}
async X(...): Promise<ReturnType> {
  try { return await Effect.runPromise(this.XEffect(...)); }
  catch (error) { throw normalizeHarnessError(error, "session"); }
}
```

**Risk:** zero — pure extraction; observable behavior identical.

**Tests:** one new test per method asserting `XEffect` returns an Effect (smoke test). Existing harness tests stay Promise-based and unchanged.

### Phase H2 — executeTurn + emit (the danger zone)

Convert `executeTurn`, `runAsTurn`, `createTurnState`, `handleAgentEvent` to Effect-native. Then `prompt`/`continue`/`abort`/`waitForIdle`/`skill`/`promptFromTemplate`/`switchAgent` each get an `*Effect` core. Drop the `tryPromise` wrappers from Phase C — `promptEffect` etc. become the true core.

**Critical move — kill the flake root cause:**

The previous flake (1/3 runs in `ws.test.ts`) traced to emit-timing divergence:
- `runAgentLoopEffect` emits via `Effect.promise(() => emit(event))` — lazy, runs when scheduler reaches it.
- `runAgentLoop` emits via `await emit(event)` — eager, runs immediately.

Result: with `runAgentLoopEffect`, `agent_start` could fire *after* subsequent emits queued up in the same gen, breaking `ws.test.ts` frame ordering.

**Fix:** introduce a single `emitEffect(event): Effect<void>` helper. Both `runAgentLoopEffect` and `executeTurnEffect` use `yield* emitEffect(event)`. Promise callers use `await Effect.runPromise(emitEffect(event))`. Exactly one emit semantics, not two. This makes `executeTurnEffect`'s emit ordering byte-identical to today's `executeTurn`.

`executeTurnEffect` calls `runAgentLoopEffect` directly (instead of `runAgentLoop`). The `Effect.gen` body mirrors the current Promise body, with:
- `yield* emitHookEffect(...)` instead of `await this.emitHook(...)`
- `yield* runAgentLoopEffect(...)` instead of `await runAgentLoop(...)`
- `yield* self.flushPendingSessionWritesEffect()` instead of `await this.flushPendingSessionWrites()`
- `yield* self.emitRunFailureEffect(...)` for the catch path
- A `finally` via `Effect.ensuring` instead of `try/finally`

**Tests:**
- 37+ existing harness tests stay Promise-based (they call `await harness.prompt(...)`); the Promise wrappers route through `promptEffect` so behavior is identical.
- 3 PubSub tests from Phase C+D stay.
- **2 new tests (RED-first):**
  - Regression: `promptEffect produces the same emit ordering as prompt` — runs a fixed prompt through both, snapshots the event sequence, asserts equal. This is the explicit guard against the flake returning.
  - `executeTurnEffect yields the same assistant message as executeTurn` — same input, same output message.

**If `ws.test.ts` flakes:** rewrite per the rule (deterministic `Stream.runCollect` draining, drop `setTimeout(50-500ms)`). Do not roll back the Effect conversion.

### Phase H3 — Effect-typed RetryRunnerDeps

New interface alongside the existing one (or replacing, if all callers migrate in the same phase):

```ts
export interface RetryRunnerDepsEffect {
  readonly checkCompaction?: (message: AssistantMessage) => Effect.Effect<CompactionDecision>;
  readonly emit: (event: AgentEvent) => Effect.Effect<void>;  // or sync, see below
  readonly logger?: Logger;
  readonly rollbackLeaf: () => Effect.Effect<void>;
  readonly runCompaction?: () => Effect.Effect<RunCompactionOutcome>;
  readonly runTurn: () => Effect.Effect<AssistantMessage>;
  readonly signal: AbortSignal;  // kept for abortableSleep backoff
}
```

`executeWithRetryEffect` switches to consume `Effect` callbacks directly: `yield* deps.runTurn()` instead of `yield* Effect.promise(() => deps.runTurn())`.

`executeWithRetry` (Promise wrapper) constructs an adapter from the old `RetryRunnerDeps` (callbacks lifted via `Effect.promise`) — kept only if external callers still pass Promise deps. After H4, no external callers remain, so H5 deletes it.

**Tests:** rewrite 5 `retry-loop.test.ts` cases to supply Effect fakes (`Effect.succeed(...)` for sync returns, `Effect.fail(...)` for errors). Behavior assertions stay identical.

### Phase H4 — runner.ts runPrompt → Effect.gen

`runPrompt` becomes `runPromptEffect`, returning `Effect<void, Error>`:

```ts
function runPromptEffect(ctx, sessionId, message): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    // setup: load project/session/agent/tools/model (sync or via yield*)
    const harness = ...;
    yield* harness.switchAgentEffect(agent);

    const eventStream = harness.subscribeStream();
    const drainFiber = yield* Effect.forkIn(scope)(
      Stream.runForEach(eventStream, (e) => Effect.sync(() => eventCallback(e)))
    );
    yield* Effect.addFinalizer(() =>
      Effect.asVoid(Fiber.interrupt(drainFiber))
    );

    const retryAbort = new AbortController();  // kept — abortableSleep still needs it
    if (!registerRun(sessionId, harness, retryAbort)) {
      return yield* Effect.fail(new Error(busyMessage(sessionId)));
    }

    yield* executeWithRetryEffect(depsEffect, settings);  // all callbacks Effect-typed
    // ... stuck-guard state mutations stay sync ...
  }).pipe(
    Effect.ensuring(/* rejectPendingPermissionAsks, unregisterRun */)
  );
}
```

Retry callbacks become Effect-returning:
- `runTurn: () => Effect.gen(...)` → `yield* harness.promptEffect(text)` / `harness.continueEffect()` / `harness.skillEffect(name)` / `harness.promptFromTemplateEffect(name, argv)`.
- `rollbackLeaf: () => Effect.gen(...)` → `yield* session.getBranch()`, `yield* storage.setLeafId(parentId)`. No more `Effect.runPromise` wrapper inside.
- `checkCompaction: () => Effect.gen(...)` → `yield* session.getBranch()`, `yield* session.buildContext()`, sync `checkCompaction()` call, sync stuck-guard mutation.
- `runCompaction: () => runAutoCompationEffect(...)` (already Effect).
- `emit: (event) => Effect.sync(() => eventCallback(event))` — emit is synchronous (just `cb(event)`); wrap as `Effect.sync`.

**WS handler (`ws-handler.ts`):** single `Effect.runPromise(runPromptEffect(...))` at the edge. `.catch((err) => sendErrorFrame(sessionId, err))` for top-level error framing.

**`activeRuns` Map:** stores `{ harness, runFiber, retryAbort }`. `abortRun(sessionId)` becomes:
```ts
const run = activeRuns.get(sessionId);
if (!run) return;
retryAbort.abort();  // unblocks abortableSleep
Effect.runPromise(Fiber.interrupt(run.runFiber));  // cancels the Effect
```

**Tests:**
- `runner.test.ts` (if exists) — update assertions.
- `ws.test.ts` — if any test breaks, rewrite per the rule.
- `e2e.test.ts` — the 50ms `setTimeout` is the false positive; rewrite to deterministic Stream draining.

### Phase H5 — Cleanup

- Delete `PromiseSession` class + `promiseSessionAsShape` helper (`packages/agent/src/session/session.ts`).
- Migrate `runner.ts:512` and `routes/sessions/compaction.ts:62` to use `SessionShape` directly from storage.
- Remove `PromiseSession` export from `packages/agent/src/index.ts` and `harness-types.ts`.
- Delete old `RetryRunnerDeps` interface if all callers migrated (kept for back-compat only during H3→H4 transition).
- Delete `executeWithRetry` Promise wrapper if no consumers remain.
- Rewrite remaining `setTimeout`-based ws/e2e tests to `Stream`-based deterministic draining.

## Testing strategy

- **TDD per phase:** RED (failing test for the new `*Effect` variant) → GREEN (extract/convert) → `pnpm run fix` → commit.
- **Existing tests stay green** through H1 (Promise API unchanged, just reorganized).
- **H2 may break `ws.test.ts`** → rewrite per the rule (deterministic Stream draining).
- **H4 may break `e2e.test.ts`** → rewrite per the rule.
- **2 pre-existing API-key failures stay failing:** `apps/server` compaction "summarizes and persists" + e2e "two concurrent sessions". Both need real OpenAI keys, fail identically on clean tree.

Per-phase verification: `pnpm run typecheck` (workspace) + `pnpm run test` in `packages/agent`, `packages/db`, `apps/server`, `apps/desktop` + `pnpm run fix`.

## Risk register

1. **Emit ordering (H2)** — root-caused already; `emitEffect` helper + regression test guard. If the regression test fails, fix the helper, don't revert.
2. **`ws.test.ts` false positives (H2/H4)** — `setTimeout`-based draining is flaky by construction; rewrite to `Stream.runCollect` per the rule.
3. **v4 beta.90 API limits** — use only verified APIs from `openspec/references/effect-v4/packages/effect/src/`. No bare `Effect.fork` (use `Effect.forkIn(scope)` inside gen, `Effect.runFork` for top-level).
4. **5 retry tests churn (H3)** — mechanical; assertions unchanged, only fake construction changes.
5. **`abortableSleep` + `AbortSignal` coexistence** — `signal` stays on `RetryRunnerDepsEffect` because backoff sleep uses it; the run-level Fiber interrupt handles full-run cancel. Both coexist cleanly.

## The rule (restated)

**Tests encoding old Promise-timing contracts are false positives.** If `ws.test.ts`/`e2e.test.ts`/any test breaks because of an emit-timing or microtask-scheduling change introduced by this migration, **rewrite the test** to assert behavior deterministically (via `Stream.runCollect`, `Effect.raceFirst` with timeout, or fiber `await`). Do NOT roll back the Effect conversion.

## Out-of-scope future work

- `@effect/platform` HttpServer migration (separate effort).
- Effect-native Hono middleware for REST routes (deferred; latency-dominated by DB/JSON).
- Own events (`queue_update`/`model_update`) routed through PubSub (currently on `emitOwn` path; latency-insensitive).
- `tool-input-delta` surfacing in the desktop UI (currently ignored by the reducer).
