# Agent Effect End-to-End — Design

Status: design approved 2026-06-29. Next step: implementation plan (writing-plans).

## Problem

The agent package is half-Effect: the hot loop (`runLoopEffect`) is Effect-native
(FiberSet for parallel tools, Stream for the LLM token stream), but the
**harness** that wraps it (`AgentHarness`) and the **server agent layer**
(`apps/server/src/agent`) are Promise/async. The Promise↔Effect boundary sits
_inside_ the event path:

```
runLoopEffect (Effect) → emit callback → handleAgentEvent (async) → subscribe(callback) → ws.send
```

This causes real problems:

1. **A timing flake.** Swapping `runAgentLoop` (Promise; emits `agent_start` via
   `await emit`) for `runAgentLoopEffect` (Effect; emits via `Effect.promise`,
   eager) shifted event timing across the async-callback boundary and flaked the
   WS event-frame test ~1/3 runs. Root cause: a boundary _inside_ the event
   chain, not the Effect APIs.
2. **Per-token serialization.** `handleAgentEvent` does
   `for (listener of handlers) await listener(event)` — every token waits for
   every subscriber to settle. A slow subscriber backpressures the whole LLM
   stream (agent-harness.ts:348-350, 365-367).
3. **Dropped tool-call argument deltas.** `streamAssistantResponse` ignores
   `tool-input-delta` parts (agent-loop.ts:635) — only the complete `tool-call`
   is emitted. While the LLM generates a large edit / long bash command, the UI
   sees nothing → "looks like the LLM is stalling."
4. **Value-based retry.** `executeWithRetry` checks the success-returned
   `AssistantMessage` (`stopReason: "error"`) in a manual `while` loop with
   `abortableSleep`. `Effect.retry` + `Schedule` can't apply because the turn
   failure isn't a typed `Effect.fail`.

## Goal

Make the agent package Effect-native **end-to-end** — run, event delivery,
lifecycle, retry, and persistence — with the only `Effect.runPromise` boundary
at the Hono WS/REST edge. Mirror opencode's model (`PubSub` event bus, `Fiber`/
`Scope` lifecycle, `Effect.retry`) adapted to our Hono + node:sqlite stack.

## Guiding principles (priority order)

1. **Performance / UX first** — the single most important criterion. Visible
   streaming throughput matters: the UI must show real LLM progress, including
   tool-call arguments being written.
2. **Adopt Effect maximally** — default to adopting; skip only if it hurts
   performance.
3. **No boundary inside the agent logic** — the sole `Effect.runPromise`
   handoff is at the network edge (Hono handler). This is the same place
   opencode's `HttpRouter.toWebHandler` sits, just inside `@effect/platform`.
4. **Breakage is fine, revert is cheap.** Tests encoding the old Promise-timing
   contract are "false positives" and get rewritten to Stream-based consumption.

## Scope

In:

- `packages/agent/src/agent/agent-harness.ts` — run, lifecycle, event bus.
- `packages/agent/src/compaction/retry-loop.ts` — `Effect.retry` + `Schedule`.
- `packages/agent/src/core/agent-loop.ts` — emit `tool-input-delta` (Section 6).
- `packages/agent/src/types.ts` — `message_update` delta extension.
- `packages/db/src/session-entry-store.ts` + the storage interface in
  `packages/agent` — Effect-native persistence.
- `apps/server/src/agent/` (ws-handler.ts, runner.ts) — the WS edge boundary,
  `activeRuns`/`abort` → `Fiber.interrupt`, retry caller wiring.
- `apps/server/src/routes/*` — one `Effect.runPromise` per REST route at the edge.

Out:

- The Hono server itself (we keep Hono + `@hono/node-server` + `ws`; we do **not**
  migrate to `@effect/platform`'s `HttpServer` — that's a separate future migration).
- The desktop (`apps/desktop`) — consumes via Hono RPC + WS frames; the frame
  wire-format is unchanged, so it is untouched.
- The `Agent` class (`packages/agent/src/agent/agent.ts`) — redundant (zero
  production consumers; the harness is a strict superset). Deleted in a separate
  cleanup, not this migration.

## API decisions

- **Harness public API becomes Effect-typed**: `prompt`/`continue` return
  `Effect<AssistantMessage>`; `abort`/`waitForIdle` are Effect-typed. The server
  consumes them natively; the only `Effect.runPromise` is at the Hono edge.
- **Keep Hono + the typed RPC** (`hcWithType<App>`) the desktop uses.
- **Storage API becomes Effect-typed**: `SessionStorage` interface with
  `Effect`-returning methods; `SqliteSessionStorage` ops become `Effect.fn` /
  `Effect.sync` (node:sqlite is synchronous — a natural fit).

## v4 beta.90 API basis

Verified against `openspec/references/effect-v4/` (tag `effect@4.0.0-beta.90`):
`PubSub.bounded/unbounded`, `Stream.fromPubSub`, `Scope.make/fork/close`,
`Effect.forkIn/forkScoped`, `Effect.addFinalizer`, `Effect.ensuring`,
`Fiber.interrupt/join`, `Effect.retry({while, until, times, schedule})`,
`Schedule.exponential/jittered/tap/recurs/spaced`, `Effect.fn`. (`Stream.asyncPush`
and `Scope.extend` do **not** exist in beta.90 — we use `PubSub` + `Stream.fromPubSub`
instead.)

---

## Section 1 — Event delivery & data flow (the spine)

Replace the async-callback event path with an Effect `PubSub` event bus.
Decouple "emit" from "persist".

```
runLoopEffect (Effect)
  → yield* pubsub.publish(event)             ← Effect, composed in the run's gen

PubSub<AgentHarnessEvent>  ──┬── Stream.fromPubSub → Stream.runForEach(.. ws.send)   [WS edge]
                             └── Stream.fromPubSub → Stream.runForEach(.. persist)     [persistence subscriber]
```

- **Event bus**: `PubSub.bounded<AgentHarnessEvent>(capacity)` owned by the
  harness (unbounded by default — no event loss; bounded+backpressure is a later
  tuning knob). The loop's existing `emit` sink publishes into it.
- **Subscribers are Streams**: `harness.subscribeStream()` returns a fresh
  `Stream.fromPubSub(pubsub)` per caller. Multi-subscriber via PubSub broadcast.
- **Split `handleAgentEvent`** (today: reduce-state + persist + notify, inline):
  - a pure state reducer,
  - a persistence subscriber (Section "Persistence"),
  - the PubSub publish.
- **Why this kills the flake**: the boundary moves from inside the event chain
  (eager Effect emit → async callback → fragile timing) to the `ws.send` edge —
  a single, deliberate `Stream.runForEach` handoff.

### Persistence → Effect-native

`SqliteSessionStorage implements PromiseSessionStorage` today (all methods
`async`, even though node:sqlite is sync). Migrate:

- Define an Effect-native `SessionStorage` interface (Effect-typed methods).
- `SqliteSessionStorage` methods become `Effect.fn` / `Effect.sync`
  (`db…get()` is sync → `Effect.sync(() => …)`; transactions → `Effect.gen`).
- The persistence subscriber composes natively (no `Effect.promise` wrapper).
- Mirrors opencode's `effect-drizzle-sqlite` / `effect-sqlite-node` approach; we
  keep node:sqlite + Drizzle, just expose operations as Effects.

## Section 2 — Run lifecycle (Scope / Fiber / abort bridge)

Replace `runAsTurn` + `startRunPromise` (stored-resolve latch) +
`runAbortController` with opencode-style Effect lifecycle.

- **`prompt`/`continue` are `Effect<AssistantMessage>`** (`Effect.gen`).
- **Run as a Fiber in a Scope**: `Scope.make()` + `Effect.forkIn(scope)`/
  `forkScoped` of `runAgentLoopEffect(...)`. The run + its FiberSet (parallel
  tools) + PubSub live in this scope.
- **`waitForIdle()`** → `Effect.runPromise(Fiber.join(run.fiber))` (drop the
  `startRunPromise`/`runPromise` latch entirely).
- **AbortController stays — bridged via a finalizer** (`@ai-sdk`'s `streamText`
  cancels via web `AbortSignal`). Inside the run: create `AbortController`,
  register `Effect.addFinalizer(() => Effect.sync(() => controller.abort()))`.
- **`abort()`** = `Effect.runPromise(Fiber.interrupt(run.fiber))`. The finalizer
  fires → `@ai-sdk` fetch cancels + Effect interruption stops the loop at the
  next yield. **This is the structured cancellation Phase 4 promised** — safe now
  because the whole run is one Effect pipeline (no internal boundary to race).
- **`retryAbort`** (the runner's cross-turn abort) folds into the same fiber
  model — the retry Effect (Section 3) is interruptible as a unit.

## Section 3 — Retry loop (Effect.retry + Schedule)

Replace the manual `while` + `abortableSleep` loop.

- **Turn returns `Effect<AssistantMessage>`**. A _retryable_ failure (the
  value-encoded `stopReason: "error"` matching `isRetryableAssistantError`)
  becomes a typed failure: `Effect.fail(new TurnTransientError(message))`.
  Non-retryable errors and successes pass through.
- **`Effect.retry`** drives the retry:
  ```ts
  const schedule = Schedule.exponential(settings.baseDelayMs).pipe(
    Schedule.jittered,
    Schedule.tap((out) => Effect.gen(function* () {
      yield* emit({ type: "auto_retry_start", attempt, delayMs: out.delay, … });
      yield* rollbackLeaf;        // native Effect once storage migrates
    }))
  );
  turnOrTransientFail.pipe(Effect.retry({ while: (_) => true, times: settings.maxRetries, schedule }));
  ```
- **`abortableSleep` deleted** — `Schedule` owns the backoff; interruption is
  automatic via the run fiber (no `signal?.aborted` checks, no
  setTimeout/removeEventListener).
- **`auto_retry_end`** (single terminal event) → `Effect.onExit`/`Effect.ensuring`
  on the whole retry.
- **Compaction phase** stays a follow-up `Effect.gen` composed after the retry
  settles.
- **Whole retry is one interruptible unit** — `abort()` interrupts the run fiber,
  cancelling in-flight backoff + turn immediately.

Wins: removes ~60 lines of manual loop + `abortableSleep`; gains jittered backoff
(thundering-herd prevention); structured interruption; the value-based-retry wart
is gone (turn is a real `Effect.fail`).

## Section 4 — The WS/REST edge (single Hono boundary)

One `Effect.runPromise` at the edge; two concurrent fibers inside.

```ts
// Hono WS message handler — the only Effect→Promise boundary for the agent path
Effect.runPromise(
  Effect.gen(function* () {
    const events = harness.subscribeStream(); // Stream from PubSub
    const fiber = yield* Effect.fork(harness.prompt(text)); // publishes events as it runs
    yield* Stream.runForEach(
      events,
      (e) => Effect.sync(() => ws.send(JSON.stringify(toFrame(e, sessionId)))), // ← the edge handoff
    );
    yield* Fiber.join(fiber); // surface run failure → error frame
  }),
).catch((err) => ws.send(errorFrame(sessionId, err)));
```

- **`harness.subscribeStream(): Stream<AgentHarnessEvent>`** replaces
  `subscribe(callback)`.
- **Coordination**: prompt fiber completes → harness closes the PubSub → event
  Stream ends → `Stream.runForEach` returns → join confirms success/failure.
- **`activeRuns` registry** (runner.ts) stores `{ harness, runFiber }` instead of
  `{ harness, unsubscribe }`. `abortRun(sessionId)` →
  `Effect.runPromise(Fiber.interrupt(runFiber))`.
- **REST edge**: `app.post("/…", async (c) => c.json(await Effect.runPromise(harness.someEffect())))`
  — one `runPromise` per route, at the edge.
- **Desktop**: untouched (frame wire-format unchanged).

## Section 5 — Tests (rewrite the "false positives")

**Behavioral contracts stay; consumption mechanics change to Stream-based.**

Keep: event ordering + `sessionId`; `abort` cancels; `waitForIdle` resolves;
`busy` guard; retry emits `auto_retry_start`/`auto_retry_end` with correct
attempt/delay; persistence correctness.

Change:

- **Event consumption → Stream, not callback+setTimeout.** The ws "prompt
  produces event frames" test becomes deterministic: consume
  `harness.subscribeStream()` via `Stream.runCollect`/`runForEach` raced with the
  run fiber. No 100ms wait, no timing race.
- **API calls via Effect**: `await Effect.runPromise(harness.prompt(text))`, or
  `it.effect` with `@effect/vitest` (already a devDep).
- **Storage tests**: rewritten for Effect-typed ops.
- **Retry tests**: value-based → typed-failure (`Effect.catchTag("TurnTransientError")`).

Churn:

- `packages/agent/src/agent/__tests__/agent-harness.test.ts` (37) +
  `-continue.test.ts` (4): rewritten to Effect API + Stream consumption.
- `apps/server/src/agent/__tests__/ws.test.ts`, `e2e.test.ts`: Stream-based.
- `packages/agent/src/compaction/__tests__/retry-loop.test.ts`: retry mechanics.
- `packages/db/src/__tests__/session-entry-store*.test.ts`: Effect storage ops.
- **Deleted** (separate cleanup): `agent.test.ts` + the `Agent` class.
- **Desktop tests**: untouched.

## Section 6 — Streaming throughput & live tool-call args

Two concrete UX wins (the user's core motivation: the UI must show the LLM is
making progress, especially during large tool-call generation).

### 6a. Remove per-token listener serialization

Today every `message_update` does
`for (listener of handlers) await listener(event)` — tokens pile up behind the
slowest subscriber. `PubSub.publish` is a non-blocking broadcast into each
subscriber's queue; the `ws.send` subscriber pulls tokens as fast as the PubSub
delivers them, decoupled from the persistence subscriber. For a fast UI (the
desktop uses velomark, which paints fast), this is straight-throughput-to-screen.

### 6b. Stream tool-call arguments live (`tool-input-delta`)

Extend the `message_update` delta union with a `tool_input` kind:

```ts
// packages/agent/src/types.ts
delta:
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_input"; toolCallId: string; text: string }   // NEW
```

In `streamAssistantResponse`, handle the currently-discarded `tool-input-delta`:

```ts
case "tool-input-delta": {
  yield* ensureMessageStarted();
  yield* emitEffect(emit, {
    type: "message_update",
    delta: { kind: "tool_input", toolCallId: part.toolCallId, text: part.input },
  });
  break;
}
```

The `text` is `@ai-sdk`'s raw argument fragment (partial JSON). Final parsed
args still come from the complete `tool-call` part, so loop logic is unaffected —
the deltas are pure UI feed.

**UI lifecycle (for the planned "Writing toolcall…" component):**

- First `message_update` (`kind: tool_input`, `toolCallId=X`) → mount placeholder,
  append on each subsequent delta.
- `message_end` (assistant message with the complete tool-call block) → tool call
  fully written.
- `tool_execution_start` (`toolCallId=X`, `toolName`) → swap placeholder → real
  tool-call component. Multiple concurrent tool calls key by `toolCallId`.

**Open detail:** whether the `toolName` is available before the complete
`tool-call` (via `tool-input-start`). If so, carry it in the first `tool_input`
delta so the UI can render "Writing **edit**…" immediately; otherwise the
placeholder is generic until `tool_execution_start`. Verify during implementation.

### Honest scope on throughput

The `@ai-sdk` read rate is unchanged (already `Stream.runForEach` since the
earlier Phase 2a). The wins are in **delivery** (no per-token serialization;
fast subscriber decoupled) **+ the tool-input-delta gap** (new live streaming).
Net: lower per-token latency to the UI _and_ visible progress during tool-call
generation.

---

## File map

| Section       | Files                                                                                      | Package        |
| ------------- | ------------------------------------------------------------------------------------------ | -------------- |
| 1 event bus   | `packages/agent/src/agent/agent-harness.ts`                                                | agent          |
| 1 persistence | `packages/db/src/session-entry-store.ts` + storage interface in `packages/agent`           | db + agent     |
| 2 lifecycle   | `packages/agent/src/agent/agent-harness.ts`                                                | agent          |
| 3 retry       | `packages/agent/src/compaction/retry-loop.ts` + `apps/server/src/agent/runner.ts` (caller) | agent + server |
| 4 WS edge     | `apps/server/src/agent/ws-handler.ts`, `apps/server/src/agent/runner.ts`                   | server         |
| 4 REST edge   | `apps/server/src/routes/*`                                                                 | server         |
| 6b tool-input | `packages/agent/src/core/agent-loop.ts`, `packages/agent/src/types.ts`                     | agent          |

## Non-goals / future

- Migrate the Hono server to `@effect/platform`'s `HttpServer` (opencode-parity
  for the server) — separate migration.
- Delete the `Agent` class — separate cleanup (this migration makes it cleanly
  deletable since `runAgentLoopEffect` will be consumed by the harness).
- Bounded PubSub with backpressure tuning — only if memory profiling demands it.
