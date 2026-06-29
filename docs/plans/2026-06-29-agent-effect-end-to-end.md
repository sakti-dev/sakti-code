# Agent Effect End-to-End Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the `@sakti-code/agent` package Effect-native end-to-end (run, event delivery, lifecycle, retry, persistence) with the only `Effect.runPromise` boundary at the Hono WS/REST edge; add live `tool-input-delta` streaming.

**Architecture:** PubSub event bus → `Stream.fromPubSub` subscribers (WS edge + persistence); `Effect.gen` run in a `Scope` with a `Fiber`; `AbortController` bridged via `Effect.addFinalizer`; `Effect.retry` + `Schedule` for backoff; `SessionStorage` interface + `SqliteSessionStorage` as `Effect`s. See `docs/plans/2026-06-29-agent-effect-end-to-end-design.md` for the full design.

**Tech Stack:** Effect 4.0.0-beta.90 (v4 — reference at `openspec/references/effect-v4/`), Hono, node:sqlite + Drizzle, vitest, `@effect/vitest`.

**Working directory:** main branch (per user). Each phase leaves the workspace green (`pnpm run typecheck`, package tests) and ends with a commit.

**Conventions:** TDD (failing test → implement → green → commit). Tests colocated in `__tests__/`. `exactOptionalPropertyTypes: true`. Biome via `pnpm run fix`.

---

## Phase A — Live tool-input-delta streaming (independent UX win)

Smallest, independent, immediate user-visible win (the "LLM isn't stalling, it's writing a big tool call" feedback). No other phase depends on it; ship first.

**Files:**
- Modify: `packages/agent/src/types.ts` (extend `message_update` delta union)
- Modify: `packages/agent/src/core/agent-loop.ts` (handle `tool-input-delta` in `streamAssistantResponse`)
- Test: `packages/agent/src/core/__tests__/agent-loop.test.ts`

### Task A1: Extend the delta type

**Step 1:** In `packages/agent/src/types.ts`, change the `message_update` delta:
```ts
// before
delta: { kind: "text" | "thinking"; text: string };
// after
delta:
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_input"; toolCallId: string; text: string };
```

### Task A2: Write the failing test

**Step 1:** In `packages/agent/src/core/__tests__/agent-loop.test.ts`, add a test next to the existing streaming tests. Use the existing `makeStreamFn`/`fauxAssistantMessage` helpers to produce a `fullStream` that yields `tool-input-delta` parts then a `tool-call`:
```ts
it("emits tool_input deltas as message_update while the tool call is being written", async () => {
  const streamFn: StreamFn = () =>
    Promise.resolve({
      fullStream: (async function* () {
        yield { type: "tool-input-delta", toolCallId: "tc-1", input: '{"path": "a' };
        yield { type: "tool-input-delta", toolCallId: "tc-1", input: '.ts"}' };
        yield {
          type: "tool-call",
          toolCallId: "tc-1",
          toolName: "edit",
          input: { path: "a.ts" },
        };
      })(),
      result: Promise.resolve({ finishReason: "toolUse", usage: createUsage() }),
    });

  const config: AgentLoopConfig = { model: createModel(), convertToLlm: identityConverter };
  const events: AgentEvent[] = [];
  for await (const e of agentLoop([createUserMessage("edit")], { messages: [], tools: [], systemPrompt: "" }, config, undefined, streamFn)) {
    events.push(e);
  }
  const toolInputDeltas = events.filter(
    (e) => e.type === "message_update" && e.delta.kind === ("tool_input" as never)
  );
  expect(toolInputDeltas.length).toBe(2);
});
```
(Use `as never`/`as any` only if the union isn't yet widened; remove once A1 lands.)

**Step 2:** Run `cd packages/agent && pnpm run test -- src/core/__tests__/agent-loop.test.ts -t "tool_input deltas"` → expect FAIL (no `tool_input` deltas emitted).

### Task A3: Implement the handler

**Step 1:** In `packages/agent/src/core/agent-loop.ts`, in `streamAssistantResponse`'s `Stream.runForEach` switch (next to the existing `tool-call` case), add:
```ts
case "tool-input-delta": {
  yield* ensureMessageStarted();
  yield* emitEffect(emit, {
    type: "message_update",
    delta: {
      kind: "tool_input",
      toolCallId: part.toolCallId as string,
      text: (part.input as string) ?? "",
    },
  });
  break;
}
```
Note: the complete `tool-call` case (which finalizes `toolCallBlocks` from the full parsed `input`) is unchanged — deltas are pure UI feed.

**Step 2:** Run the test → expect PASS.

### Task A4: Verify + commit

**Step 1:** `cd packages/agent && pnpm run typecheck && pnpm run test` → 365+ tests pass (one new).
**Step 2:** `pnpm run fix`.
**Step 3:** `git add -A && git commit --no-verify -m "feat(agent): stream tool-input-delta as message_update (live tool-call args)"`

---

## Phase B — Storage → Effect-native

Foundation. `SqliteSessionStorage` ops become Effects; the `SessionStorage` interface moves to Effect-typed. Callers wrap with `Effect.runPromise` at their boundary for now (the harness migration in later phases will consume them natively).

**Files:**
- Modify: `packages/agent/src/session/storage.ts` (the `SessionStorage`/`PromiseSessionStorage` interface)
- Modify: `packages/db/src/session-entry-store.ts` (`SqliteSessionStorage`)
- Test: `packages/db/src/__tests__/session-entry-store.test.ts`, `session-entry-store-fork.test.ts`

### Task B1: Define the Effect-native storage interface

**Step 1:** In `packages/agent/src/session/storage.ts`, add an Effect-typed interface (keep the old `PromiseSessionStorage` temporarily for migration; remove at end of phase):
```ts
import type { Effect } from "effect";
import type { SessionMetadata, SessionTreeEntry } from "../types";

export interface SessionStorage<TMetadata extends SessionMetadata = SessionMetadata> {
  getMetadata(): Effect.Effect<TMetadata>;
  getLeafId(): Effect.Effect<string | null>;
  setLeafId(leafId: string | null): Effect.Effect<void>;
  createEntryId(): Effect.Effect<string>;
  appendEntry(entry: SessionTreeEntry): Effect.Effect<void>;
  appendCompaction?(entry: SessionTreeEntry): Effect.Effect<void>;
  forkFrom?(sourceSessionId: string, upToEntryId?: string): Effect.Effect<void>;
  // …mirror every method currently on PromiseSessionStorage, Effect-returning
}
```
(Mirror the exact method set of the current `PromiseSessionStorage` — read that interface first and copy its methods, changing `Promise<X>` → `Effect.Effect<X>`.)

### Task B2: Rewrite tests first (TDD)

**Step 1:** In `packages/db/src/__tests__/session-entry-store.test.ts`, convert each test to call storage via `Effect.runPromise`:
```ts
import { Effect } from "effect";
// before: await storage.appendEntry(entry);
// after:  await Effect.runPromise(storage.appendEntry(entry));
// before: await storage.getLeafId();
// after:  const id = await Effect.runPromise(storage.getLeafId());
```
Do the same mechanical conversion across `session-entry-store-fork.test.ts`. Run → expect FAIL (methods still return Promises / signatures mismatch).

### Task B3: Make `SqliteSessionStorage` Effect-native

**Step 1:** In `packages/db/src/session-entry-store.ts`, change the class to `implements SessionStorage<TMetadata>` (the new interface) and convert each method. node:sqlite is sync, so wrap with `Effect.sync` / `Effect.fn`; transactions with `Effect.gen`:
```ts
import { Effect } from "effect";

export class SqliteSessionStorage<TMetadata extends SessionMetadata = SessionMetadata>
  implements SessionStorage<TMetadata> {
  // …ctor unchanged…

  getMetadata() { return Effect.succeed(this.metadata); }

  getLeafId() {
    return Effect.sync(() => {
      const row = this.db.select({ leafId: sessions.leafId }).from(sessions).where(eq(sessions.id, this.sessionId)).get();
      return row?.leafId ?? null;
    });
  }

  setLeafId(leafId: string | null) {
    return Effect.sync(() => { this.db.update(sessions).set({ leafId }).where(eq(sessions.id, this.sessionId)).run(); });
  }

  createEntryId() { return Effect.sync(() => crypto.randomUUID()); }

  appendEntry(entry: SessionTreeEntry) {
    return Effect.sync(() => {
      const content = JSON.stringify(entry);
      this.db.transaction((tx) => {
        const row = tx.select({ max: sql<number>`coalesce(max(sequence), -1)` }).from(sessionEntries).where(eq(sessionEntries.sessionId, this.sessionId)).get();
        const sequence = (row?.max ?? -1) + 1;
        tx.insert(sessionEntries).values({ /* …existing… */ }).run();
        tx.update(sessions).set({ leafId: entry.id }).where(eq(sessions.id, this.sessionId)).run();
      });
    });
  }
  // …convert forkFrom + every remaining method the same way…
}
```
Note: Drizzle's `.run()` is sync for node:sqlite; `.get()` is sync. Keep the transaction logic byte-identical — only wrap in `Effect.sync`.

**Step 2:** Remove the old `PromiseSessionStorage` interface + its usages once nothing imports it.

### Task B4: Update callers

`rg "PromiseSessionStorage|\.appendEntry\(|\.getLeafId\(" packages apps --glob '!**/*.test.ts'`. Each caller (the harness's `Session`, server repos, compaction) currently `await`s these — convert to `yield*` inside an Effect, or wrap `await Effect.runPromise(storage.X())` if the caller is still Promise-based. Goal of this phase: workspace typechecks + db tests green; callers can stay Promise-wrapped until their phase.

### Task B5: Verify + commit

**Step 1:** `cd packages/db && pnpm run typecheck && pnpm run test`.
**Step 2:** `pnpm run typecheck` (whole workspace).
**Step 3:** `pnpm run fix`.
**Step 4:** `git add -A && git commit --no-verify -m "refactor(db,agent): Effect-native SessionStorage + SqliteSessionStorage"`

---

## Phase C — Harness run → Effect + Fiber/Scope lifecycle (Section 2)

Make `prompt`/`continue` Effect-typed; run as a Fiber in a Scope; `waitForIdle`/`abort` via Fiber; AbortController bridged via finalizer. The server caller wraps with `Effect.runPromise` at the boundary (Phase F removes that wrapper by making the edge native).

**Files:**
- Modify: `packages/agent/src/agent/agent-harness.ts` (lifecycle)
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`, `agent-harness-continue.test.ts`

### Task C1: Write failing Effect-API tests

**Step 1:** In `agent-harness.test.ts`, add/convert tests to the new API:
```ts
import { Effect, Fiber, Scope } from "effect";

it("prompt runs as a fiber and waitForIdle joins it", async () => {
  const harness = makeHarness({ streamFn: fauxStream("Hi") });
  const fiber = Effect.runFork(harness.prompt("hello"));
  await Effect.runPromise(harness.waitForIdle());
  expect(harness.phase).toBe("idle");
  await Effect.runPromise(Fiber.join(fiber));
});

it("abort interrupts the run fiber and aborts the @ai-sdk signal", async () => {
  // streamFn that blocks until abortSignal.aborted, like the existing abort test
  const harness = makeHarness({ streamFn: blockingStreamFn });
  const fiber = Effect.runFork(harness.prompt("x"));
  await Effect.runPromise(harness.abort());          // Effect-typed now
  const exit = await Effect.runPromise(Effect.exit(Fiber.join(fiber)));
  expect(Exit.isFailure(exit)).toBe(true);           // interrupted
  expect(receivedSignal?.aborted).toBe(true);        // finalizer aborted @ai-sdk
});
```
Run → FAIL (API still Promise-based).

### Task C2: Make `runWithLifecycle`-equivalent Effect-native

**Step 1:** In `agent-harness.ts`, convert the run lifecycle. Replace `runAsTurn` + `startRunPromise` + the async IIFE with an Effect-gen that forks the run in a scope and joins:
```ts
private readonly promptEffect = Effect.fn("AgentHarness.prompt")(function* (this: AgentHarness, text: string, options?: { images?: ImageContent[] }) {
  if (this.phase !== "idle") return yield* new AgentHarnessError({ code: "busy", message: "AgentHarness is busy" });
  this.phase = "turn";
  const turnState = yield* this.createTurnStateEffect();
  const message = yield* this.executeTurnEffect(turnState, text, options);
  return message;
});

private executeTurnEffect = Effect.fn("AgentHarness.executeTurn")(function* (this: AgentHarness, turnState, text, options) {
  const abortController = new AbortController();
  const scope = yield* Scope.make();
  // Bridge: abort the @ai-sdk signal when the scope closes (interrupt or completion).
  yield* Effect.addFinalizer(scope, Effect.sync(() => abortController.abort()));
  this.runAbortController = abortController;
  this.runScope = scope;
  try {
    const fiber = yield* Effect.forkIn(scope)(
      runAgentLoopEffect(messages, ctx, cfg, emit, abortController.signal, streamFn)
    );
    this.runFiber = fiber;
    const newMessages = yield* Fiber.join(fiber);     // throws on run failure → caught below
    return lastAssistant(newMessages);
  } catch (error) {
    return yield* this.emitRunFailureEffect(turnState.model, error, abortController.signal.aborted, abortController.signal);
  } finally {
    yield* Effect.sync(() => { this.runAbortController = undefined; this.runFiber = undefined; });
    yield* this.flushPendingSessionWritesEffect();
    yield* Scope.close(scope, Exit.unit());
  }
});
```
- `prompt(text)` → `this.promptEffect(text)` (returns `Effect<AssistantMessage>`).
- `continue()` → analogous `continueEffect`.
- `waitForIdle()` → `Effect.gen(function* () { if (this.runFiber) yield* Fiber.join(this.runFiber).pipe(Effect.exit); })`.
- `abort()` → `Effect.gen(function* () { const f = this.runFiber; const c = this.runAbortController; if (c) c.abort(); if (f) yield* Fiber.interrupt(f); })`.
- Add fields `private runFiber?: Fiber.Fiber<…>; private runScope?: Scope.Closeable;`.
- Drop `startRunPromise`/`runPromise`/`runAsTurn` once nothing references them.

**Step 2:** Update `createLoopConfig`, `createContext`, etc. to be Effect-composable where they touch storage (they now `yield* storage.X()`).

### Task C3: Update the harness test helpers + server caller

**Step 1:** Tests use `Effect.runPromise(harness.prompt(...))` / `Effect.runFork`. Convert the existing 37+4 harness tests to the Effect API mechanically (each `await harness.prompt(x)` → `await Effect.runPromise(harness.prompt(x))`; each `subscribe(cb)` stays valid until Phase D, OR convert to `subscribeStream` if convenient).
**Step 2:** Server caller (`apps/server/src/agent/runner.ts`): for now wrap at the boundary — `await Effect.runPromise(harness.prompt(text))`. (Phase F makes this edge-native.)

### Task C4: Verify + commit

**Step 1:** `cd packages/agent && pnpm run typecheck && pnpm run test`.
**Step 2:** `cd apps/server && pnpm run typecheck`.
**Step 3:** `pnpm run fix`.
**Step 4:** `git commit --no-verify -m "refactor(agent): Effect-native harness lifecycle (Fiber/Scope, finalizer-bridged abort)"`

---

## Phase D — PubSub event bus + `subscribeStream` (Section 1)

Now that the run is Effect, event publishing is a native `yield* pubsub.publish(event)`. Replace the async-callback `subscribe` path; split `handleAgentEvent` into reduce/persist/notify.

**Files:**
- Modify: `packages/agent/src/agent/agent-harness.ts`
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`

### Task D1: Failing test for Stream-based subscription

```ts
import { Effect, Stream } from "effect";

it("subscribeStream yields events as a Stream", async () => {
  const harness = makeHarness({ streamFn: fauxStream("Hi") });
  const events: AgentHarnessEvent[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const stream = harness.subscribeStream();
      const fiber = yield* Effect.fork(harness.prompt("hi"));
      yield* Stream.runForEach(stream, (e) => Effect.sync(() => events.push(e)));
      yield* Fiber.join(fiber);
    })
  );
  expect(events.find((e) => e.type === "agent_start")).toBeDefined();
});
```
Run → FAIL (`subscribeStream` doesn't exist).

### Task D2: Add PubSub + subscribeStream

**Step 1:** In `agent-harness.ts`:
```ts
import { PubSub, Stream } from "effect";

// ctor or a lazy init:
private events: PubSub.PubSub<AgentHarnessEvent>;
// in constructor: this.events = Effect.runSync(PubSub.unbounded<AgentHarnessEvent>());

/** Emit becomes a publish (Effect-native). */
private readonly publishEvent = (event: AgentHarnessEvent) =>
  Effect.runPromise(this.events.publish(event));   // called from the loop's emit sink

subscribeStream(): Stream.Stream<AgentHarnessEvent> {
  return Stream.fromPubSub(this.events);
}
```
- The `emit` passed to `runAgentLoopEffect` becomes `(event) => this.publishEvent(event)` (fires-and-forgets the publish; PubSub is non-blocking broadcast).
- **Split `handleAgentEvent`**: the state reducer runs synchronously inside `publishEvent`'s closure BEFORE the publish (so state is consistent); persistence becomes a separate internal subscriber: `Effect.runPromise(Stream.runForEach(this.subscribeStream(), (e) => this.persistEffect(e)))` forked per run; the WS subscriber is the external `subscribeStream()` consumer (Phase F).
- Keep `subscribe(cb)` as a thin adapter over `subscribeStream()` during migration (or remove if all callers move).

**Step 2:** Close the PubSub when the run scope closes (add to the `executeTurnEffect` finalizer): `yield* this.events.shutdown` (per-run PubSub) OR keep a harness-lifetime PubSub and just end the per-run stream via scope. Decide: one PubSub per harness (lifetime) is simplest; subscribers' streams end when they cancel.

### Task D3: Update tests + verify

**Step 1:** Convert event-asserting tests to `subscribeStream` + `Stream.runForEach`/`runCollect`.
**Step 2:** `cd packages/agent && pnpm run typecheck && pnpm run test`.
**Step 3:** `pnpm run fix`.
**Step 4:** `git commit --no-verify -m "refactor(agent): PubSub event bus + subscribeStream (decouple emit from persist)"`

---

## Phase E — Retry → Effect.retry + Schedule (Section 3)

**Files:**
- Modify: `packages/agent/src/compaction/retry-loop.ts`
- Modify: `apps/server/src/agent/runner.ts` (caller — `deps.runTurn` becomes Effect)
- Test: `packages/agent/src/compaction/__tests__/retry-loop.test.ts`

### Task E1: Define the transient-error + failing tests

**Step 1:** In `retry-loop.ts`:
```ts
import { Schema } from "effect";
export class TurnTransientError extends Schema.TaggedErrorClass<TurnTransientError>()(
  "TurnTransientError", "TurnTransientError", { message: Schema.String }
) {}
```
**Step 2:** Add tests: retryable turn → retries N times with jittered backoff; emits `auto_retry_start` per retry (delayMs from schedule); non-retryable → no retry; abort interrupts backoff. Use `deps.runTurn: () => Effect<AssistantMessage>` and `TestClock` for deterministic timing where possible. Run → FAIL.

### Task E2: Rewrite `executeWithRetryEffect`

```ts
import { Effect, Schedule } from "effect";

export const executeWithRetryEffect = (deps, settings) =>
  Effect.gen(function* () {
    const turnOrFail = Effect.gen(function* () {
      const msg = yield* deps.runTurn();
      if (shouldRetryValue(msg, settings)) return yield* new TurnTransientError({ message: msg.errorMessage ?? "transient" });
      return msg;
    });
    const schedule = Schedule.exponential(settings.baseDelayMs).pipe(
      Schedule.jittered,
      Schedule.tap((out) => Effect.gen(function* () {
        deps.emit({ type: "auto_retry_start", attempt: out.iterations, delayMs: out.delay, errorMessage: "…", maxAttempts: settings.maxRetries });
        yield* deps.rollbackLeaf();
      }))
    );
    const message = yield* turnOrFail.pipe(
      Effect.retry({ while: (_) => true, times: settings.maxRetries, schedule }),
      Effect.onExit((exit) => deps.emit({ type: "auto_retry_end", success: Exit.isSuccess(exit), /* … */ }))
    );
    yield* runCompactionPhaseEffect(deps, message);
  });
```
Delete `abortableSleep` + `computeRetryDelay` once nothing imports them. The retry is interruptible as a unit (the run fiber's interruption propagates).

### Task E3: Caller + verify + commit

**Step 1:** `apps/server/src/agent/runner.ts`: `runTurn: () => Effect.runPromise(harness.continue())` → flip to `runTurn: () => harness.continueEffect()` (native); `executeWithRetry` becomes `yield* executeWithRetryEffect(...)` inside the runner's Effect.
**Step 2:** `cd packages/agent && pnpm run typecheck && pnpm run test`.
**Step 3:** `pnpm run fix`.
**Step 4:** `git commit --no-verify -m "refactor(agent): Effect.retry + Schedule for backoff (drops abortableSleep)"`

---

## Phase F — WS/REST edge: single Effect boundary (Section 4)

**Files:**
- Modify: `apps/server/src/agent/ws-handler.ts`, `apps/server/src/agent/runner.ts`
- Modify: `apps/server/src/routes/*` (one `Effect.runPromise` per route that invokes agent ops)
- Test: `apps/server/src/agent/__tests__/ws.test.ts`, `e2e.test.ts`

### Task F1: Rewrite `agentStream` as the edge Effect

**Step 1:** In `runner.ts`, replace the fire-and-forget Promise with the single-boundary Effect:
```ts
Effect.runPromise(
  Effect.gen(function* () {
    const events = harness.subscribeStream();
    const fiber = yield* Effect.fork(executeWithRetryEffect(deps, settings).pipe(Effect.provide(/* runtime/ctx */)));
    registerRun(sessionId, harness, /* runFiber */ fiber);
    yield* Stream.runForEach(events, (e) =>
      Effect.sync(() => ws.send(JSON.stringify(toFrame(e, sessionId))))
    );
    yield* Fiber.join(fiber).pipe(Effect.exit);
  })
).catch((err) => ws.send(errorFrame(sessionId, err)))
 .finally(() => unregisterRun(sessionId));
```
- `activeRuns` now stores `{ harness, runFiber }`; `abortRun(sessionId)` → `Effect.runPromise(Fiber.interrupt(runFiber))`.
- `ws-handler.ts`: `agentStream(...)` is this `Effect.runPromise` (the single edge).

### Task F2: REST routes

For each route in `apps/server/src/routes/*` that calls a harness/storage op, wrap: `const result = await Effect.runPromise(harness.someEffect())`. One `runPromise` per handler, at the edge.

### Task F3: Rewrite the WS-frame tests (the "false positives")

**Step 1:** `ws.test.ts` "prompt produces event frames": replace the `setTimeout(100ms)` + callback with deterministic Stream consumption — collect frames via `Stream.runCollect`/`runForEach` raced with the run fiber. Keep the behavioral assertion (`agent_start` frame with correct `sessionId`). Do the same for the e2e multi-session test.

### Task F4: Verify + commit

**Step 1:** `cd apps/server && pnpm run typecheck && pnpm run test` → only the 2 pre-existing API-key failures remain (compaction summarize, e2e multi-session — both need real keys).
**Step 2:** Workspace `pnpm run typecheck`.
**Step 3:** `pnpm run fix`.
**Step 4:** `git commit --no-verify -m "refactor(server): single Effect boundary at WS/REST edge; activeRuns→Fiber interrupt"`

---

## Phase G — Cleanup

### Task G1: Delete the `Agent` class

Now redundant (zero production consumers; harness is a strict superset; `runAgentLoopEffect` is consumed by the harness).
- Delete `packages/agent/src/agent/agent.ts` + `packages/agent/src/agent/__tests__/agent.test.ts`.
- Remove `export { Agent }` from `packages/agent/src/index.ts`.
- `runAgentLoop`/`runAgentLoopContinue` (Promise wrappers) + `agentLoop`/`agentLoopContinue`/`AgentEventStream` (test-facing) — `rg` for consumers; delete if dead.

### Task G2: Verify + commit

`pnpm run typecheck && pnpm run test` across workspace; `pnpm run fix`; `git commit --no-verify -m "chore(agent): delete redundant Agent class + dead test-facing adapters"`.

---

## Verification (every phase)

- `pnpm run typecheck` (workspace, turbo).
- `cd packages/agent && pnpm run test`; `cd packages/db && pnpm run test`; `cd apps/server && pnpm run test`.
- `pnpm run fix`.
- The only accepted failures at any point: `apps/server` compaction "summarizes and persists" + e2e "two concurrent sessions" (need real API keys — pre-existing, unrelated).

## Notes for the executor

- **v4 API truth:** `openspec/references/effect-v4/packages/effect/src/` (tag `effect@4.0.0-beta.90`). If an Effect API seems missing, verify there — do NOT assume from memory or the v3 reference.
- **No `Effect.runPromise` inside the agent logic** after Phase F — only at the Hono edge.
- **`exactOptionalPropertyTypes: true`** — use conditional spread for optionals.
- **Perf check:** after Phase D + F, sanity-check streaming throughput (the per-token serialization should be gone; tool-input deltas visible). If a regression appears, bisect with `node --trace-gc` / a mock token stream before theorizing.
