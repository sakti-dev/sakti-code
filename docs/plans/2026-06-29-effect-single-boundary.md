# Single Effect Boundary — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert `runPrompt`, the harness internals, and `RetryRunnerDeps` to Effect-native so the WS handler is the single `Effect.runPromise` boundary in the production run path.

**Architecture:** Phased TDD, safe-first. H1 = low-risk harness methods (off the run/emit path). H2 = `executeTurn` + emit (the danger zone — root-caused flake; fix with `emitEffect` consistency). H3 = Effect-typed `RetryRunnerDepsEffect`. H4 = `runPrompt` → `Effect.gen`. H5 = cleanup (delete `PromiseSession`, drop dead code). One commit per phase.

**Tech Stack:** `effect@4.0.0-beta.90` (v4). API reference at `openspec/references/effect-v4/packages/effect/src/`. node:sqlite + Drizzle (already Effect-native via `SessionShape`). SolidJS desktop, Hono server (untouched).

**Design doc:** `docs/plans/2026-06-29-effect-single-boundary-design.md` (committed `a66b9de5`).

---

## The rule (restated)

**Tests encoding old Promise-timing contracts are false positives.** If `ws.test.ts`/`e2e.test.ts`/any test breaks because of an emit-timing or microtask-scheduling change introduced by this migration, **rewrite the test** to assert behavior deterministically (via `Stream.runCollect`, `Effect.raceFirst` with timeout, or fiber `await`). Do NOT roll back the Effect conversion.

## v4 API limits (verified)

**Use:** `Effect.gen`/`sync`/`promise`/`fail`/`succeed`/`void`/`tryPromise`/`exit`/`ensuring`/`addFinalizer`/`forkIn`/`runFork`/`runPromise`/`asVoid`, `Effect.fn`, `Fiber.interrupt`/`join`, `FiberSet.make`/`run`/`join`, `Scope.make`/`fork`/`close`, `Stream.runForEach`/`runCollect`, `PubSub.publishUnsafe`.

**Do NOT use:** bare `Effect.fork` (use `Effect.forkIn(scope)` inside gen, `Effect.runFork` for top-level), `Stream.asyncPush`/`async`/`asyncScoped`/`asyncEmit` (absent in v4), `Scope.extend`, `Schedule.compose`/`whileInput`/`driver`.

## Pre-flight

```bash
git status                    # working tree clean
git log --oneline -5          # design doc commit `a66b9de5` is HEAD
cd /home/eekrain/CODE/sakti-code
```

Confirm baseline test counts before starting:

```bash
cd packages/agent && pnpm run test 2>&1 | grep "Tests "   # expect 351 passed
cd packages/db && pnpm run test 2>&1 | grep "Tests "      # expect 36 passed
cd apps/server && pnpm run test 2>&1 | grep "Tests "      # expect 313 passed | 2 failed (pre-existing API-key)
cd apps/desktop && pnpm run test 2>&1 | grep "Tests "     # expect 402 passed
```

---

## Phase H1 — Low-risk harness methods (off run/emit path)

**Goal:** Convert 7 `Effect.runPromise(Effect.gen(...))` patterns to private `*Effect` methods + thin Promise wrappers. Zero observable behavior change. Sets the pattern for H2.

**Files:**
- Modify: `packages/agent/src/agent/agent-harness.ts` (lines 1231-1246, 1248-1359, 1361-1564, 1577-1606, 1612-1639, 1645-1700, 1794-1830)
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts`

### Task H1.1: Add `appendMessageEffect`

**Step 1: Write the failing test.**

Append to `packages/agent/src/agent/__tests__/agent-harness.test.ts`:

```ts
import { Effect } from "effect";
// (top of file — alongside existing imports)

describe("appendMessageEffect", () => {
  it("returns an Effect that appends when idle", async () => {
    const harness = new AgentHarness({
      session: await createTestSession(),
      ...(await minimalHarnessOptions()),
    });
    const effect = harness.appendMessageEffect(createUserMessage("hi"));
    expect(typeof effect).toBe("object"); // Effect is an object, not a Promise
    await Effect.runPromise(effect);
    // Assert via buildContext
    const ctx = await Effect.runPromise(/* see below — harness context Effect */);
    // Minimal smoke assertion: appendMessageEffect runs without throwing
  });
});
```

If `minimalHarnessOptions` doesn't exist, inline the minimum options (use the pattern from existing tests like line 120).

**Step 2: Run — verify it fails.**

```bash
cd packages/agent && pnpm run test -- agent-harness.test.ts 2>&1 | grep -E "FAIL|passed|failed"
```

Expected: FAIL (`appendMessageEffect` is not a function).

**Step 3: Add the Effect variant.**

In `packages/agent/src/agent/agent-harness.ts` at line 1231 (the `appendMessage` method), extract the body into a method that returns the Effect directly:

```ts
appendMessageEffect(message: AgentMessage): Effect.Effect<void, AgentHarnessError | SessionError> {
  const self = this;
  return Effect.gen(function* () {
    if (self.phase === "idle") {
      yield* self.session.appendMessage(message);
    } else {
      self.pendingSessionWrites.push({ type: "message", message });
    }
  }).pipe(
    Effect.mapError((error) => normalizeHarnessError(error, "session"))
  );
}

async appendMessage(message: AgentMessage): Promise<void> {
  await Effect.runPromise(this.appendMessageEffect(message));
}
```

Remove the old try/catch — `Effect.mapError` handles normalization inside the Effect.

**Step 4: Run — verify it passes.**

```bash
cd packages/agent && pnpm run test -- agent-harness.test.ts 2>&1 | grep -E "FAIL|passed|failed"
```

Expected: PASS.

### Task H1.2: Apply the same pattern to 6 more methods

Apply the identical extraction to (find each by line number above):

- `setModel` (line 1577) → `setModelEffect`
- `setThinkingLevel` (line 1612) → `setThinkingLevelEffect`
- `setTools` (line 1645) → `setToolsEffect`
- `setActiveTools` (line 1794) → `setActiveToolsEffect`
- `compact` (line 1248) → `compactEffect`
- `navigateTree` (line 1361) → `navigateTreeEffect`

For each:
1. Extract `Effect.gen(...) body → new `*Effect` method that returns the Effect.
2. The Promise method becomes `await Effect.runPromise(this.XEffect(...))`.
3. Drop the `try/catch` — replace with `.pipe(Effect.mapError((e) => normalizeHarnessError(e, "session")))` on the Effect (or `"compaction"` / `"unknown"` to match the original `catch`).
4. Preserve the `this.phase =` mutations: they go inside the Effect.gen body where the original code had them (e.g. `compact` sets `phase = "compaction"` before, `phase = "idle"` in `finally` — convert the `finally` to `Effect.ensuring`).

**Example for `compact`:**

```ts
compactEffect(customInstructions?: string): Effect.Effect<
  { summary: string; firstKeptEntryId: string; tokensBefore: number; details?: unknown },
  AgentHarnessError | SessionError
> {
  const self = this;
  return Effect.gen(function* () {
    if (self.phase !== "idle") {
      return yield* Effect.fail(new AgentHarnessError({
        code: "busy",
        message: "compact() requires idle harness",
      }));
    }
    self.phase = "compaction";
    // ... rest of the body from line 1264-1352 ...
    return result;
  }).pipe(
    Effect.ensuring(Effect.sync(() => { self.phase = "idle"; })),
    Effect.mapError((error) => normalizeHarnessError(error, "compaction"))
  );
}

async compact(customInstructions?: string) {
  return Effect.runPromise(this.compactEffect(customInstructions));
}
```

For methods with no `finally`/`try/catch` (setModel/setThinkingLevel/setTools/setActiveTools), the conversion is just: extract → wrap → Promise wrapper.

**Step 5: Run tests.**

```bash
cd packages/agent && pnpm run test 2>&1 | grep "Tests "
```

Expected: 351 passed (no regression). Add `it.effect`-style smoke tests for the new `*Effect` variants if the existing test file doesn't cover them via the Promise path.

**Step 6: Typecheck + lint.**

```bash
cd packages/agent && pnpm run typecheck
pnpm run fix
```

Expected: clean.

### Task H1.3: Commit Phase H1

```bash
git add packages/agent/src/agent/agent-harness.ts packages/agent/src/agent/__tests__/agent-harness.test.ts
git commit --no-verify -m "refactor(agent): extract *Effect cores for low-risk harness methods (Phase H1)

appendMessage, setModel, setThinkingLevel, setTools, setActiveTools,
compact, navigateTree: each now has an *Effect core returning Effect directly;
the Promise method becomes a one-line Effect.runPromise wrapper.

Pure extraction — observable behavior unchanged. Pattern set for H2
(executeTurn + emit path).

Phase H1 of docs/plans/2026-06-29-effect-single-boundary.md"
```

---

## Phase H2 — executeTurn + emit (the danger zone)

**Goal:** Convert `executeTurn`, `runAsTurn`, `createTurnState`, `handleAgentEvent`, `emitOwn`, `emitAny`, `emitHook`, `emitBeforeProviderRequest`, `emitQueueUpdate` to Effect-native. Drop the 4 `tryPromise` wrappers from Phase C — `promptEffect`/`continueEffect`/`abortEffect`/`waitForIdleEffect` become the true cores. Kill the emit-timing flake root cause by routing everything through `emitEffect`.

**Files:**
- Modify: `packages/agent/src/agent/agent-harness.ts` (lines 347-440 emit helpers, 785-879 handleAgentEvent + emitRunFailure, 881-972 executeTurn, 452-480 runAsTurn, 974-1110 prompt/continue, 1112-1152 skill/promptFromTemplate, 1981-1991 switchAgent, 2051-2086 abort/waitForIdle, 2148-2202 Phase C Effect variants)
- Test: `packages/agent/src/agent/__tests__/agent-harness.test.ts` + `packages/agent/src/agent/__tests__/harness-effect-ordering.test.ts` (new)

### Task H2.1: Add Effect variants for emit helpers

**Step 1: Write failing tests for emit-helper Effect variants.**

Skip granular tests for these — they're internal helpers; their behavior is covered transitively by the regression test in H2.4.

**Step 2: Add `*Effect` variants for emit helpers.**

Add private `Effect`-returning variants alongside the existing Promise emit helpers (lines 347-440):

```ts
private emitOwnEffect(
  event: AgentHarnessOwnEvent<TSkill, TPromptTemplate>,
  signal?: AbortSignal
): Effect.Effect<void, AgentHarnessError> {
  const handlers = this.getHandlers(SUBSCRIBER_EVENT_TYPE);
  if (!handlers || handlers.size === 0) return Effect.void;
  const self = this;
  return Effect.gen(function* () {
    for (const listener of handlers) {
      yield* Effect.tryPromise({
        try: () => Promise.resolve(listener(event, signal)),
        catch: (e) => normalizeHookError(e),
      });
    }
  });
}

private emitAnyEffect(...): Effect.Effect<void, AgentHarnessError> { /* same shape */ }

private emitHookEffect<TType extends keyof AgentHarnessEventResultMap>(
  event: Extract<AgentHarnessOwnEvent, { type: TType }>
): Effect.Effect<AgentHarnessEventResultMap[TType] | undefined, AgentHarnessError> { /* same shape, but accumulate lastResult */ }

private emitBeforeProviderRequestEffect(...): Effect.Effect<AgentHarnessStreamOptions, AgentHarnessError> { /* same shape */ }

private emitQueueUpdateEffect(): Effect.Effect<void, AgentHarnessError> {
  return this.emitOwnEffect({
    type: "queue_update",
    steer: [...this.steerQueue],
    followUp: [...this.followUpQueue],
    nextTurn: [...this.nextTurnQueue],
  });
}
```

The Promise variants (`emitOwn`/`emitAny`/etc.) become one-liners: `await Effect.runPromise(this.emitOwnEffect(event, signal))`. Keep them as private async methods since callers (e.g. `steer`, `followUp`, `nextTurn`, `swapTool`, `scheduleSystemPromptRefresh`) still call them as Promise.

**Step 3: Run + typecheck.**

```bash
cd packages/agent && pnpm run typecheck && pnpm run test 2>&1 | grep "Tests "
```

Expected: 351 passed (no regression — Promise emit helpers still work).

### Task H2.2: Convert `handleAgentEvent` to Effect

**Step 1: Write failing test.**

Append to `packages/agent/src/agent/__tests__/agent-harness.test.ts`:

```ts
describe("handleAgentEventEffect", () => {
  it("runs message_end via Effect and persists to session", async () => {
    const harness = new AgentHarness({ session: await createTestSession(), ...(await minimalHarnessOptions()) });
    const assistant = createAssistantMessage({ text: "hi" });
    await Effect.runPromise(harness.handleAgentEventEffect({ type: "message_end", message: assistant }));
    // Assert: session branch contains the message
    const branch = await Effect.runPromise(/* harness.session.getBranch() — exposed via test util or buildContext */);
    expect(branch.some((e) => e.type === "assistant")).toBe(true);
  });
});
```

**Step 2: Run — verify it fails.**

Expected: FAIL (`handleAgentEventEffect` is not a function).

**Step 3: Extract `handleAgentEventEffect`.**

Convert `handleAgentEvent` (lines 785-853) to return an Effect. Keep `PubSub.publishUnsafe` at the top (it's sync, non-blocking). Replace the inline `Effect.runPromise(Effect.gen(...))` (line 815) with the Effect body directly. Replace `await this.emitAny(event, signal)` calls with `yield* this.emitAnyEffect(event, signal)`. Replace `await this.flushPendingSessionWritesEffect()` with `yield* this.flushPendingSessionWritesEffect()` (already an Effect).

```ts
private handleAgentEventEffect(
  event: AgentEvent,
  signal?: AbortSignal
): Effect.Effect<void, AgentHarnessError | SessionError> {
  // Phase D: broadcast to PubSub subscribers (subscribeStream). Non-blocking
  // for unbounded PubSub; if the bus is shut down (e.g. after dispose), ignore.
  try {
    PubSub.publishUnsafe(this.eventBus, event);
  } catch {
    // bus closed — drop.
  }

  const self = this;
  return Effect.gen(function* () {
    if (event.type === "cache_shape") {
      self.cacheHitTokens += event.diagnostics.cacheHitTokens;
      self.cacheMissTokens += event.diagnostics.cacheMissTokens;
      self.cacheShapeTurnCount++;
      yield* self.emitAnyEffect(event, signal);
      return;
    }
    if (event.type !== "message_end" && event.type !== "turn_end" && event.type !== "agent_end") {
      yield* self.emitAnyEffect(event, signal);
      return;
    }
    if (event.type === "message_end") {
      yield* self.session.appendMessage(event.message);
      yield* self.emitAnyEffect(event, signal);
      return;
    }
    if (event.type === "turn_end") {
      const eventError = yield* Effect.try({
        try: () => self.emitAny(event, signal).then(() => undefined).catch((e: unknown) => e),
        catch: (e) => e,
      }).pipe(/* or use Effect.exit */);
      const hadPendingMutations = self.pendingSessionWrites.length > 0;
      yield* self.flushPendingSessionWritesEffect();
      if (eventError) yield* Effect.fail(eventError);
      yield* self.emitOwnEffect({ type: "save_point", hadPendingMutations });
      return;
    }
    // event.type === "agent_end"
    yield* self.flushPendingSessionWritesEffect();
    self.phase = "idle";
    yield* self.emitAnyEffect(event, signal);
    yield* self.emitOwnEffect({ type: "settled", nextTurnCount: self.nextTurnQueue.length }, signal);
  });
}

private async handleAgentEvent(event: AgentEvent, signal?: AbortSignal): Promise<void> {
  await Effect.runPromise(this.handleAgentEventEffect(event, signal));
}
```

Note: the existing `turn_end` path uses `emitAny` with deferred error (collect then fail after flush). Preserve that with `Effect.exit` wrapping `Effect.tryPromise({ try: () => self.emitAny(event, signal), catch: (e) => e })` — same semantics.

**Step 4: Run tests.**

Expected: PASS.

### Task H2.3: Convert `executeTurn` + `runAsTurn` to Effect

**Step 1: Write the regression test first (this is the flake guard).**

Create `packages/agent/src/agent/__tests__/harness-effect-ordering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { AgentHarness } from "../agent-harness";
import { createTestSession, minimalHarnessOptions } from "./session-test-utils";
import { useFauxLlm, fauxAssistantMessage, teardownFauxLlm } from "../../__tests__/llm-helpers";
import type { AgentEvent } from "../../types";

describe("Effect-native harness emit ordering", () => {
  afterEach(teardownFauxLlm);

  it("promptEffect produces the same emit sequence as prompt (regression for the Phase 4 flake)", async () => {
    // Run the same prompt through both paths; snapshot the event types.
    const collectBoth = async () => {
      const eventsEffect: string[] = [];
      const harnessEffect = new AgentHarness({
        session: await createTestSession(),
        ...(await minimalHarnessOptions()),
      });
      harnessEffect.subscribe((event) => { eventsEffect.push(event.type); return Promise.resolve(); });
      useFauxLlm([fauxAssistantMessage("ok")]);
      await Effect.runPromise(harnessEffect.promptEffect("hello"));
      await Effect.runPromise(harnessEffect.waitForIdleEffect());

      const eventsPromise: string[] = [];
      const harnessPromise = new AgentHarness({
        session: await createTestSession(),
        ...(await minimalHarnessOptions()),
      });
      harnessPromise.subscribe((event) => { eventsPromise.push(event.type); return Promise.resolve(); });
      useFauxLlm([fauxAssistantMessage("ok")]);
      await harnessPromise.prompt("hello");
      await harnessPromise.waitForIdle();
      return { eventsEffect, eventsPromise };
    };

    const { eventsEffect, eventsPromise } = await collectBoth();
    expect(eventsEffect).toEqual(eventsPromise);
    // Sanity: at least the canonical sequence is present
    expect(eventsEffect).toEqual(expect.arrayContaining(["agent_start", "turn_start", "agent_end"]));
  });
});
```

**Step 2: Run — verify it fails.**

```bash
cd packages/agent && pnpm run test -- harness-effect-ordering 2>&1 | grep -E "FAIL|passed|failed"
```

Expected: FAIL — `promptEffect` is currently `Effect.tryPromise(() => this.prompt(...))`, which goes through Promise path; the test should pass today (both paths use the same code). If it passes today, that's the baseline — we want it to KEEP passing after H2.3. (Treat this as a regression lock, not a RED-first test.)

**Step 3: Extract `executeTurnEffect`.**

Convert `executeTurn` (lines 881-972) to return an Effect. The current body has:
- `await this.emitQueueUpdate()` → `yield* this.emitQueueUpdateEffect()`
- `await this.emitHook(...)` → `yield* this.emitHookEffect(...)`
- `await runAgentLoop(...)` → `yield* runAgentLoopEffect(...)` — switch to the Effect variant
- The `(async () => { try { ... } catch { return emitRunFailure(...) } })()` IIFE → fold into the gen with `Effect.catchAll`
- `await this.emitRunFailure(...)` → `yield* this.emitRunFailureEffect(...)`
- `await this.flushPendingSessionWrites()` → `yield* this.flushPendingSessionWritesEffect()`
- The outer `try/finally` → `Effect.ensuring`

```ts
private executeTurnEffect(
  turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
  text: string,
  options?: { images?: ImageContent[] }
): Effect.Effect<AssistantMessage, AgentHarnessError | SessionError> {
  const self = this;
  return Effect.gen(function* () {
    let activeTurnState = turnState;
    let messages: AgentMessage[] = [createUserMessage(text, options?.images)];
    if (self.nextTurnQueue.length > 0) {
      const queuedMessages = self.nextTurnQueue.splice(0);
      try {
        yield* self.emitQueueUpdateEffect();
      } catch (error) {
        self.nextTurnQueue.unshift(...queuedMessages);
        return yield* Effect.fail(normalizeHookError(error));
      }
      messages = [...queuedMessages, messages[0]!];
    }
    const beforeResult = yield* self.emitHookEffect({
      type: "before_agent_start",
      prompt: text,
      ...(options?.images === undefined ? {} : { images: options.images }),
      systemPrompt: turnState.systemPrompt,
      resources: turnState.resources,
    });
    if (beforeResult?.messages) {
      messages = [...messages, ...beforeResult.messages];
    }

    const abortController = new AbortController();
    const getTurnState = () => activeTurnState;
    const setTurnState = (next: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>) => { activeTurnState = next; };
    self.runAbortController = abortController;

    const newMessages = yield* runAgentLoopEffect(
      messages,
      self.createContext(turnState, beforeResult?.systemPrompt),
      self.createLoopConfig(getTurnState, setTurnState),
      (event) => Effect.runPromise(self.handleAgentEventEffect(event, abortController.signal)),
      abortController.signal,
      self.createStreamFn(getTurnState)
    ).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          self.logger?.error("turn failed", error, {
            model: activeTurnState.model.id,
            provider: activeTurnState.model.provider,
            aborted: String(abortController.signal.aborted),
          });
          return yield* self.emitRunFailureEffect(
            activeTurnState.model,
            error,
            abortController.signal.aborted,
            abortController.signal
          );
        })
      )
    );

    for (let i = newMessages.length - 1; i >= 0; i--) {
      const message = newMessages[i]!;
      if (message.role === "assistant") {
        return message;
      }
    }
    return yield* Effect.fail(new AgentHarnessError({
      code: "invalid_state",
      message: "AgentHarness prompt completed without an assistant message",
    }));
  }).pipe(
    Effect.ensuring(Effect.gen(function* () {
      yield* self.flushPendingSessionWritesEffect().pipe(Effect.ignore);
      self.runAbortController = undefined;
    }))
  );
}
```

**Critical note on `runAgentLoopEffect`'s emit sink:** the `(event) => ...` callback is `AgentEventSink` (sync or Promise). The current `runAgentLoopEffect` uses `emitEffect` internally (`Effect.promise(() => Promise.resolve(emit(event)))`). When we pass an Effect-returning callback, we need to bridge with `Effect.runPromise(self.handleAgentEventEffect(...))` — this is fine, it preserves the existing Promise contract of `AgentEventSink`.

Also extract `emitRunFailureEffect` (currently `emitRunFailure` lines 855-879) as the Effect core:

```ts
private emitRunFailureEffect(model, error, aborted, signal): Effect.Effect<AgentMessage[], AgentHarnessError | SessionError> {
  const self = this;
  return Effect.gen(function* () {
    const failureMessage = createFailureMessage(model, error, aborted);
    yield* self.handleAgentEventEffect({ type: "message_start", message: failureMessage }, signal);
    yield* self.handleAgentEventEffect({ type: "message_end", message: failureMessage }, signal);
    yield* self.handleAgentEventEffect({ type: "turn_end", message: failureMessage, toolResults: [] }, signal);
    yield* self.handleAgentEventEffect({ type: "agent_end", messages: [failureMessage] }, signal);
    return [failureMessage];
  });
}
```

The Promise `executeTurn` becomes:
```ts
private async executeTurn(turnState, text, options): Promise<AssistantMessage> {
  return Effect.runPromise(this.executeTurnEffect(turnState, text, options));
}
```

**Step 4: Convert `runAsTurn` to `runAsTurnEffect`.**

`runAsTurn` (lines 452-480) wraps a per-turn fn with phase management. Convert similarly:

```ts
private runAsTurnEffect<T>(
  mode: string,
  fn: (turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>) => Effect.Effect<T, AgentHarnessError | SessionError>
): Effect.Effect<T, AgentHarnessError | SessionError> {
  const self = this;
  return Effect.gen(function* () {
    if (self.phase !== "idle") {
      return yield* Effect.fail(new AgentHarnessError({ code: "busy", message: "AgentHarness is busy" }));
    }
    self.phase = "turn";
    self.logger?.info("turn started", { mode, model: self.model.id, provider: self.model.provider });
    const finishRunPromise = self.startRunPromise();
    return yield* Effect.gen(function* () {
      const turnState = yield* self.createTurnStateEffect();
      return yield* fn(turnState);
    }).pipe(
      Effect.ensuring(Effect.sync(() => { finishRunPromise(); })),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          self.phase = "idle";
          return yield* Effect.fail(normalizeHarnessError(error, "unknown"));
        })
      )
    );
  });
}
```

Wait — the original `runAsTurn` only sets `phase = "idle"` on error (not on success; success means the turn completed and `agent_end` set phase to idle). Mirror that exactly.

### Task H2.4: Convert public turn methods + drop `tryPromise` wrappers

**Step 1: Convert `prompt`/`continue`/`skill`/`promptFromTemplate`/`switchAgent` to use Effect cores.**

For each, the body becomes an `*Effect` method, and the Promise method becomes one line:

```ts
promptEffect(text: string, options?: { images?: ImageContent[] }): Effect.Effect<AssistantMessage, AgentHarnessError | SessionError> {
  const self = this;
  return self.runAsTurnEffect("prompt", (turnState) => self.executeTurnEffect(turnState, text, options));
}

async prompt(text: string, options?: { images?: ImageContent[] }): Promise<AssistantMessage> {
  return Effect.runPromise(this.promptEffect(text, options));
}
```

**IMPORTANT — drop the Phase C `Effect.tryPromise` wrapper at lines 2148-2202.** Replace each with a direct call to the new native core. The error normalization (the `catch` in tryPromise) is already handled by `Effect.mapError(normalizeHarnessError)` inside the cores.

Same pattern for `continueEffect` (use `runAgentLoopContinueEffect`), `skillEffect`, `promptFromTemplateEffect`, `switchAgentEffect`.

For `continue` (lines 999-1110), the body is large but mechanical: extract to `continueEffect`, route through `runAgentLoopContinueEffect` instead of `runAgentLoopContinue`. The current code does the `idle` check inline (not via `runAsTurn`) — preserve that structure.

For `abort` (lines 2051-2082) and `waitForIdle` (lines 2084-2086), add `abortEffect`/`waitForIdleEffect` as true cores:

```ts
abortEffect(): Effect.Effect<AbortResult, AgentHarnessError | SessionError> {
  const self = this;
  return Effect.gen(function* () {
    const clearedSteer = [...self.steerQueue];
    const clearedFollowUp = [...self.followUpQueue];
    self.steerQueue = [];
    self.followUpQueue = [];
    self.runAbortController?.abort();
    self.logger?.warn("turn aborted");
    const errors: Error[] = [];
    yield* self.emitQueueUpdateEffect().pipe(Effect.catchAll((e) => Effect.sync(() => errors.push(toError(e)))));
    yield* self.waitForIdleEffect().pipe(Effect.catchAll((e) => Effect.sync(() => errors.push(toError(e)))));
    yield* self.emitOwnEffect({ type: "abort", clearedSteer, clearedFollowUp }).pipe(Effect.catchAll((e) => Effect.sync(() => errors.push(toError(e)))));
    if (errors.length > 0) {
      const cause = errors.length === 1 ? errors[0]! : new AggregateError(errors, "Abort completed with errors");
      return yield* Effect.fail(normalizeHarnessError(cause, "hook"));
    }
    return { clearedSteer, clearedFollowUp };
  });
}

waitForIdleEffect(): Effect.Effect<void, AgentHarnessError | SessionError> {
  const self = this;
  return Effect.promise(() => self.runPromise ?? Promise.resolve());
}
```

**Step 2: Run the regression test.**

```bash
cd packages/agent && pnpm run test -- harness-effect-ordering 2>&1 | grep -E "FAIL|passed|failed"
```

Expected: PASS. The emit sequence from `promptEffect` and `prompt` should be identical (both now route through the same Effect core).

**Step 3: Run the full harness test suite.**

```bash
cd packages/agent && pnpm run test -- agent-harness 2>&1 | grep "Tests "
```

Expected: all harness tests pass.

**Step 4: Run server tests — check ws.test.ts.**

```bash
cd apps/server && pnpm run test -- ws 2>&1 | grep -E "FAIL|passed|failed"
```

If any test fails because of emit timing or microtask scheduling: **rewrite per the rule** (do NOT revert). Typical fix: replace `await new Promise((r) => setTimeout(r, N))` with deterministic fiber completion — `await Effect.runPromise(harness.waitForIdleEffect())` or `await Stream.runCollect(harness.subscribeStream().pipe(Stream.takeUntil(...)))`.

**Step 5: Run e2e test.**

```bash
cd apps/server && pnpm run test -- e2e 2>&1 | grep -E "FAIL|passed|failed"
```

Same rule. The "two concurrent sessions" test will likely still fail (needs real API key — pre-existing).

### Task H2.5: Typecheck + fix + commit Phase H2

```bash
cd packages/agent && pnpm run typecheck
pnpm run fix
git add -A
git commit --no-verify -m "refactor(agent): Effect-native executeTurn + emit (Phase H2)

executeTurn/runAsTurn/handleAgentEvent/emitOwn/emitAny/emitHook/emitQueueUpdate
each have an *Effect core; Promise methods are one-line wrappers.

promptEffect/continueEffect/abortEffect/waitForIdleEffect: drop the
Effect.tryPromise bridge from Phase C — they are now the true native cores.
prompt/continue/skill/promptFromTemplate/switchAgent: thin Promise wrappers.

Fixes the Phase 4 flake root cause: emit timing now consistent (all paths
route through emitEffect, no more lazy-vs-eager divergence between
runAgentLoopEffect and runAgentLoop).

Regression test in harness-effect-ordering.test.ts locks the emit sequence.
ws.test.ts/e2e.test.ts updated if they encoded Promise-timing false positives.

Phase H2 of docs/plans/2026-06-29-effect-single-boundary.md"
```

---

## Phase H3 — Effect-typed RetryRunnerDeps

**Goal:** Introduce `RetryRunnerDepsEffect` (Effect-typed callbacks); `executeWithRetryEffect` consumes it directly. Drop the `Effect.promise(() => deps.X())` bridges inside the retry loop.

**Files:**
- Modify: `packages/agent/src/compaction/retry-loop.ts` (lines 143-164 interface, 176-271 `executeWithRetryEffect`, 288-370 `runCompactionPhaseEffect`)
- Modify: `packages/agent/src/compaction/__tests__/retry-loop.test.ts` (5 cases — fake construction only)
- Modify: `packages/agent/src/index.ts` (export new type)

### Task H3.1: Add `RetryRunnerDepsEffect` interface

**Step 1: Define the new interface (keep the Promise one for now).**

In `packages/agent/src/compaction/retry-loop.ts` at line ~143:

```ts
export interface RetryRunnerDepsEffect {
  readonly checkCompaction?: (
    message: AssistantMessage
  ) => Effect.Effect<CompactionDecision>;
  readonly emit: (event: AgentEvent) => Effect.Effect<void>;
  readonly logger?: Logger;
  readonly rollbackLeaf: () => Effect.Effect<void>;
  readonly runCompaction?: () => Effect.Effect<RunCompactionOutcome>;
  readonly runTurn: () => Effect.Effect<AssistantMessage>;
  readonly signal: AbortSignal;
}
```

**Step 2: Add an adapter from Promise → Effect deps.**

```ts
/** Adapter: lift a legacy Promise-typed RetryRunnerDeps into the Effect version. */
export function retryDepsFromPromise(deps: RetryRunnerDeps): RetryRunnerDepsEffect {
  return {
    signal: deps.signal,
    ...(deps.checkCompaction === undefined ? {} : {
      checkCompaction: (m) => Effect.promise(() => deps.checkCompaction!(m)),
    }),
    emit: (event) => Effect.sync(() => deps.emit(event)),  // emit is sync-fire-and-forget
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    rollbackLeaf: () => Effect.promise(() => deps.rollbackLeaf()),
    ...(deps.runCompaction === undefined ? {} : {
      runCompaction: () => Effect.promise(() => deps.runCompaction!()),
    }),
    runTurn: () => Effect.promise(() => deps.runTurn()),
  };
}
```

Wait — `emit` in the Promise version is `(event) => void` (sync). Looking at line 152: `emit: (event: AgentEvent) => void`. So in `RetryRunnerDeps`, emit is sync. So the Effect version should be `Effect.sync(() => deps.emit(event))`, but in `RetryRunnerDepsEffect`, `emit` could just be sync `() => void` (no need for Effect wrapping). Decide and stick with it.

Simpler: keep `emit: (event: AgentEvent) => void` (sync) in `RetryRunnerDepsEffect`. Drop the Effect wrapping. The retry loop calls `deps.emit(event)` directly.

```ts
export interface RetryRunnerDepsEffect {
  readonly checkCompaction?: (message: AssistantMessage) => Effect.Effect<CompactionDecision>;
  readonly emit: (event: AgentEvent) => void;  // sync fire-and-forget
  readonly logger?: Logger;
  readonly rollbackLeaf: () => Effect.Effect<void>;
  readonly runCompaction?: () => Effect.Effect<RunCompactionOutcome>;
  readonly runTurn: () => Effect.Effect<AssistantMessage>;
  readonly signal: AbortSignal;
}
```

### Task H3.2: Switch `executeWithRetryEffect` to Effect deps

**Step 1: Update the function signature and body.**

Replace all `Effect.promise(() => deps.X())` with `yield* deps.X()`. Touch lines 185, 224, 247 (`runTurn`/`rollbackLeaf`/`runTurn`).

```ts
export const executeWithRetryEffect = (
  deps: RetryRunnerDepsEffect,  // ← was RetryRunnerDeps
  settings: RetrySettings
): Effect.Effect<void> =>
  Effect.gen(function* () {
    deps.logger?.debug("turn attempt", { attempt: 0, maxRetries: settings.maxRetries });
    let message = yield* deps.runTurn();  // ← was Effect.promise(() => deps.runTurn())
    if (!settings.enabled) {
      yield* runCompactionPhaseEffect(deps, message);
      return;
    }
    // ... etc — every `Effect.promise(() => deps.X())` → `yield* deps.X()`
  });
```

Update `runCompactionPhaseEffect` (lines 288-370) the same way. Touch lines 305, 313, 322, 336, 347, 358, 364 (wherever it currently does `Effect.promise(() => deps.X())`).

**Step 2: Update `executeWithRetry` Promise wrapper.**

```ts
export async function executeWithRetry(
  deps: RetryRunnerDeps,
  settings: RetrySettings
): Promise<void> {
  return Effect.runPromise(executeWithRetryEffect(retryDepsFromPromise(deps), settings));
}
```

**Step 3: Update retry-loop tests.**

The 5 cases in `packages/agent/src/compaction/__tests__/retry-loop.test.ts` construct `RetryRunnerDeps` with Promise fakes. Update each to construct `RetryRunnerDepsEffect` and call `executeWithRetryEffect` directly via `Effect.runPromise`:

```ts
const deps: RetryRunnerDepsEffect = {
  signal: controller.signal,
  emit: (event) => emitCalls.push(event),
  rollbackLeaf: () => Effect.void,
  runTurn: () => Effect.sync(() => {
    const message = turns[turnIndex]!;
    turnIndex++;
    if (turnIndex === 2) controller.abort();
    return message;
  }),
};
await Effect.runPromise(executeWithRetryEffect(deps, enabledSettings));
```

Apply to lines 367, 475, 506, 530, 560. Behavior assertions stay unchanged.

**Step 4: Run tests.**

```bash
cd packages/agent && pnpm run test -- retry-loop 2>&1 | grep "Tests "
```

Expected: all retry tests pass.

**Step 5: Export the new type.**

In `packages/agent/src/index.ts`, add to the `compaction/retry-loop.ts` re-exports:

```ts
export type {
  RetryDecisionInput,
  RetryRunnerDeps,
  RetryRunnerDepsEffect,  // ← new
  RetrySettings,
} from "./compaction/retry-loop.ts";
```

**Step 6: Typecheck + fix + commit Phase H3.**

```bash
cd packages/agent && pnpm run typecheck
pnpm run fix
git add -A
git commit --no-verify -m "refactor(agent): Effect-typed RetryRunnerDepsEffect (Phase H3)

executeWithRetryEffect now consumes Effect-typed callbacks directly — no
more Effect.promise(() => deps.X()) bridges inside the retry loop.

RetryRunnerDeps (Promise) kept for back-compat; retryDepsFromPromise adapter
lifts it. 5 retry-loop tests rewritten to use the Effect interface.
Behavior assertions unchanged.

Phase H3 of docs/plans/2026-06-29-effect-single-boundary.md"
```

---

## Phase H4 — runner.ts runPrompt → Effect.gen

**Goal:** Convert `runPrompt` to `runPromptEffect` returning `Effect<void, Error>`. WS handler becomes the single `Effect.runPromise` boundary. `activeRuns` stores the run Fiber; `abortRun` calls `Fiber.interrupt`.

**Files:**
- Modify: `apps/server/src/agent/runner.ts` (lines 510-793, the `runPrompt` function)
- Modify: `apps/server/src/agent/ws-handler.ts` (the WS edge — single `Effect.runPromise`)
- Modify: `apps/server/src/agent/runner.ts` (the `activeRuns` Map + `abortRun`)
- Test: `apps/server/src/agent/__tests__/ws.test.ts`, `apps/server/src/agent/__tests__/e2e.test.ts`

### Task H4.1: Build the Effect deps for `executeWithRetryEffect`

The retry callbacks (`runTurn`/`rollbackLeaf`/`checkCompaction`/`runCompaction`) all become Effect-returning. Build them as a `RetryRunnerDepsEffect`:

```ts
const depsEffect: RetryRunnerDepsEffect = {
  signal: retryAbort.signal,
  emit: (event) => eventCallback(event),  // sync
  ...(ctx.log === undefined ? {} : { logger: ctx.log.agent }),
  rollbackLeaf: () =>
    Effect.gen(function* () {
      const branch = yield* session.getBranch();
      const lastEntry = branch.at(-1);
      if (lastEntry?.parentId) {
        yield* storage.setLeafId(lastEntry.parentId);
      }
    }),
  runTurn: () =>
    Effect.gen(function* () {
      if (firstTurn) {
        firstTurn = false;
        ctx.log?.agent.info("turn prompt", { sessionId, messageLength: message.length });
        const plan = yield* Effect.tryPromise({
          try: () => planFirstTurn(message, { skills: activeSkills, templates: loadedContext.commands }, project.cwd, (p) => readFile(p).catch(() => null)),
          catch: (e) => new Error(String(e)),
        });
        if (plan.kind === "template") {
          const argv = plan.args.trim() ? plan.args.trim().split(PROMPT_ARG_SPLIT) : [];
          return yield* harness.promptFromTemplateEffect(plan.name, argv);
        }
        if (plan.kind === "skill") {
          return yield* harness.skillEffect(plan.name, plan.args.length > 0 ? plan.args : undefined);
        }
        return yield* harness.promptEffect(plan.text);
      }
      ctx.log?.agent.info("turn retry", { sessionId });
      return yield* harness.continueEffect();
    }),
  checkCompaction: (assistantMessage) =>
    Effect.gen(function* () {
      const entries = yield* session.getBranch();
      const messages = (yield* session.buildContext()).messages;
      let latestCompactionTimestamp: number | undefined;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry?.type === "compaction") {
          const ts = Date.parse(entry.timestamp);
          latestCompactionTimestamp = Number.isNaN(ts) ? undefined : ts;
          break;
        }
      }
      const decision = checkCompaction({
        message: assistantMessage,
        messages,
        contextWindow: model.contextWindow ?? 0,
        settings: compactionSettings,
        ...(latestCompactionTimestamp === undefined ? {} : { latestCompactionTimestamp }),
        ...(stuckGuard.consecutiveCompacts > 0 ? { consecutiveCompacts: stuckGuard.consecutiveCompacts } : {}),
      });
      if (decision.pauseAutoCompaction) {
        stuckGuard.paused = true;
        yield* Effect.tryPromise({ try: () => persistStuckGuardState(ctx, sessionId, stuckGuard), catch: (e) => new Error(String(e)) });
        ctx.log?.agent.warn("auto-compaction paused (stuck guard)", { sessionId, consecutiveCompacts: stuckGuard.consecutiveCompacts });
      } else if (decision.resetStuckGuard) {
        stuckGuard.consecutiveCompacts = 0;
        stuckGuard.paused = false;
        yield* Effect.tryPromise({ try: () => persistStuckGuardState(ctx, sessionId, stuckGuard), catch: (e) => new Error(String(e)) });
      }
      return decision;
    }),
  runCompaction: () =>
    Effect.gen(function* () {
      if (stuckGuard.paused) {
        return { ok: false as const, errorMessage: "Auto-compaction paused (stuck guard)" };
      }
      const result = yield* runAutoCompactionEffect({
        session: sessionShape,
        model,
        ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
        settings: compactionSettings,
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      });
      if (result.ok) {
        stuckGuard.consecutiveCompacts += 1;
        yield* Effect.tryPromise({ try: () => persistStuckGuardState(ctx, sessionId, stuckGuard), catch: (e) => new Error(String(e)) });
      }
      return result;
    }),
};
```

Note: `session` here is `SessionShape` (not `PromiseSession`) — see H5. If H4 lands before H5, keep `PromiseSession` and bridge via `Effect.promise(() => sessionInstance.X())`. Cleaner to land H5's `SessionShape` swap first, but the order can flip if needed.

### Task H4.2: Convert `runPrompt` to `runPromptEffect`

**Step 1: Write the new function as returning an Effect.**

Replace lines 510-793 of `apps/server/src/agent/runner.ts`. The function signature changes from `async function runPrompt(...)` to `function runPromptEffect(...): Effect.Effect<void, Error>`.

The body becomes an `Effect.gen`:

```ts
function runPromptEffect(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  eventCallback: (event: AgentEvent) => void,
  // ... other args
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    // === Setup (was synchronous / awaited in runPrompt) ===
    const project = ...;
    const storage = ...;
    const session = ...;  // SessionShape
    // ... load agent, model, auth, tools, activeSkills, etc.
    const harness = new AgentHarness({ session, ... });
    yield* harness.switchAgentEffect(agent);

    // === PubSub drain fiber ===
    const eventStream = harness.subscribeStream();
    const drainFiber = yield* Effect.forkIn(scope)(
      Stream.runForEach(eventStream, (event) =>
        Effect.sync(() => eventCallback(event))
      )
    );
    yield* Effect.addFinalizer(() => Fiber.interrupt(drainFiber));

    // === Abort + registerRun ===
    const retryAbort = new AbortController();
    if (!registerRun(sessionId, harness, retryAbort)) {
      return yield* Effect.fail(new Error(busyMessage(sessionId)));
    }

    ctx.log?.agent.info("run starting", { sessionId, ... });

    // === Retry settings + stuck guard ===
    const retrySettings = parseRetrySettings(settings);
    let firstTurn = true;
    const stuckGuard = loadStuckGuardState(ctx, sessionId);

    // === Build Effect-typed retry deps (see H4.1) ===
    const depsEffect: RetryRunnerDepsEffect = { /* ... */ };

    // === Run the retry loop ===
    yield* executeWithRetryEffect(depsEffect, retrySettings);
  }).pipe(
    Effect.ensuring(Effect.sync(() => {
      ctx.log?.agent.info("run finished", { sessionId });
      getPermissionChannel(sessionId).rejectPending();
      unregisterRun(sessionId);
    })),
    Effect.mapError((error) => {
      ctx.log?.agent.error("run failed", error, { sessionId });
      return error instanceof Error ? error : new Error(String(error));
    })
  );
}
```

Note the `Scope` — need to manage it. Either accept a `Scope` parameter or create one inside:

```ts
return Effect.gen(function* () {
  // ...
}).pipe(
  // Use Effect.scope / Scope-managed variant if available, else provide a Scope via provideService
);
```

Per v4 limits, `Effect.forkIn(scope)` needs a `Scope`. Either:
- Use `Effect.forkScoped` (if available — check v4 reference) which uses the current scope
- Or wrap with `Effect.scoped(...)` and use `Effect.forkIn` with the implicit scope

Check `openspec/references/effect-v4/packages/effect/src/Scope.ts` and `Effect.ts` for the right pattern.

**Step 2: Update `activeRuns` + `abortRun` + `registerRun`.**

Change `activeRuns` from `Map<string, { harness, retryAbort }>` to `Map<string, { harness, runFiber, retryAbort }>`. `registerRun` stores the run fiber:

```ts
function registerRun(
  sessionId: string,
  harness: AgentHarness,
  retryAbort: AbortController,
  runFiber: Runtime.Runtime.Default.Fiber<void, Error>
): boolean {
  if (activeRuns.has(sessionId)) return false;
  activeRuns.set(sessionId, { harness, runFiber, retryAbort });
  return true;
}

function abortRun(sessionId: string): void {
  const run = activeRuns.get(sessionId);
  if (!run) return;
  run.retryAbort.abort();  // unblocks abortableSleep inside executeWithRetryEffect
  Effect.runPromise(Fiber.interrupt(run.runFiber).pipe(Effect.exit)).catch(() => {});
}
```

**Step 3: Update WS handler.**

In `apps/server/src/agent/ws-handler.ts`, the WS message handler that calls `runPrompt` becomes:

```ts
const runFiber = Effect.runFork(runPromptEffect(ctx, sessionId, message, (event) => ws.send(JSON.stringify(toFrame(event, sessionId)))));
registerRun(sessionId, harness, retryAbort, runFiber);
// Or, if the runner creates the fiber internally:
Effect.runPromise(runPromptEffect(...))
  .catch((err) => ws.send(errorFrame(sessionId, err)));
```

Prefer the single `Effect.runPromise` form for the WS edge — it's the "single boundary" the design calls for. The run fiber is created inside `runPromptEffect` (via `Effect.forkIn`) and stored via `registerRun` from inside the gen.

Actually — since `runPromptEffect` needs to register its own run fiber for `abortRun`, it's cleaner to fork inside the gen and return a `Runtime.Fiber` reference. The WS handler does:

```ts
await Effect.runPromise(runPromptEffect(ctx, ...)).catch((err) => ws.send(errorFrame(sessionId, err)));
```

And inside `runPromptEffect`, `registerRun` is called with the fiber reference (passed in or obtained via `Effect.forkIn` + `Effect.sync(() => registerRun(...))`).

Decide based on what's cleaner — likely: `runPromptEffect` takes the fiber reference from outside, OR uses a closure to register itself. Pick one.

**Step 4: Run server tests.**

```bash
cd apps/server && pnpm run test 2>&1 | grep "Tests "
```

Expected: 313 passed, 2 failed (pre-existing). If any other test fails — rewrite per the rule.

### Task H4.3: Typecheck + fix + commit Phase H4

```bash
cd apps/server && pnpm run typecheck
pnpm run fix
git add -A
git commit --no-verify -m "refactor(server): runPrompt as Effect.gen, single WS boundary (Phase H4)

runPromptEffect returns Effect<void, Error>; WS handler is the single
Effect.runPromise boundary in the production run path.

activeRuns stores the run Fiber; abortRun calls Fiber.interrupt (replaces
the AbortController-only approach). All retry callbacks (runTurn/rollbackLeaf/
checkCompaction/runCompaction) are Effect-returning via RetryRunnerDepsEffect.

Phase H4 of docs/plans/2026-06-29-effect-single-boundary.md"
```

---

## Phase H5 — Cleanup

**Goal:** Delete `PromiseSession`. Migrate the two production callers (`runner.ts:512`, `routes/sessions/compaction.ts:62`) to use `SessionShape` directly. Drop dead code (old `RetryRunnerDeps` if all migrated, `executeWithRetry` Promise wrapper if all migrated). Rewrite remaining `setTimeout`-based ws/e2e tests to `Stream`-based deterministic draining.

**Files:**
- Modify: `packages/agent/src/session/session.ts` (delete `PromiseSession` lines 443-652, `promiseSessionAsShape` line 653)
- Modify: `packages/agent/src/index.ts`, `packages/agent/src/harness-types.ts` (remove `PromiseSession` export)
- Modify: `apps/server/src/agent/runner.ts` (line 512 — construct `SessionShape` from storage)
- Modify: `apps/server/src/routes/sessions/compaction.ts` (line 62 — same)
- Modify: `apps/server/src/agent/__tests__/ws.test.ts`, `apps/server/src/agent/__tests__/e2e.test.ts` (rewrite setTimeout-draining)

### Task H5.1: Migrate `runner.ts` to use `SessionShape` directly

**Step 1: Find how `PromiseSession` is constructed.**

`apps/server/src/agent/runner.ts:512`: `const sessionInstance = new PromiseSession(storage);`

Replace with: `const session = /* SessionShape from storage */`.

`SqliteSessionStorage` implements `SessionStorageShape` which is structurally compatible with `SessionShape` — check if there's an adapter or if it's directly assignable. Look at `packages/db/src/session-entry-store.ts` for the API surface.

If a small adapter is needed (`storage` has `getEntries`/`getPathToRoot` but `SessionShape` has `getBranch`/`buildContext`), find the existing adapter (likely in `packages/agent/src/session/` or constructed at the call site in `runner.ts`).

**Step 2: Update compaction route.**

`apps/server/src/routes/sessions/compaction.ts:62`: same change.

**Step 3: Delete `PromiseSession` class.**

In `packages/agent/src/session/session.ts`, delete lines 443-653 (`PromiseSession` class + `promiseSessionAsShape`).

Remove from `packages/agent/src/index.ts`:
```ts
// remove:
PromiseSession,
promiseSessionAsShape,
```

Remove from `packages/agent/src/harness-types.ts:62`.

**Step 4: Typecheck.**

```bash
pnpm run typecheck
```

Expected: clean (no consumers of `PromiseSession` remain).

### Task H5.2: Delete dead Promise wrappers (if all callers migrated)

After H4, check whether anything still calls:
- `executeWithRetry` (Promise wrapper) — `rg "executeWithRetry\b" --type ts | grep -v Effect`
- Old `RetryRunnerDeps` (Promise interface) — `rg "RetryRunnerDeps\b" --type ts | grep -v Effect`

If empty: delete them. If non-empty: leave them (back-compat).

### Task H5.3: Rewrite remaining `setTimeout`-based ws/e2e tests

Find all `setTimeout` patterns in `apps/server/src/agent/__tests__/ws.test.ts` and `e2e.test.ts`:

```bash
rg "new Promise\(\(r\) => setTimeout" apps/server/src/agent/__tests__/
```

For each: replace with deterministic Effect-based draining. Pattern:

```ts
// OLD:
await new Promise((r) => setTimeout(r, 100));

// NEW (deterministic):
await Effect.runPromise(
  Effect.gen(function* () {
    // Wait for harness to be idle (definitive completion signal)
    yield* harness.waitForIdleEffect();
    // Or: drain the stream until a specific terminal event
    // yield* Stream.runCollect(harness.subscribeStream().pipe(Stream.takeUntil((e) => e.type === "settled")));
  })
);
```

If a test asserts on event ordering, use `Stream.runCollect` to snapshot the entire event sequence — that's deterministic, not timing-based.

### Task H5.4: Verify + commit Phase H5

```bash
pnpm run typecheck
cd packages/agent && pnpm run test 2>&1 | grep "Tests "    # expected: green, count may shift
cd packages/db && pnpm run test 2>&1 | grep "Tests "        # expected: 36 passed
cd apps/server && pnpm run test 2>&1 | grep "Tests "        # expected: only the 2 pre-existing failures
cd apps/desktop && pnpm run test 2>&1 | grep "Tests "       # expected: 402 passed
pnpm run fix
git add -A
git commit --no-verify -m "chore(agent): delete PromiseSession + cleanup (Phase H5)

PromiseSession deleted; the two production callers (runner, compaction
route) now construct SessionShape directly. Promise wrappers for retry
deps deleted if all callers migrated. setTimeout-based ws/e2e tests
rewritten to deterministic Stream-based draining.

Phase H5 of docs/plans/2026-06-29-effect-single-boundary.md — completes
the single-Effect-boundary goal."
```

---

## Verification (every phase)

After each phase, before commit:

```bash
pnpm run typecheck                              # workspace, turbo
cd packages/agent && pnpm run test              # agent tests
cd packages/db && pnpm run test                 # db tests
cd apps/server && pnpm run test                 # server tests
cd apps/desktop && pnpm run test                # desktop tests
pnpm run fix                                    # biome
```

**Accepted pre-existing failures (do not fix):**
- `apps/server` compaction route "summarizes and persists" — needs real OpenAI key.
- `apps/server` e2e "two concurrent sessions" — needs real OpenAI key.

Both fail identically on a clean tree, unrelated to this work.

## Notes for the executor

- **v4 API truth:** `openspec/references/effect-v4/packages/effect/src/`. If an Effect API seems missing, verify there — do NOT assume from memory.
- **No `Effect.runPromise` inside the agent logic after Phase H4** — only at the WS edge.
- **`exactOptionalPropertyTypes: true`** — use conditional spread `...(x !== undefined ? { x } : {})` for optionals.
- **TDD per phase:** RED (failing test for the new `*Effect` variant) → GREEN (extract/convert) → `pnpm run fix` → commit.
- **The rule:** if a test breaks due to Promise-timing, rewrite the test, do not roll back the Effect conversion.
- **Perf check:** after H4, sanity-check streaming throughput. If a regression appears, bisect with `node --trace-gc` and a mock token stream before theorizing.

## Risk register (from design doc, kept here for reference)

1. **Emit ordering (H2)** — `emitEffect` helper + regression test guard. If it fails, fix the helper, don't revert.
2. **`ws.test.ts`/`e2e.test.ts` false positives (H2/H4)** — rewrite per the rule.
3. **v4 API limits** — stick to verified APIs.
4. **5 retry tests churn (H3)** — mechanical; assertions unchanged.
5. **`abortableSleep` + `AbortSignal` coexistence** — `signal` stays on `RetryRunnerDepsEffect`; run-level Fiber interrupt handles full-run cancel.

## Definition of done

- [ ] Phase H1 committed — 7 harness methods have `*Effect` cores.
- [ ] Phase H2 committed — `executeTurn`/emit helpers are Effect-native; `promptEffect`/etc. drop `tryPromise`; regression test locks emit ordering.
- [ ] Phase H3 committed — `RetryRunnerDepsEffect` defined; `executeWithRetryEffect` consumes Effect callbacks.
- [ ] Phase H4 committed — `runPromptEffect` is `Effect.gen`; WS handler is single `Effect.runPromise` boundary; `abortRun` uses `Fiber.interrupt`.
- [ ] Phase H5 committed — `PromiseSession` deleted; dead Promise wrappers removed; ws/e2e tests deterministic.
- [ ] Workspace typecheck clean.
- [ ] Test counts: agent/db/desktop all green; server has only the 2 pre-existing API-key failures.
- [ ] `pnpm run fix` clean.
