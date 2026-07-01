# Observational Memory — Background-Detached Buffering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Prerequisite:** OM processor, the review-fixes, and the `scope` switch are merged. `vp check` + `vp run -r test` green. This plan makes the buffered observe/reflect path truly detached (fire-and-forget) so a turn no longer blocks on an observer/reflector LLM call.

**Goal:** Detach the **buffered** observation/reflection path (the under-threshold, opportunistic pre-emptive chunking) so it runs off the turn's critical path — the user's turn returns immediately, and the resulting chunk lands in storage for a future turn to activate. Mirror Mastra's `void this.startAsyncBufferedObservation(...)` (`observational-memory.ts:2202`) + `waitForBuffering(...)` (`:644`/`:400`).

**Architecture:** The engine already has the re-entry/drain seam (`BufferingCoordinator.asyncBufferingOps`, `setAsyncOp`, `isAsyncBufferingInProgress`) — it's just awaited inline. Three changes make it live: (1) the engine `void`s the buffer call instead of `await`-ing it; (2) the run's abort signal is threaded into the detached LLM call so a user cancel stops it; (3) `runAgentRunEffect` drains in-flight ops at run end (`waitForBuffering`) so a slow observe still completes and isn't orphaned. The over-threshold SYNC path stays `await`-ed (blocking) — it's the context-overflow safety valve, matching Mastra's `await this.observe(...)` at `observational-memory.ts:2835`.

**Tech Stack:** TypeScript, plain `Promise` fire-and-forget (the engine is async-native, not Effect — no fiber reshape needed), `AbortSignal`, vitest via `vite-plus/test`. `exactOptionalPropertyTypes: true`.

---

## Scope decisions (decided upfront — do not re-litigate during execution)

1. **Buffered-only detach.** Only `maybeBufferObservation` / `maybeBufferReflection` detach. The SYNC over-threshold path (`runSyncObserve` / `runSyncReflect`) stays blocking. Verified Mastra-faithful (`:2202` void vs `:2835` await). Detaching both risks unbounded context growth on fast back-to-back turns.
2. **Drain at run end, with a timeout.** Add `engine.waitForBuffering(timeoutMs)`; call it in `runAgentRunEffect`'s `Effect.ensuring` so a slow in-flight observe completes (and activates next run) rather than being orphaned. Default `30_000ms`. Matches Mastra's `waitForBuffering`.
3. **Cancellation via the run's `retryAbort.signal`.** Thread it engine → `runObserver`/`runReflector` (they already accept `abortSignal`). `retryAbort` fires on user-cancel only (it interrupts retry backoff — `retry-loop.ts:102-121`), NOT on normal completion, so drain (decision 2) lets useful work finish. On cancel the in-flight `complete()` aborts → settles fast → drain settles fast.
4. **No `OperationRegistry` port.** sakti is single-process; the static `asyncBufferingOps` map (keyed by `obs:{lookupKey}` / `refl:{lookupKey}`) is the re-entry + drain seam. Cross-process coordination is out of scope.
5. **Detached failures stay best-effort.** `maybeBufferObservation`/`maybeBufferReflection` already `try/catch` + clear flags in `finally` + log via the injected `Logger` (Task 5 of the review-fixes). The `void`-ed promise additionally gets a `.catch` so it can never become an unhandled rejection.
6. **Resource scope interaction.** Detach works under both scopes — the coordinator is already keyed by the lookup key (`thread:{id}` / `resource:{id}`) as of the scope switch, so concurrent sessions on the same project record share one in-flight guard. No new scope-specific work.

## Mastra source of truth (port targets)

| What | Mastra file:line |
| ---- | ---------------- |
| Detach the buffered observe (`void`) | `observational-memory.ts:2202` (`void this.startAsyncBufferedObservation(...)`) |
| Block on sync observe (`await`) | `observational-memory.ts:2835` (`const obsResult = await this.observe(...)`) |
| Drain API | `observational-memory.ts:644` / `:400` (`waitForBuffering(threadId, resourceId, timeoutMs)`) |
| Re-entry / lifecycle registry | `operation-registry.ts` (`registerOp`/`unregisterOp`/`isOpActiveInProcess`) — sakti analog is `BufferingCoordinator.asyncBufferingOps` |

## sakti integration anchors (verified)

| Concern | File:line |
| ------- | --------- |
| Buffer call that must become `void` (observe) | `packages/agent/src/observational-memory/engine.ts:170` (`return await this.maybeBufferObservation(...)`) |
| Buffer call that must become `void` (reflect) | `packages/agent/src/observational-memory/engine.ts:215` (`return await this.maybeBufferReflection(...)`) |
| `maybeBufferObservation` body (self-registers op, clears flag in finally) | `engine.ts:235` |
| `maybeBufferReflection` body | `engine.ts:363` |
| Re-entry guard (already correct, now actually exercised) | `buffering-coordinator.ts:144` (`isAsyncBufferingInProgress`), `:161`/`:189` (`shouldTrigger*` consult it) |
| In-flight promise storage | `buffering-coordinator.ts:86` (`static asyncBufferingOps`), `:219` (`setAsyncOp`), `:211` (`unregisterOp`) |
| `runObserver` / `runReflector` accept `abortSignal` already | `observer.ts:21`, `reflector.ts:21` (currently never passed one) |
| Engine construction site | `packages/agent/src/runner/agent-run.ts:101` (`new ObservationalMemoryEngine({ deps: om.deps })`) |
| Run abort controller | `agent-run.ts:123` (`const retryAbort = new AbortController();`) |
| Run-end ensuring block (drain site) | `agent-run.ts:246` (`Effect.ensuring(...)`) |
| Existing detach-aware test fakes to reuse | `packages/agent/src/observational-memory/__tests__/buffering.test.ts` (mocks `complete`) |

---

## Phase 1 — Coordinator: expose the in-flight op (drain surface)

### Task 1: `getInFlightOp` + `awaitInFlight`

**Files:**
- Modify: `packages/agent/src/observational-memory/buffering-coordinator.ts` (add getters)
- Test: `packages/agent/src/observational-memory/__tests__/buffering.test.ts` (already constructs the coordinator via the engine)

**Step 1: Write the failing test** (in `buffering.test.ts`, new `describe("detached buffering", …)`):

```ts
it("getInFlightOp exposes the stored promise per kind", async () => {
  const storage = new FakeObservationalMemoryStorage();
  const session = new FakeSessionStorage();
  const deps = createDeps(storage, session, {
    observationBufferTokens: 20,
    observationBufferActivation: 0.5,
    reflectionBufferActivation: 1,
  });
  const engine = new ObservationalMemoryEngine({ deps });
  const coord = engine["bufferingCoordinator"]; // exercise the live seam

  // Before any op: nothing in flight.
  expect(coord.getInFlightOp("observation")).toBeUndefined();

  // Plant a promise directly and confirm the getter returns it.
  let resolveOp!: () => void;
  const p = new Promise<void>((r) => (resolveOp = r));
  coord.setAsyncOp("observation", p);
  expect(coord.getInFlightOp("observation")).toBe(p);
  resolveOp();
  await p;
});
```

**Step 2: Run — verify fail.** `vp run '@sakti-code/agent#test' -- src/observational-memory/__tests__/buffering.test.ts` → `getInFlightOp is not a function`.

**Step 3: Implement** in `buffering-coordinator.ts`:

```ts
/** The in-flight detached promise for a kind, if any (drain surface). */
getInFlightOp(kind: "observation" | "reflection"): Promise<void> | undefined {
  const bufferKey = kind === "observation" ? this.observationBufferKey : this.reflectionBufferKey;
  return BufferingCoordinator.asyncBufferingOps.get(bufferKey);
}

/**
 * Await both in-flight ops (obs + refl) for this lookup key, with a timeout.
 * Used at run end so a slow detached observe still completes.
 */
async awaitInFlight(timeoutMs: number): Promise<void> {
  const ops = [this.getInFlightOp("observation"), this.getInFlightOp("reflection")].filter(
    (p): p is Promise<void> => p !== undefined,
  );
  if (ops.length === 0) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([Promise.allSettled(ops), timeout]);
}
```

**Step 4: Run — verify pass.** Commit at the batch boundary (single end-commit per house style).

---

## Phase 2 — Engine: abort-signal plumbing

### Task 2: Engine accepts `abortSignal`; threads it to observer/reflector

**Files:**
- Modify: `packages/agent/src/observational-memory/engine.ts` (`ObservationalMemoryEngineOptions`, constructor, all `runObserver`/`runReflector` call sites)

**Step 1: Write the failing test** (new file or extend `engine.test.ts`):

```ts
it("passes the engine abortSignal to runObserver (cancellation plumbing)", async () => {
  const storage = new SyncOmStorage();
  const session = new TreeSessionStorage();
  const ac = new AbortController();
  // Buffering config so we hit the buffer path, which we'll detach in Phase 3.
  const deps = createDeps(storage, session, {
    thresholds: { observation: 100, reflection: 1 },
  });
  const engine = new ObservationalMemoryEngine({ deps, abortSignal: ac.signal });
  // Append enough to cross the buffer interval; capture the call's signal.
  let captured!: AbortSignal | undefined;
  vi.mocked(complete).mockImplementation(async (req) => {
    captured = (req as { abortSignal?: AbortSignal }).abortSignal;
    return textResult("<observations>\n* x\n</observations>");
  });
  session.appendChild({ role: "user", content: "x".repeat(200), timestamp: 1 }, 1);
  const record = await engine.getOrCreateRecord();
  await engine.maybeBufferObservation(record); // direct call (still awaited here)
  expect(captured).toBe(ac.signal);
});
```

**Step 2: Run — verify fail.** `captured` is `undefined` (no signal threaded yet).

**Step 3: Implement.**
- `ObservationalMemoryEngineOptions`: add `readonly abortSignal?: AbortSignal;`
- constructor: `this.abortSignal = options.abortSignal;` (new private field)
- In `maybeBufferObservation`, `maybeBufferReflection`, `runSyncObserve`, `runSyncReflect`: pass `...(this.abortSignal ? { abortSignal: this.abortSignal } : {})` into every `runObserver({ … })` / `runReflector({ … })` call. (The sync path gets it too — symmetric token savings on user cancel.)
- Note: `runObserver`/`runReflector` already forward `abortSignal` to `complete()` (`observer.ts:61`, `reflector.ts:64`).

**Step 4: Run — verify pass.**

---

## Phase 3 — Detach the buffered observation

### Task 3: `maybeObserve` fires-and-forgets the buffer call

**Files:**
- Modify: `packages/agent/src/observational-memory/engine.ts:170` (the buffer branch of `maybeObserve`)

**Step 1: Write the failing test** (`buffering.test.ts`, `describe("detached buffering")`):

```ts
it("maybeObserve returns immediately while the buffer observe runs detached", async () => {
  const storage = new FakeObservationalMemoryStorage();
  const session = new FakeSessionStorage();
  const deps = createDeps(storage, session, {
    observationBufferTokens: 20,
    observationBufferActivation: 0.5,
    reflectionBufferActivation: 1,
  });
  const engine = new ObservationalMemoryEngine({ deps });

  // Slow observer: resolves only when we release the deferred.
  let releaseObserver!: () => void;
  const deferred = new Promise<CompleteResult>((resolve) => (releaseObserver = () => resolve(completeTextResult("<observations>\n* detached\n</observations>"))));
  vi.mocked(complete).mockImplementation(async () => deferred);

  const record = await engine.getOrCreateRecord();
  session.setEntries([createMessageEntry({ role: "user", content: "x".repeat(200), timestamp: Date.now() })]);

  // Turn hook fires detached and returns the UNCHANGED record immediately.
  const before = Date.now();
  const returned = await engine.maybeObserve(record);
  const elapsed = Date.now() - before;
  expect(returned.id).toBe(record.id);
  expect(returned.bufferedObservationChunks).toBeUndefined(); // not landed yet
  expect(elapsed).toBeLessThan(50); // did NOT wait for the LLM

  // Now let the detached op finish and drain it.
  releaseObserver();
  await engine.waitForBuffering(2_000);
  const after = await engine.getOrCreateRecord();
  expect(after.bufferedObservationChunks?.[0]?.observations).toContain("detached");
});
```

**Step 2: Run — verify fail.** The test times out / `elapsed >= 50` because `maybeObserve` currently `await`s `maybeBufferObservation` (blocks on `deferred`).

**Step 3: Implement** at `engine.ts:170`:

```ts
// Before:
//   return await this.maybeBufferObservation(record, entries, pendingTokens);
// After:
if (this.bufferingCoordinator.shouldTriggerAsyncObservation(pendingTokens, record, threshold)) {
  this.detach(
    "buffer observation",
    this.maybeBufferObservation(record, entries, pendingTokens),
  );
}
return record;
```

Add the private `detach` helper (centralizes the `void` + unhandled-rejection guard + log):

```ts
private detach(phase: string, op: Promise<unknown>): void {
  void op.catch((error) => this.logError(`${phase} (detached)`, error));
}
```

> Also add the public `waitForBuffering(timeoutMs)` passthrough used by the test:
> ```ts
> async waitForBuffering(timeoutMs: number): Promise<void> {
>   await this.bufferingCoordinator.awaitInFlight(timeoutMs);
> }
> ```

**Step 4: Run — verify pass.**

---

## Phase 4 — Detach the buffered reflection

### Task 4: `maybeReflect` fire-and-forgets the buffer call

**Files:** `engine.ts:215`

**Step 1: Write the failing test** (mirror Task 3 but for reflection — use the reflection-buffering setup already exercised in `buffering.test.ts:564` "buffers reflection when observation tokens cross the activation point"). Assert `maybeReflect` returns within `<50ms` while the reflector `complete` is deferred, then `waitForBuffering` lands the buffered reflection.

**Step 2: Run — verify fail** (blocks on the deferred reflector).

**Step 3: Implement** at `engine.ts:215`:

```ts
// Before:
//   return await this.maybeBufferReflection(record);
// After:
if (this.bufferingCoordinator.shouldTriggerAsyncReflection(observationTokens, record, threshold)) {
  this.detach("buffer reflection", this.maybeBufferReflection(record));
}
return record;
```

**Step 4: Run — verify pass.**

---

## Phase 5 — Pin the re-entry guard (now actually load-bearing)

### Task 5: Second turn while an op is in flight does not double-fire

**Files:** `buffering.test.ts`

**Step 1: Write the failing-then-passing test** (this pins existing behavior; it should pass once Phase 3 lands, but write it first to prove the guard is live):

```ts
it("a second maybeObserve while the buffer op is in flight does not double-fire", async () => {
  const storage = new FakeObservationalMemoryStorage();
  const session = new FakeSessionStorage();
  const deps = createDeps(storage, session, {
    observationBufferTokens: 20,
    observationBufferActivation: 0.5,
    reflectionBufferActivation: 1,
  });
  const engine = new ObservationalMemoryEngine({ deps });

  let release!: () => void;
  vi.mocked(complete).mockImplementation(
    async () => new Promise<CompleteResult>((r) => (release = () => r(completeTextResult("<observations>x</observations>")))),
  );
  const record = await engine.getOrCreateRecord();
  session.setEntries([createMessageEntry({ role: "user", content: "x".repeat(200), timestamp: Date.now() })]);

  await engine.maybeObserve(record); // fires detached op #1
  await engine.maybeObserve(record); // in flight → guard skips
  expect(vi.mocked(complete)).toHaveBeenCalledTimes(1);
  release!();
  await engine.waitForBuffering(2_000);
});
```

**Step 2/3: Run.** Should pass after Phase 3 (guard via `isAsyncBufferingInProgress`). If it fails, the guard isn't being consulted correctly — fix the coordinator, not the test.

---

## Phase 6 — Drain at run end

### Task 6: `runAgentRunEffect` passes the abort signal + drains

**Files:** `packages/agent/src/runner/agent-run.ts`

**Step 1: Write the failing test** in `packages/agent/src/runner/__tests__/agent-run.test.ts` (the OM wiring is already tested via the harness; add a focused assertion that `waitForBuffering` is called on run end). Since `agent-run.ts` constructs the engine internally, the cleanest assertion is behavioral: spy that `waitForBuffering` is invoked. If the engine isn't easily reachable from the test, instead assert via a stub engine passed through a new optional `AgentRunDeps.observationalMemoryEngine?` override — **only if** the existing test harness doesn't already let you observe it. Prefer not adding a new deps field; use the existing `setObservationalMemory` seam if possible.

> If wiring a test here is too invasive, fall back to: an `engine.test.ts` test that proves `waitForBuffering(timeout)` awaits a planted in-flight promise (pure engine-level), and treat the `agent-run.ts` wiring as a small, reviewable change verified by `vp check` + the existing `agent-run` suite staying green.

**Step 2: Run — verify fail.**

**Step 3: Implement** in `agent-run.ts`:

- Hoist the engine reference out of the `if` block:
  ```ts
  let omEngine: ObservationalMemoryEngine | undefined;
  if (deps.observationalMemory?.enabled) {
    omEngine = new ObservationalMemoryEngine({ deps: deps.observationalMemory.deps });
    harness.setObservationalMemory({ engine: omEngine, getBaseSystemPrompt: () => harness.getSystemPrompt() ?? "" });
  }
  ```
- Pass the abort signal:
  ```ts
  omEngine = new ObservationalMemoryEngine({
    deps: deps.observationalMemory.deps,
    ...(retryAbort ? { abortSignal: retryAbort.signal } : {}),
  });
  ```
  (Note: `retryAbort` is declared at `:123`, AFTER the engine block at `:101`. Move the engine construction to after `retryAbort` is created, OR move `retryAbort` creation up. Simplest: move the `retryAbort = new AbortController()` line above the OM-wiring block.)
- Drain in `Effect.ensuring` (`:246`):
  ```ts
  Effect.ensuring(
    Effect.gen(function* () {
      if (omEngine) {
        yield* Effect.promise(() => omEngine!.waitForBuffering(30_000));
      }
      deps.unregisterRun?.();
    }),
  ),
  ```

**Step 4: Run — verify pass** (full `agent#test`).

---

## Phase 7 — Finalize

### Task 7: Full suite, typecheck, lint

- `vp run -r test` — all packages green.
- `vp check` — 0 warnings / 0 errors.
- `rg -n "return await this\.maybeBuffer" packages/agent/src/observational-memory/engine.ts` — should return **nothing** (both buffer paths are now `void`-detached; only `runSyncObserve`/`runSyncReflect` remain `await`-ed, which is correct).
- Manual reasoning check (no live dogfooding needed for this layer): trace one turn that crosses the buffer interval — confirm (a) the model call fires without waiting on `complete`, (b) a later turn's `<observations>` contains the buffered chunk after activation.

**Commit (single end-commit, house style):** `feat(observational-memory): detach buffered observe/reflect off the turn path`

---

## Explicitly OUT of scope (do not do in this plan)

- **Detaching the SYNC over-threshold path.** Stays blocking by design (Mastra-faithful safety valve).
- **Cross-process `OperationRegistry`.** sakti is single-process; the static `asyncBufferingOps` map suffices.
- **Background detach under `resource` scope cross-session locking.** The lookup-keyed guard prevents double-fire within a process; true cross-session locking remains deferred (same limitation as the scope switch).
- **UI/WS visibility** for in-flight buffering (a separate plan).
- **Priority/queueing** of detached ops (FIFO is implicit; no priority scheduling).

## Definition of done

- The buffered observe/reflector LLM call no longer blocks the turn: `maybeObserve`/`maybeReflect` return the unchanged record immediately and `void` the op.
- `runObserver`/`runReflector` receive the run's `retryAbort.signal`; a user cancel aborts the in-flight call, a normal completion does not.
- `runAgentRunEffect` calls `engine.waitForBuffering(30_000)` in `Effect.ensuring` so a slow detached observe completes before the run tears down.
- The re-entry guard (`isAsyncBufferingInProgress`) is load-bearing and pinned by a test.
- Tests prove: (a) turn returns before the LLM resolves, (b) the chunk lands after `waitForBuffering`, (c) a second turn in flight doesn't double-fire, (d) the abort signal reaches `complete`.
- `vp run -r test` + `vp check` green; the SYNC path is unchanged (still `await`-ed).
