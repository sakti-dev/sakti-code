# Effect Adoption Plan — sakti-code Agent Loop

## Guiding Principles (priority order)

1. **Performance first** — the single most important criterion. Evaluate every change against runtime performance (latency, throughput, memory, allocation in hot paths like the LLM token stream).
2. **Adopt Effect maximally** — use as many Effect features as the change warrants (`Stream`, `FiberSet`, `Queue`, `Scope`, `Schedule`, `Effect.fn`, `Schema.TaggedErrorClass`). Default to adopting.
3. **Skip an Effect feature only if it hurts performance.** API breakage, plan mismatch, and large diffs are NOT reasons to skip — breakage is fine, we can always revert. Only a real performance regression justifies skipping.
4. When in doubt, measure/bisect rather than theorize (see "Debugging: bisect before you theorize" in AGENTS.md).

## Goal

Replace the most error-prone manual async plumbing in the agent loop with Effect-native constructs — `FiberSet`, `Stream`, `Queue`, `Scope`, `Schedule` — **without** changing tool implementations or the public API.

## v4 beta.90 API reality (source of truth: `openspec/references/effect-v4/` @ tag `effect@4.0.0-beta.90`)

This plan was originally drafted against the **v3** Effect reference. The workspace pins `effect@4.0.0-beta.90` (**v4**), whose API surface differs. Verified-against-v4-source API corrections:

| Phase            | Plan assumed (v3)                                                    | v4 beta.90 reality                                                                                                                                                                                           | Verdict                                                           |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 2b (push stream) | `Stream.asyncPush` / `async` / `asyncScoped`                         | **Absent.** Push-streams via `Queue` + `Stream.fromQueue(queue: Dequeue<A, E>): Stream<A, Exclude<E, Cause.Done>>`, with `Queue.end`/`endUnsafe` (clean Done) and error via the `E` channel.                 | Feasible via Queue→Stream                                         |
| 3 (Queue)        | `Queue.bounded<A>(n)`, `takeAll`→`Chunk`                             | `Queue.bounded<A, E = never>(n)`, `takeAll: Dequeue<A,E> => Effect<NonEmptyArray<A>, E>`, `take: Dequeue<A,E> => Effect<A, E>` (E = Done signal).                                                            | API exists; sync-vs-Effect API mismatch is architectural, not API |
| 4 (Scope)        | `Scope.make()` + `Scope.extend(scope)` + `Effect.fork`               | **`Scope.extend` and bare `Effect.fork` absent.** Use `Scope.make()` + `Scope.fork(scope)` / `Effect.forkIn(scope)` / `Effect.forkScoped` + `Scope.close(scope, exit)` + `Fiber.interrupt`/`join`.           | Feasible, different pattern                                       |
| 5 (Schedule)     | `Schedule.exponential().pipe(jittered, whileInput, compose(recurs))` | `exponential`/`jittered`/`recurs`/`spaced`/`andThen`/`either` exist. **`compose`/`whileInput`/`driver` absent.** Use `Effect.retry`'s options form `Retry.Options<E>` (has `times`/`whileError`/`schedule`). | Feasible via `Effect.retry` options                               |

Additional v4 note for Phase 4: `@ai-sdk`'s `streamText` cancels via web `AbortSignal` (agent-loop.ts `abortSignal: signal`), so the `AbortController` **cannot be fully eliminated** — Effect fiber interruption must be bridged to `controller.abort()` (e.g. via a scope finalizer). opencode avoids this by having an Effect-native LLM client; we wrap `@ai-sdk`, so the AbortSignal stays.

## Status

| Phase                                         | Status     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — FiberSet (parallel tools)                 | ✅ DONE    | `executeToolCallsParallel`/`executeToolCalls` are `Effect.fn`; `raceFirst(FiberSet.join, awaitEmpty)` await (learned from opencode `session/runner/llm.ts`). 373/373 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2a — Stream for LLM (production hot path)     | ✅ DONE    | `streamAssistantResponse` is `Effect.fn`; fullStream via `Stream.fromAsyncIterable` + `Stream.runForEach`; errors via `Effect.exit`. Composes natively in `runLoopEffect`. 373/373, baseline perf.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2b — Delete EventStream (test-facing adapter) | ✅ DONE    | Replaced by Effect `Queue` → `Stream.fromQueue` → `toReadableStream` (`createAgentEventStream`). `agentLoop`/`agentLoopContinue` return `AgentEventStream` (async-iterable + `result()`). Terminal signal via queue `E` channel (`Cause.Done` / `Error`). 365/365 tests, no bridge deadlock.                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3 — Queue for pending messages                | ⏸ DEFERRED | `PendingMessageQueue` is a correct sync abstraction (non-blocking drain, mutable mode, sync public API). Effect Queue is designed for concurrent producer/consumer backpressure — a different problem.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4 — Scope for lifecycle                       | ✅ DONE    | `ActiveRun` is now `{ fiber, abortController }` (dropped stored resolve). `runWithLifecycle` forks the Effect-native executor via `Effect.runFork`, joins via `Fiber.join`; `runPromptMessages`/`runContinuation` pass `runAgentLoopEffect`/`runAgentLoopContinueEffect` directly (no nested `Effect.runPromise`). `waitForIdle()` joins the fiber. AbortController stays (sync `abort()` for @ai-sdk + listeners, mirroring opencode's aisdk.ts). Race fix: `activeRun` set before `runFork` (first emit is eager). 365/365 tests.                                                                                                                                                                |
| 5 — Schedule for retry                        | ⏸ DEFERRED | v4 `Effect.retry({while, until, times, schedule})` exists and works — but our retry is value-based (turn returns `stopReason:"error"` as a _success_), with rich per-retry side effects (`auto_retry_start` emit needing the next `delayMs`+attempt, `rollbackLeaf`, single terminal `auto_retry_end`). Mapping these onto `Effect.retry`+`schedule.tap` is more code than the clear manual loop. Narrow swap (`abortableSleep`→`Effect.sleep`) fails because `abort()` is signal-based, not fiber-interruption. opencode only uses `Schedule.exponential().pipe(jittered)` on real-failing effects. Best revisited if the turn becomes a typed `Effect.fail` or the LLM layer goes Effect-native. |

## Constraints

- **Tools stay plain TS** — bash, read, write, edit remain `async function` returning `Promise`. Effect wraps them at the boundary with `Effect.promise(() => tool.execute(...))`. (`Effect.promise` is correct here because tool results encode failures as values — the promise should never reject. If it does, that's a defect, not a recoverable error. `Effect.tryPromise` would be needed if tool errors were throws.)
- **Incremental adoption** — each phase is independently shippable. Rollback is one revert.
- **No `Effect.runPromise` sandwich** — once a function is Effect-native, it stays Effect-native for composition. `runPromise` is called only at the outermost boundary (agent.ts / harness entry points).
- **Test compatibility** — existing tests use vitest, not `@effect/vitest`. Effect-native functions expose a `runTest()` helper that returns `Promise` for existing test fixtures.

---

## Phase 1: FiberSet for Parallel Tool Execution

**Scope:** `core/agent-loop.ts` — replace `Promise.all` in `executeToolCallsParallel` with `FiberSet`.

**Files to touch:**

- `packages/agent/src/core/agent-loop.ts`

**Current code** (lines 839-928):

```ts
async function executeToolCallsParallel(...) {
  const finalizedCalls: FinalizedToolCallEntry[] = [];
  for (const toolCall of toolCalls) {       // serial prep
    await emit({ type: "tool_execution_start", ... });
    const preparation = await prepareToolCall(...);  // permission + validation
    finalizedCalls.push(async () => { ... });         // thunk
  }
  // batch fire
  const ordered = await Promise.all(finalizedCalls.map(e => typeof e === "function" ? e() : e));
  ...
}
```

**Target code** (Effect-native, based on `openspec/references/effect/packages/effect/src/FiberSet.ts`):

Note: `FiberSet.join` returns `void` (surfaces errors but doesn't collect values). Results are stored in a mutable array indexed by position to preserve ordering. `FiberSet.make()` requires `Scope.Scope` in `R`.

```ts
const executeToolCallsParallel = Effect.fn("agent-loop.executeToolCallsParallel")(
  function* (
    currentContext, assistantMessage, toolCalls, config, signal, emit
  ): Effect<ExecutedToolCallBatch, never, Scope.Scope> {
    const finalOutcomes: Array<{ index: number; outcome: FinalizedToolCallOutcome }> = [];
    const set = yield* FiberSet.make<FinalizedToolCallOutcome>();

    for (const [i, toolCall] of toolCalls.entries()) {
      yield* emit({ type: "tool_execution_start", ... });

      const preparation = yield* Effect.promise(() => prepareToolCall(...));

      if (preparation.kind === "immediate") {
        const finalized = { ... };
        yield* emitToolExecutionEnd(finalized);
        finalOutcomes.push({ index: i, outcome: finalized });
      } else {
        // FiberSet.run forks the effect into the set, auto-removes on completion
        yield* FiberSet.run(set,
          Effect.gen(function* () {
            const executed = yield* Effect.promise(() =>
              executePreparedToolCall(preparation, signal, emit)
            );
            const finalized = yield* Effect.promise(() =>
              finalizeExecutedToolCall(...)
            );
            finalOutcomes.push({ index: i, outcome: finalized });
          })
        );
      }
    }

    yield* FiberSet.join(set); // wait for all, surfaces first error
    const ordered = finalOutcomes.sort((a, b) => a.index - b.index).map(r => r.outcome);
    return {
      messages: ordered.flatMap(o => o.messages),
      terminate: shouldTerminateToolBatch(ordered),
    };
  }
)
```

**What this buys:**

- **Fork-on-arrival** — second tool starts executing before preparation of the third is done
- **Structured cancellation** — `FiberSet.join` is interruptible; if the parent fiber is interrupted, all tool fibers cancel automatically (no more `acceptingUpdates` boolean)
- **Supervision** — `Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))` handles edge cases

**Call-site integration (Phase 1):** Since `FiberSet.make()` requires `Scope.Scope`, the call site must wrap with `Effect.scoped` until Phase 4 provides the scope from `runWithLifecycleEffect`:

```ts
// Phase 1 (no scope available yet):
const batch = await Effect.runPromise(
  Effect.scoped(executeToolCallsParallel(...))
)
// Phase 4+ (scope comes from runWithLifecycleEffect naturally):
const batch = await Effect.runPromise(executeToolCallsParallel(...))
```

**Risk:** Low. Tool execution functions are unchanged. The Effect boundary is clean (`Effect.promise(() => ...)`). If anything breaks, revert to `Promise.all`.

**Test impact:** `executeToolCallsParallel` gains an Effect signature. Existing tests that import it need to call `Effect.runPromise(Effect.scoped(...))`. Tests that only test through the top-level `runLoopEffect` work unchanged.

---

## Phase 2: Stream for LLM Event Streaming

**Scope:** Replace `EventStream` (manual push/wait queue) with Effect `Stream`.

**Files to touch:**

- `packages/agent/src/core/event-stream.ts` — **delete** (111 lines)
- `packages/agent/src/core/agent-loop.ts` — replace `for await (const part of fullStream)` with `Stream.runForEach`
- `packages/agent/src/core/stream-assistant-response.ts` (or wherever the LLM stream is created) — return a `Stream<Part>` instead of an `EventStream`

**Current plumbing:**

```
@ai-sdk/streamText → AsyncIterable → EventStream(push/wait) → for await (consume)
```

**Target plumbing:**

```
@ai-sdk/streamText → AsyncIterable → Stream.fromAsyncIterable → Stream.runForEach
```

**Key changes:**

1. **Delete `event-stream.ts`** — no more manual queue with stored resolve callbacks, no more `finalResultPromise.catch(() => {})`, no more dual error delivery.

2. **Stream parts as Effect Stream:**

```ts
// Before: for await (const part of fullStream) { switch (part.type) { ... } }
// After:
yield* Stream.runForEach(
  Stream.fromAsyncIterable(fullStream, (e) => e instanceof Error ? e : undefined),
  (part) => Effect.sync(() => {
    switch ((part as any).type) {
      case "text-delta": ...
      case "tool-call": ...
      case "error": ...
    }
  })
)
```

3. **Tool call forking in-stream** — each `tool-call` part forks into `FiberSet` from Phase 1 (like opencode does), instead of collecting tool call blocks and processing after the stream ends.

**What this buys:**

- **No double error path** — errors propagate through Stream naturally (no separate `errorState` + `rejectFinalResult`)
- **Push/pull decoupling** — Stream handles backpressure if the consumer is slower than the producer
- **Structured completion** — `Stream.runForEach` returns `Effect<void>` that completes when the stream ends or errors
- **~100 lines deleted**

**Risk:** Moderate. This is the core streaming path. `Stream.fromAsyncIterable` is a thin wrapper so the actual iteration logic doesn't change — just the error handling and completion flow.

---

## Phase 3: Queue for Pending Message Management

**Scope:** Replace `PendingMessageQueue` in `agent.ts` with Effect `Queue`.

**Files to touch:**

- `packages/agent/src/agent/agent.ts` — `PendingMessageQueue` → `Queue<AgentMessage>`

**Current code** (lines 168-202):

```ts
class PendingMessageQueue {
  private messages: AgentMessage[] = [];
  private mode: "all" | "one-at-a-time";
  drain(): AgentMessage[] {
    if (this.mode === "all") { ... slice all ... }
    else { ... shift one ... }
  }
}
```

**Target code** (verified against source):

```ts
// In constructor:
this.steeringQueue = yield * Queue.bounded<AgentMessage>(100);
this.followUpQueue = yield * Queue.bounded<AgentMessage>(100);

// In drain (note: takeAll returns Chunk<A>, convert with Chunk.toReadonlyArray):
steeringQueue: Chunk.toReadonlyArray(yield * Queue.takeAll(queue));
followUpQueue: {
  const msg = yield * Queue.take(queue); // blocks until available
  // ... process one message ...
}
```

**What this buys:**

- **Backpressure** — bounded queue prevents unbounded memory growth
- **Shutdown signaling** — `Queue.shutdown()` in cleanup wakes all pending takers
- **Structured teardown** — queue is part of Scope, cleaned up automatically

**Risk:** Very low. The queue is a simple data structure with two modes. The `drain()` call sites in `prepareNextTurn` just need to be wrapped in `Effect.promise()`.

---

## Phase 4: Scope for Resource Cleanup

**Scope:** Replace `ActiveRun` (stored resolve + abort controller) with `Scope` + `Fiber`.

**Files to touch:**

- `packages/agent/src/agent/agent.ts` — `ActiveRun` type, `runWithLifecycle`, `interruptRun`, `finishRun`
- `packages/agent/src/agent/agent-harness.ts` — `startRunPromise`, `flushPendingSessionWrites`

**Current code** (agent.ts:541-568):

```ts
private async runWithLifecycle(executor) {
  const abortController = new AbortController();
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  this.activeRun = { promise, resolve: resolvePromise, abortController };
  try { await executor(abortController.signal); }
  catch (error) { ... handle failure ... }
  finally { this.finishRun(); }
}
```

**Target code** (per processes.md §Scope Patterns — Manual; verified against source):

```ts
private readonly runWithLifecycle = Effect.fn("Agent.runWithLifecycle")(
  function* <R>(executor: Effect.Effect<R>) {
    const scope = yield* Scope.make();
    const fiber = yield* Effect.fork(
      executor.pipe(Scope.extend(scope))
    );
    this.activeRun = { fiber, scope };
    const result = yield* fiber.join();
    yield* Scope.close(scope, Exit.succeed(undefined));
    return result;
  }
);

// External interruption (called from async code):
interruptRun() {
  const run = this.activeRun;
  if (run) {
    Effect.runPromise(Scope.close(run.scope, Exit.succeed(undefined)));
  }
}
```

**Pattern explanation:**

- `Scope.make()` creates a manual, closeable scope (not auto-closed by `Effect.scoped`)
- `Scope.extend(scope)` ties the executor's resources to our scope and removes `Scope` from its requirements
- `Effect.fork` spawns the executor as a child fiber within the scope
- `Scope.close(scope, Exit.succeed(undefined))` on interruption terminates the scope, which cascades to all fibers and resources registered in it

**What this buys:**

- **No stored resolve** — `Fiber.join()` replaces the promise-based completion
- **Structural interruption** — `Scope.close` cascades cancellation through all child fibers (including Phase 1's FiberSet), replacing the manual `AbortController.abort()` + `acceptingUpdates` boolean
- **Automatic scope teardown** — when scope closes, all acquired resources (queues from Phase 3, temp files) are finalized automatically
- **No manual `signal?.aborted` checks** — Effect-interrupted fibers stop at the next yield point automatically

**Risk:** Medium. This is the lifecycle entry point — affects `prompt()`, `continue()`, and `interrupt()`. The public API stays the same (still returns `Promise` via `Effect.runPromise`), so consumers don't change.

---

## Phase 5: Schedule for Retry Backoff

**Scope:** Replace `abortableSleep` + manual backoff in `retry-loop.ts` with Effect `Schedule`.

**Files to touch:**

- `packages/agent/src/compaction/retry-loop.ts` — `abortableSleep()`, `executeWithRetryEffect()`

**Current code:**

```ts
const delay = computeRetryDelay(attempt, baseDelayMs);
const slept = await abortableSleep(delay, signal);
if (!slept) {
  /* aborted */ return;
}
```

**Target code:**

```ts
const policy = Schedule.exponential(baseDelayMs).pipe(
  Schedule.jittered(),
  Schedule.whileInput(() => shouldRetry(input)),
  Schedule.compose(Schedule.recurs(maxRetries)),
);
yield * Effect.retry(turnEffect, policy);
```

**What this buys:**

- **Jitter** — prevents thundering herd (multiple sessions retrying in sync)
- **Composition** — `.pipe(Schedule.whileInput(...), Schedule.compose(...))` expresses intent without manual counters
- **Deletes `abortableSleep()`** — no more `setTimeout`/`removeEventListener` management
- **Interruptible by default** — `Effect.retry` respects the parent fiber's interruption

**Risk:** Very low. Same logic, less code.

---

## Effect Style Guidelines

Based on the Effect-TS skill (`.opencode/skills/effect-ts/`):

### Use `Effect.fn` for all orchestration functions

Every Effect function that appears at the module boundary should use `Effect.fn` for call-site tracing and named spans:

```ts
const executeToolCallsParallel = Effect.fn("agent-loop.executeToolCallsParallel")(function* (
  ...args
) {
  // ...
});
```

This applies to: `executeToolCallsParallel`, `executeWithRetry`, `runWithLifecycle`, `processStream` — any publicly composed Effect sequence.

### Prefer `Effect.gen` over chaining

Use `Effect.gen(function* () { ... yield* ... })` for sequential composition. Reserve `.pipe()` for cross-cutting concerns (retry, timeout, provide).

### Error types use `Schema.TaggedErrorClass`

If new domain errors are introduced (e.g., `ToolExecutionError`, `StreamInterruptedError`), define them as `Schema.TaggedErrorClass` so they're yieldable, serializable, and pattern-matchable with `catchTag`.

### Provide once at the boundary

`Effect.runPromise` is called only at `prompt()` / `continue()` / `interrupt()`. All intermediate code stays Effect-native for composition.

### Verification Complete

All APIs verified against `openspec/references/effect/packages/effect/src/`:

| API                                           | Found at          | Verdict | Notes                                                                                                             |
| --------------------------------------------- | ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `FiberSet.make()`                             | `FiberSet.ts:117` | ✅      | Returns `Effect<FiberSet<A, E>, never, Scope>` — requires `Effect.scoped` or `Scope.extend`                       |
| `FiberSet.run(set, effect)`                   | `FiberSet.ts:306` | ✅      | Forks effect into set, returns `Effect<RuntimeFiber>`. Auto-removes on completion.                                |
| `FiberSet.join(set)`                          | `FiberSet.ts:477` | ✅      | Returns `Effect<void, E>` — **does NOT collect values**. Use mutable array + index to collect results.            |
| `FiberSet.add`                                | `FiberSet.ts:242` | ✅      | Takes `RuntimeFiber` (already running). Prefer `FiberSet.run` for new effects.                                    |
| `Stream.fromAsyncIterable(iterable, onError)` | `Stream.ts:1903`  | ✅      | Signature: `<A, E>(iterable: AsyncIterable<A>, onError: (e: unknown) => E) => Stream<A, E>`                       |
| `Queue.bounded(n)`                            | `Queue.ts:435`    | ✅      | Returns `Effect<Queue<A>>` — must be yielded, not called sync                                                     |
| `Queue.take(queue)`                           | `Queue.ts:598`    | ✅      | Returns `Effect<A>` — blocks until available                                                                      |
| `Queue.takeAll(queue)`                        | `Queue.ts:607`    | ✅      | Returns `Effect<Chunk<A>>` — **not `A[]`**, use `Chunk.toReadonlyArray`                                           |
| `Queue.shutdown(queue)`                       | `Queue.ts:535`    | ✅      | Returns `Effect<void>` — wakes all pending takers                                                                 |
| `Scope.make()`                                | `Scope.ts:202`    | ✅      | Returns `Effect<CloseableScope>` — can take optional `ExecutionStrategy`                                          |
| `Scope.extend(scope)`                         | `Scope.ts:163`    | ✅      | Dual: `Scope.extend(scope)(effect)` or `effect.pipe(Scope.extend(scope))`                                         |
| `Scope.close(scope, exit)`                    | `Scope.ts:152`    | ✅      | Signature: `(CloseableScope, Exit<unknown, unknown>) => Effect<void>` — use `Exit.succeed(undefined)` for success |
| `Effect.fn(name)`                             | `Effect.ts:14630` | ✅      | Returns `fn.Gen & fn.NonGen`. Call with `(function* () { ... }, ...policies?)`                                    |
| `Effect.promise(() => p)`                     | Source            | ✅      | Wraps promise, rejects become defects (correct for value-encoded tool errors)                                     |

---

## Migration Strategy

### Dependency order (no circular deps)

```
Phase 4 (Scope) ─→ Phase 2 (Stream) ─→ Phase 1 (FiberSet) ─→ Phase 3 (Queue) ─→ Phase 5 (Schedule)
     │                                    │
     └── provides lifecycle +             └── provides fiber dispatch
          interruption context                  for tool execution
```

### Actual implementation order (lowest risk first)

| Order | Phase        | Effort   | Risk     | Delivers                                                |
| ----- | ------------ | -------- | -------- | ------------------------------------------------------- |
| 1     | 1 — FiberSet | 1-2 days | Low      | Structured concurrency for tool execution               |
| 2     | 5 — Schedule | 0.5 day  | Very low | Removes manual abortableSleep                           |
| 3     | 3 — Queue    | 0.5 day  | Very low | Removes PendingMessageQueue                             |
| 4     | 2 — Stream   | 2-3 days | Medium   | Removes EventStream, enables fiber-per-tool from stream |
| 5     | 4 — Scope    | 1-2 days | Medium   | Removes ActiveRun + AbortController plumbing            |

Each phase includes:

- **RED**: Write tests that exercise the Effect path (they exist, just need `Effect.runPromise`)
- **GREEN**: Implement the change
- **REFACTOR**: Run `pnpm run fix`, `pnpm run typecheck`, `pnpm run test` in the agent package

### What stays unchanged

- `packages/tools/` — all tools remain plain async functions
- `packages/llm/` — stays as-is (wraps `@ai-sdk` providers)
- `packages/db/` — stays as-is (node:sqlite + Drizzle)
- `packages/logger/` — stays as-is
- Public API of `Agent` class — `prompt()`, `continue()`, `interrupt()` stay as async methods
- All TypeScript types exported by `@sakti-code/agent` — unchanged

## Total impact

| Metric                         | Before                                                                | After                                           |
| ------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------- |
| Lines of custom async plumbing | ~200 (EventStream + abortableSleep + PendingMessageQueue + ActiveRun) | ~0                                              |
| Manual `AbortSignal` checks    | ~15 (agent-loop, retry-loop)                                          | ~0 (only at the Effect→Promise boundary)        |
| `Effect.runPromise` callsites  | ~8 (various entry points)                                             | ~2 (agent.ts and agent-harness.ts entry points) |
| Tool implementation changes    | 0                                                                     | 0                                               |
| Public API changes             | —                                                                     | 0                                               |
