# OM WS/UI Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface Observational Memory lifecycle to the UI — inline badges, sidebar progress bars, and observation detail renderer — with persisted markers that survive reloads.

**Architecture:** 5 new `AgentHarnessEvent` variants flow from the engine via an `onOmEvent` callback through the existing WS channel. Markers persist as `CustomMessage` entries in the session tree. The client reducer builds `om_marker` UI parts from events and reconstructs them on reload. Four UI surfaces: inline badge (8 states), observation renderer (priority emoji), sidebar progress bars, memory sidebar card.

**Tech Stack:** TypeScript, SolidJS, Tailwind CSS v4, Effect, Hono WS, Vitest

**Design doc:** `docs/plans/2026-07-02-om-ws-ui-integration-design.md`

---

## Phase 1: Event Types + Engine Callback (agent package)

### Task 1: Add OM event types to `AgentEvent` union

**Files:**

- Modify: `packages/agent/src/types.ts:243-307`

**Step 1: Write the type test**

Create `packages/agent/src/__tests__/om-event-types.test.ts`:

```ts
import type { AgentEvent } from "../types.ts";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

describe("OM event types", () => {
  it("om_start is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_start",
      cycleId: "abc-123",
      operationType: "observation",
      tokenCount: 12_500,
    };
    expect(event.type).toBe("om_start");
  });

  it("om_end is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_end",
      cycleId: "abc-123",
      operationType: "observation",
      durationMs: 3500,
      tokensProcessed: 32_500,
      tokensProduced: 4100,
      observations: "<observations>\n* test\n</observations>",
    };
    expect(event.type).toBe("om_end");
  });

  it("om_failed is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_failed",
      cycleId: "abc-123",
      operationType: "reflection",
      error: "LLM error",
      durationMs: 1000,
    };
    expect(event.type).toBe("om_failed");
  });

  it("om_activation is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_activation",
      cycleId: "abc-123",
      operationType: "observation",
      chunksActivated: 2,
      tokensActivated: 8000,
      observationTokens: 2000,
    };
    expect(event.type).toBe("om_activation");
  });

  it("om_status is a valid AgentEvent", () => {
    const event: AgentEvent = {
      type: "om_status",
      windows: {
        messages: { tokens: 18_000, threshold: 30_000 },
        observations: { tokens: 11_000, threshold: 40_000 },
      },
      recordId: "rec-1",
    };
    expect(event.type).toBe("om_status");
  });

  it("all operationTypes are accepted", () => {
    const types: Array<"observation" | "reflection" | "buffering"> = [
      "observation",
      "reflection",
      "buffering",
    ];
    for (const operationType of types) {
      const event: AgentEvent = {
        type: "om_start",
        cycleId: "x",
        operationType,
        tokenCount: 100,
      };
      expect(event.operationType).toBe(operationType);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/agent#test' -- src/__tests__/om-event-types.test.ts`
Expected: FAIL — TypeScript error: `om_start` etc. not assignable to `AgentEvent`

**Step 3: Add the event types**

Add to the end of the `AgentEvent` union in `packages/agent/src/types.ts` (after the `cache_shape` line, before the closing `;`):

```ts
  // --- Observational Memory lifecycle events ---
  // Fired by ObservationalMemoryEngine via onOmEvent callback.
  // cycleId joins start/end/failed/activation for the same operation.
  | {
      type: "om_start";
      cycleId: string;
      operationType: "observation" | "reflection" | "buffering";
      tokenCount: number;
    }
  | {
      type: "om_end";
      cycleId: string;
      operationType: "observation" | "reflection" | "buffering";
      durationMs: number;
      tokensProcessed: number;
      tokensProduced: number;
      observations?: string;
      currentTask?: string;
      suggestedResponse?: string;
    }
  | {
      type: "om_failed";
      cycleId: string;
      operationType: "observation" | "reflection" | "buffering";
      error: string;
      durationMs: number;
    }
  | {
      type: "om_activation";
      cycleId: string;
      operationType: "observation" | "reflection";
      chunksActivated: number;
      tokensActivated: number;
      observationTokens: number;
    }
  | {
      type: "om_status";
      windows: {
        messages: { tokens: number; threshold: number };
        observations: { tokens: number; threshold: number };
      };
      recordId: string;
    }
```

Also add a helper type after the union:

```ts
/** Extract just the OM events from AgentEvent. */
export type OmAgentEvent = Extract<
  AgentEvent,
  { type: "om_start" | "om_end" | "om_failed" | "om_activation" | "om_status" }
>;
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/agent#test' -- src/__tests__/om-event-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/agent/src/types.ts packages/agent/src/__tests__/om-event-types.test.ts
git commit -m "feat(agent): add OM lifecycle event types to AgentEvent union"
```

---

### Task 2: Add `onOmEvent` callback to engine + fire at lifecycle points

**Files:**

- Modify: `packages/agent/src/observational-memory/engine.ts:36-70` (options + constructor)
- Modify: `packages/agent/src/observational-memory/engine.ts:146-190` (maybeObserve — fire om_status)
- Modify: `packages/agent/src/observational-memory/engine.ts:197-235` (maybeReflect — fire om_status)
- Modify: `packages/agent/src/observational-memory/engine.ts:242-330` (maybeBufferObservation — fire om_start/om_end/om_failed)
- Modify: `packages/agent/src/observational-memory/engine.ts:371-436` (maybeBufferReflection — fire om_start/om_end/om_failed)
- Modify: `packages/agent/src/observational-memory/engine.ts:336-365` (maybeActivateBufferedObservations — fire om_activation)
- Modify: `packages/agent/src/observational-memory/engine.ts:442-465` (maybeActivateBufferedReflection — fire om_activation)
- Modify: `packages/agent/src/observational-memory/engine.ts:491-517` (runSyncObserve — fire om_start/om_end/om_failed)
- Modify: `packages/agent/src/observational-memory/engine.ts:519-542` (runSyncReflect — fire om_start/om_end/om_failed)
- Test: `packages/agent/src/observational-memory/__tests__/buffering.test.ts`

**Step 1: Write failing tests**

Add a new `describe` block at the end of `buffering.test.ts` (before the final closing of the top-level describe):

```ts
describe("onOmEvent callback", () => {
  let omEvents: AgentEvent[];

  beforeEach(() => {
    omEvents = [];
  });

  function createEngineWithCallback(): ObservationalMemoryEngine {
    return createEngine({
      onOmEvent: (event) => omEvents.push(event),
    } as ObservationalMemoryEngineOptions);
  }

  it("fires om_start + om_end on sync observe", async () => {
    setCompleteResponse("<observations>\n* test\n</observations>");
    const engine = createEngineWithCallback();
    const record = await engine.getOrCreateRecord();

    const t0 = Date.now();
    const messages: AgentMessage[] = [
      { role: "user", content: "a".repeat(500), timestamp: t0 },
      {
        role: "assistant",
        content: "b".repeat(500),
        timestamp: t0 + 1000,
        usage: createMockUsage(),
      },
    ];
    mockSessionEntries(messages);
    vi.mocked(complete).mockResolvedValue(
      completeTextResult("<observations>\n* 🔴 P1: test\n</observations>"),
    );

    const result = await engine.maybeObserve(record);
    await engine.waitForBuffering(1_000);

    const start = omEvents.find((e) => e.type === "om_start");
    const end = omEvents.find((e) => e.type === "om_end");
    expect(start).toBeDefined();
    expect(start!.operationType).toBe("observation");
    expect(end).toBeDefined();
    expect(end!.operationType).toBe("observation");
    expect(end!.observations).toContain("P1");
  });

  it("fires om_failed when observe errors", async () => {
    vi.mocked(complete).mockRejectedValue(new Error("LLM down"));
    const engine = createEngineWithCallback();
    const record = await engine.getOrCreateRecord();

    const t0 = Date.now();
    mockSessionEntries([
      { role: "user", content: "a".repeat(500), timestamp: t0 },
      {
        role: "assistant",
        content: "b".repeat(500),
        timestamp: t0 + 1000,
        usage: createMockUsage(),
      },
    ]);

    await engine.maybeObserve(record);

    const failed = omEvents.find((e) => e.type === "om_failed");
    expect(failed).toBeDefined();
    expect(failed!.error).toContain("LLM down");
  });

  it("fires om_status after maybeObserve", async () => {
    setCompleteResponse("<observations>\n* test\n</observations>");
    const engine = createEngineWithCallback();
    const record = await engine.getOrCreateRecord();

    await engine.maybeObserve(record);

    const status = omEvents.find((e) => e.type === "om_status");
    expect(status).toBeDefined();
    expect(status!.windows.messages).toBeDefined();
    expect(status!.windows.observations).toBeDefined();
  });

  it("fires om_start + om_end on sync reflect", async () => {
    const engine = createEngineWithCallback();
    // Seed a record with enough observation tokens to trigger reflection
    const record = await engine.getOrCreateRecord();
    await engine.storage.updateActiveObservations({
      id: record.id,
      observations: "test observations",
      lastObservedAt: new Date(),
      tokenCount: 50_000,
    });
    const seeded = await engine.getOrCreateRecord();

    vi.mocked(complete).mockResolvedValue(completeTextResult("reflected observations"));

    await engine.maybeReflect(seeded);

    const start = omEvents.find((e) => e.type === "om_start" && e.operationType === "reflection");
    const end = omEvents.find((e) => e.type === "om_end" && e.operationType === "reflection");
    expect(start).toBeDefined();
    expect(end).toBeDefined();
  });

  it("does not fire events when onOmEvent is undefined", async () => {
    // Existing behavior: no callback, no crash
    const engine = createEngine();
    const record = await engine.getOrCreateRecord();
    await engine.maybeObserve(record);
    // No assertion needed — just verify no throw
  });
});
```

Note: The test file already has `createEngine()`, `mockSessionEntries()`, and helper functions. You'll need to extend `createEngine` to accept options (or add a variant). Check the existing test helpers.

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/agent#test' -- src/observational-memory/__tests__/buffering.test.ts`
Expected: FAIL — `onOmEvent` not in options, events not fired

**Step 3: Add `onOmEvent` to engine options + private helper**

In `engine.ts`, add to `ObservationalMemoryEngineOptions`:

```ts
export interface ObservationalMemoryEngineOptions {
  readonly deps: ObservationalMemoryDeps;
  readonly abortSignal?: AbortSignal;
  /** OM lifecycle callback — forwarded to the WS bridge by agent-run.ts. */
  readonly onOmEvent?: (event: OmAgentEvent) => void;
}
```

Import `OmAgentEvent` from `../types.ts` at the top.

Add to the class:

```ts
private readonly onOmEvent: ((event: OmAgentEvent) => void) | undefined;
```

In the constructor:

```ts
this.onOmEvent = options.onOmEvent;
```

Add a private helper:

```ts
/**
 * Fire an OM lifecycle event via the callback. Best-effort: errors in the
 * callback are caught and logged, never propagated to the caller.
 */
private emitOmEvent(event: OmAgentEvent): void {
  try {
    this.onOmEvent?.(event);
  } catch (error) {
    this.logError("onOmEvent callback", error);
  }
}
```

**Step 4: Fire events in `runSyncObserve`**

Replace `runSyncObserve` with:

```ts
private async runSyncObserve(
  record: ObservationalMemoryRecord,
  entries: MessageEntry[],
): Promise<ObservationalMemoryRecord> {
  const cycleId = crypto.randomUUID();
  const startTime = Date.now();
  const unobserved = buildSessionContextFromEntries(entries).messages;
  const tokenCount = this.tokenCounter.countMessages(unobserved);

  this.emitOmEvent({ type: "om_start", cycleId, operationType: "observation", tokenCount });

  try {
    const observerResult = await runObserver({
      messagesToObserve: unobserved,
      existingObservations: record.activeObservations,
      deps: this.deps,
      ...(this.abortSignal ? { abortSignal: this.abortSignal } : {}),
    });

    const now = new Date();
    const observedMessageIds = this.extractObservedMessageIds(entries);

    await this.storage.updateActiveObservations({
      id: record.id,
      observations: record.activeObservations
        ? `${record.activeObservations}\n\n${observerResult.observations}`
        : observerResult.observations,
      lastObservedAt: now,
      tokenCount: observerResult.tokenCount,
      ...(observedMessageIds.length > 0 ? { observedMessageIds } : {}),
    });

    this.emitOmEvent({
      type: "om_end",
      cycleId,
      operationType: "observation",
      durationMs: Date.now() - startTime,
      tokensProcessed: tokenCount,
      tokensProduced: observerResult.tokenCount,
      ...(observerResult.observations ? { observations: observerResult.observations } : {}),
      ...(observerResult.currentTask ? { currentTask: observerResult.currentTask } : {}),
      ...(observerResult.suggestedContinuation
        ? { suggestedResponse: observerResult.suggestedContinuation }
        : {}),
    });

    return this.getOrCreateRecord();
  } catch (error) {
    this.emitOmEvent({
      type: "om_failed",
      cycleId,
      operationType: "observation",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    throw error;
  }
}
```

**Step 5: Fire events in `runSyncReflect`**

Replace `runSyncReflect` with:

```ts
private async runSyncReflect(
  record: ObservationalMemoryRecord,
): Promise<ObservationalMemoryRecord> {
  const cycleId = crypto.randomUUID();
  const startTime = Date.now();
  const tokenCount = record.observationTokenCount;

  this.emitOmEvent({ type: "om_start", cycleId, operationType: "reflection", tokenCount });

  await this.storage.setReflectingFlag(record.id, true);
  try {
    const reflectorResult = await runReflector({
      observations: record.activeObservations,
      deps: this.deps,
      ...(this.abortSignal ? { abortSignal: this.abortSignal } : {}),
    });

    await this.storage.createReflectionGeneration({
      currentRecord: record,
      reflection: reflectorResult.reflection,
      tokenCount: reflectorResult.tokenCount,
    });

    this.emitOmEvent({
      type: "om_end",
      cycleId,
      operationType: "reflection",
      durationMs: Date.now() - startTime,
      tokensProcessed: tokenCount,
      tokensProduced: reflectorResult.tokenCount,
      observations: reflectorResult.reflection,
    });

    return this.getOrCreateRecord();
  } catch (error) {
    this.emitOmEvent({
      type: "om_failed",
      cycleId,
      operationType: "reflection",
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    throw error;
  } finally {
    await this.storage.setReflectingFlag(record.id, false).catch(() => {});
  }
}
```

**Step 6: Fire events in `maybeBufferObservation`**

Add after `this.bufferingCoordinator.registerOp(currentTokens, "observation");`:

```ts
const cycleId = `buffer-obs-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
const startTime = Date.now();
this.emitOmEvent({
  type: "om_start",
  cycleId,
  operationType: "buffering",
  tokenCount: currentTokens,
});
```

Remove the old `const cycleId = ...` line that was further down (it's now hoisted).

After `await this.storage.updateBufferedObservations(...)` and before `flagCleared = true;`:

```ts
this.emitOmEvent({
  type: "om_end",
  cycleId,
  operationType: "buffering",
  durationMs: Date.now() - startTime,
  tokensProcessed: newTokens,
  tokensProduced: observerResult.tokenCount,
  observations: observerResult.observations,
});
```

In the `catch` block, before `this.logError`:

```ts
this.emitOmEvent({
  type: "om_failed",
  cycleId,
  operationType: "buffering",
  error: error instanceof Error ? error.message : String(error),
  durationMs: Date.now() - startTime,
});
```

**Step 7: Fire events in `maybeBufferReflection`**

Similar pattern — fire `om_start` at register, `om_end` after `updateBufferedReflection`, `om_failed` in catch. Use `operationType: "buffering"`.

**Step 8: Fire `om_activation` in activation methods**

In `maybeActivateBufferedObservations`, after `await this.storage.swapBufferedToActive(...)`:

```ts
const activatedChunks = chunks.length;
const tokensActivated = totalChunkMessageTokens;
this.emitOmEvent({
  type: "om_activation",
  cycleId: `activation-${Date.now()}`,
  operationType: "observation",
  chunksActivated: activatedChunks,
  tokensActivated,
  observationTokens: 0, // Will be resolved from the new record
});
```

In `maybeActivateBufferedReflection`, after `swapBufferedReflectionToActive`:

```ts
this.emitOmEvent({
  type: "om_activation",
  cycleId: `activation-${Date.now()}`,
  operationType: "reflection",
  chunksActivated: 1,
  tokensActivated: combinedTokenCount,
  observationTokens: combinedTokenCount,
});
```

**Step 9: Fire `om_status` at end of `maybeObserve` and `maybeReflect`**

Add a private helper:

```ts
private async emitOmStatus(record: ObservationalMemoryRecord): Promise<void> {
  this.emitOmEvent({
    type: "om_status",
    windows: {
      messages: {
        tokens: record.pendingMessageTokens,
        threshold: this.deps.thresholds.observation,
      },
      observations: {
        tokens: record.observationTokenCount,
        threshold: this.deps.thresholds.reflection,
      },
    },
    recordId: record.id,
  });
}
```

Call `await this.emitOmStatus(latestRecord)` at the end of `maybeObserve` (just before the final `return` in each branch) and `maybeReflect`. Use the record that will be returned.

**Step 10: Run tests to verify they pass**

Run: `vp run '@sakti-code/agent#test' -- src/observational-memory/__tests__/buffering.test.ts`
Expected: PASS

**Step 11: Run full agent test suite**

Run: `vp run '@sakti-code/agent#test'`
Expected: All 473+ tests pass

**Step 12: Commit**

```bash
git add packages/agent/src/observational-memory/engine.ts packages/agent/src/observational-memory/__tests__/buffering.test.ts
git commit -m "feat(observational-memory): fire OM lifecycle events via onOmEvent callback"
```

---

### Task 3: Wire `onOmEvent` to `emit` in agent-run.ts + persist markers

**Files:**

- Modify: `packages/agent/src/runner/agent-run.ts` (OM wiring section)
- Test: `packages/agent/src/runner/__tests__/agent-run.test.ts`

**Step 1: Write failing test**

Add to `agent-run.test.ts`:

```ts
it("OM events are forwarded to emit", async () => {
  const events: AgentHarnessEvent[] = [];
  // ... setup a minimal run with OM enabled ...
  // After run completes, verify om_status events were emitted
  const omEvents = events.filter(
    (e) => typeof e === "object" && "type" in e && e.type.startsWith("om_"),
  );
  expect(omEvents.length).toBeGreaterThan(0);
});
```

(Use the existing test helpers in `agent-run.test.ts` to set up a run with OM enabled. The key assertion: OM events appear in the `emit` callback output.)

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/agent#test' -- src/runner/__tests__/agent-run.test.ts`
Expected: FAIL — no OM events in emit output

**Step 3: Wire `onOmEvent` to `emit`**

In `agent-run.ts`, where the engine is constructed (the `if (deps.observationalMemory?.enabled)` block), add `onOmEvent`:

```ts
omEngine = new ObservationalMemoryEngine({
  deps: omDeps,
  abortSignal: retryAbort.signal,
  onOmEvent: (event) => emit(event),
});
```

**Step 4: Add marker persistence**

After each `om_end` or `om_failed` event, persist a `CustomMessage`. Add this logic in the `onOmEvent` callback:

```ts
onOmEvent: (event) => {
  emit(event);

  // Persist completed/failed markers as CustomMessage entries for reload.
  if (event.type === "om_end" || event.type === "om_failed") {
    void session
      .appendCustomMessageEntry(
        "om_marker",
        "",
        false,
        {
          cycleId: event.cycleId,
          operationType: event.operationType,
          status: event.type === "om_end" ? "complete" : "failed",
          durationMs: event.durationMs,
          tokensProcessed: event.type === "om_end" ? event.tokensProcessed : undefined,
          tokensProduced: event.type === "om_end" ? event.tokensProduced : undefined,
          observations: event.type === "om_end" ? event.observations : undefined,
          currentTask: event.type === "om_end" ? event.currentTask : undefined,
          suggestedResponse: event.type === "om_end" ? event.suggestedResponse : undefined,
          error: event.type === "om_failed" ? event.error : undefined,
        },
      )
      .catch(() => {});
  }
},
```

Note: `session` is the `SessionShape` available in `agent-run.ts`. Check the exact variable name — it may be `sessionShape` or similar. Use `void` + `.catch(() => {})` since persistence is best-effort.

**Step 5: Run test to verify it passes**

Run: `vp run '@sakti-code/agent#test' -- src/runner/__tests__/agent-run.test.ts`
Expected: PASS

**Step 6: Run full agent test suite**

Run: `vp run '@sakti-code/agent#test'`
Expected: All tests pass

**Step 7: Commit**

```bash
git add packages/agent/src/runner/agent-run.ts packages/agent/src/runner/__tests__/agent-run.test.ts
git commit -m "feat(agent-run): wire OM events to emit + persist markers as CustomMessage"
```

---

## Phase 2: Client State (desktop store)

### Task 4: Add `om_marker` part type + `omStatus` to store + new actions

**Files:**

- Modify: `apps/desktop/src/stores/types.ts:8-20` (MessagePart)
- Modify: `apps/desktop/src/stores/session/session-store.ts:25-35` (SessionStoreData)
- Modify: `apps/desktop/src/stores/session/session-store.ts:37-70` (SessionActions)
- Modify: `apps/desktop/src/stores/session/session-store.ts:77-86` (initial state)
- Test: `apps/desktop/src/stores/session/__tests__/session-store.test.ts`

**Step 1: Write failing tests**

Add to `session-store.test.ts`:

```ts
describe("OM marker actions", () => {
  it("addOmMarker appends om_marker part to a message", () => {
    const { actions, store } = createSessionStore();
    actions.addMessage({
      id: "msg1",
      role: "assistant",
      content: "hello",
      parts: [{ type: "text", text: "hello" }],
      isStreaming: false,
      timestamp: Date.now(),
    });

    actions.addOmMarker("msg1", {
      cycleId: "c1",
      operationType: "observation",
      status: "loading",
    });

    const marker = store.messages.msg1.parts.find((p) => p.type === "om_marker");
    expect(marker).toBeDefined();
    expect(marker!.cycleId).toBe("c1");
  });

  it("updateOmMarker updates by cycleId", () => {
    const { actions, store } = createSessionStore();
    actions.addMessage({
      id: "msg1",
      role: "assistant",
      content: "hello",
      parts: [{ type: "text", text: "hello" }],
      isStreaming: false,
      timestamp: Date.now(),
    });
    actions.addOmMarker("msg1", { cycleId: "c1", operationType: "observation", status: "loading" });

    actions.updateOmMarker("msg1", "c1", {
      status: "complete",
      durationMs: 3000,
      tokensProcessed: 1000,
      tokensProduced: 200,
      observations: "test",
    });

    const marker = store.messages.msg1.parts.find(
      (p): p is Extract<MessagePart, { type: "om_marker" }> => p.type === "om_marker",
    );
    expect(marker!.status).toBe("complete");
    expect(marker!.observations).toBe("test");
  });

  it("updateOmStatus sets the omStatus field", () => {
    const { actions, store } = createSessionStore();
    actions.updateOmStatus({
      messages: { tokens: 5000, threshold: 30000 },
      observations: { tokens: 2000, threshold: 40000 },
    });
    expect(store.omStatus).toBeDefined();
    expect(store.omStatus!.messages.tokens).toBe(5000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/session/__tests__/session-store.test.ts` (in desktop)
Expected: FAIL — `addOmMarker`, `updateOmMarker`, `updateOmStatus` not defined

**Step 3: Add `om_marker` to `MessagePart`**

In `apps/desktop/src/stores/types.ts`, add to the `MessagePart` union:

```ts
export type MessagePart = { isStreaming?: boolean } & (
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      input: unknown;
      status: "running" | "done" | "error";
      result?: string;
      details?: unknown;
    }
  | { type: "thinking"; text: string; startedAt?: number; endedAt?: number }
  | {
      type: "om_marker";
      cycleId: string;
      operationType: "observation" | "reflection" | "buffering";
      status:
        | "loading"
        | "complete"
        | "failed"
        | "buffering"
        | "buffering-complete"
        | "buffering-failed"
        | "activated"
        | "disconnected";
      durationMs?: number;
      tokensProcessed?: number;
      tokensProduced?: number;
      observations?: string;
      currentTask?: string;
      suggestedResponse?: string;
      error?: string;
    }
);
```

Add the `OmWindowState` type:

```ts
export interface OmWindowState {
  messages: { tokens: number; threshold: number };
  observations: { tokens: number; threshold: number };
}
```

**Step 4: Add `omStatus` to `SessionStoreData` + new actions**

In `session-store.ts`:

```ts
import type {
  MessagePart,
  OmWindowState,
  RetryState,
  StreamState,
  TurnTiming,
  UIMessage,
} from "../types.ts";

export interface SessionStoreData {
  messageOrder: string[];
  messages: Record<string, UIMessage>;
  permission: PermissionPending | null;
  proposedSession: ProposedSession | null;
  retry: RetryState | null;
  streaming: StreamState;
  turnTimings: TurnTiming[];
  omStatus: OmWindowState | null;
}
```

Add to `SessionActions`:

```ts
export interface OmMarkerInput {
  cycleId: string;
  operationType: "observation" | "reflection" | "buffering";
  status:
    | "loading"
    | "complete"
    | "failed"
    | "buffering"
    | "buffering-complete"
    | "buffering-failed"
    | "activated"
    | "disconnected";
  durationMs?: number;
  tokensProcessed?: number;
  tokensProduced?: number;
  observations?: string;
  currentTask?: string;
  suggestedResponse?: string;
  error?: string;
}

export interface SessionActions {
  // ... existing actions ...
  addOmMarker: (msgId: string, marker: OmMarkerInput) => void;
  updateOmMarker: (msgId: string, cycleId: string, updates: Partial<OmMarkerInput>) => void;
  updateOmStatus: (status: OmWindowState) => void;
}
```

Add initial state: `omStatus: null` in `createStore`.

Add action implementations:

```ts
addOmMarker(msgId, marker) {
  setStore(
    "messages",
    msgId,
    "parts",
    produce((parts: MessagePart[]) => {
      // Don't add if cycleId already exists (re-entry guard)
      if (parts.some((p) => p.type === "om_marker" && p.cycleId === marker.cycleId)) return;
      parts.push({ type: "om_marker", ...marker });
    }),
  );
},

updateOmMarker(msgId, cycleId, updates) {
  setStore(
    "messages",
    msgId,
    "parts",
    produce((parts: MessagePart[]) => {
      const idx = parts.findIndex(
        (p) => p.type === "om_marker" && p.cycleId === cycleId,
      );
      if (idx >= 0) {
        parts[idx] = { ...parts[idx], ...updates, type: "om_marker" } as MessagePart;
      }
    }),
  );
},

updateOmStatus(status) {
  setStore("omStatus", status);
},
```

Also add `omStatus: null` to the `reset` action's replacement state.

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/stores/session/__tests__/session-store.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/stores/types.ts apps/desktop/src/stores/session/session-store.ts apps/desktop/src/stores/session/__tests__/session-store.test.ts
git commit -m "feat(desktop): add om_marker MessagePart + omStatus store state + actions"
```

---

### Task 5: Extend `dispatchEvent` reducer with OM event cases

**Files:**

- Modify: `apps/desktop/src/stores/session/event-reducer.ts:114-217`
- Test: `apps/desktop/src/stores/session/__tests__/event-reducer.test.ts`

**Step 1: Write failing tests**

Add to `event-reducer.test.ts`:

```ts
describe("OM events", () => {
  it("om_start adds a loading om_marker to current message", () => {
    const { actions, store } = setupStoreWithAssistantMessage();
    dispatchEvent(actions, mockBatcher, {
      type: "om_start",
      cycleId: "c1",
      operationType: "observation",
      tokenCount: 5000,
    });
    const marker = findOmMarker(store, "c1");
    expect(marker).toBeDefined();
    expect(marker!.status).toBe("loading");
  });

  it("om_end updates marker to complete", () => {
    const { actions, store } = setupStoreWithAssistantMessage();
    dispatchEvent(actions, mockBatcher, {
      type: "om_start",
      cycleId: "c1",
      operationType: "observation",
      tokenCount: 5000,
    });
    dispatchEvent(actions, mockBatcher, {
      type: "om_end",
      cycleId: "c1",
      operationType: "observation",
      durationMs: 3000,
      tokensProcessed: 5000,
      tokensProduced: 1000,
      observations: "test obs",
    });
    const marker = findOmMarker(store, "c1");
    expect(marker!.status).toBe("complete");
    expect(marker!.observations).toBe("test obs");
  });

  it("om_failed updates marker to failed", () => {
    const { actions, store } = setupStoreWithAssistantMessage();
    dispatchEvent(actions, mockBatcher, {
      type: "om_start",
      cycleId: "c1",
      operationType: "observation",
      tokenCount: 5000,
    });
    dispatchEvent(actions, mockBatcher, {
      type: "om_failed",
      cycleId: "c1",
      operationType: "observation",
      error: "boom",
      durationMs: 100,
    });
    const marker = findOmMarker(store, "c1");
    expect(marker!.status).toBe("failed");
    expect(marker!.error).toBe("boom");
  });

  it("om_status updates omStatus", () => {
    const { actions, store } = createSessionStore();
    dispatchEvent(actions, mockBatcher, {
      type: "om_status",
      windows: {
        messages: { tokens: 18000, threshold: 30000 },
        observations: { tokens: 11000, threshold: 40000 },
      },
      recordId: "r1",
    });
    expect(store.omStatus).toBeDefined();
    expect(store.omStatus!.messages.tokens).toBe(18000);
  });

  it("om_activation updates marker to activated", () => {
    const { actions, store } = setupStoreWithAssistantMessage();
    dispatchEvent(actions, mockBatcher, {
      type: "om_start",
      cycleId: "c1",
      operationType: "buffering",
      tokenCount: 5000,
    });
    dispatchEvent(actions, mockBatcher, {
      type: "om_activation",
      cycleId: "c1",
      operationType: "observation",
      chunksActivated: 2,
      tokensActivated: 8000,
      observationTokens: 2000,
    });
    const marker = findOmMarker(store, "c1");
    expect(marker!.status).toBe("activated");
  });

  it("om_start with buffering operationType sets buffering status", () => {
    const { actions, store } = setupStoreWithAssistantMessage();
    dispatchEvent(actions, mockBatcher, {
      type: "om_start",
      cycleId: "c1",
      operationType: "buffering",
      tokenCount: 5000,
    });
    const marker = findOmMarker(store, "c1");
    expect(marker!.status).toBe("buffering");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/session/__tests__/event-reducer.test.ts`
Expected: FAIL — OM event types not handled in switch

**Step 3: Add OM cases to `dispatchEvent`**

Add these cases to the `switch` in `dispatchEvent` (before the closing `}`):

```ts
case "om_start": {
  const msgId = actions.getCurrentMessageId() ?? lastAssistantId();
  if (msgId) {
    actions.addOmMarker(msgId, {
      cycleId: event.cycleId,
      operationType: event.operationType,
      status: event.operationType === "buffering" ? "buffering" : "loading",
      tokensProcessed: event.tokenCount,
    });
  }
  break;
}

case "om_end": {
  const msgId = actions.getCurrentMessageId() ?? lastAssistantId();
  if (msgId) {
    actions.updateOmMarker(msgId, event.cycleId, {
      status: "complete",
      durationMs: event.durationMs,
      tokensProcessed: event.tokensProcessed,
      tokensProduced: event.tokensProduced,
      ...(event.observations !== undefined ? { observations: event.observations } : {}),
      ...(event.currentTask !== undefined ? { currentTask: event.currentTask } : {}),
      ...(event.suggestedResponse !== undefined ? { suggestedResponse: event.suggestedResponse } : {}),
    });
  }
  break;
}

case "om_failed": {
  const msgId = actions.getCurrentMessageId() ?? lastAssistantId();
  if (msgId) {
    actions.updateOmMarker(msgId, event.cycleId, {
      status: "failed",
      error: event.error,
      durationMs: event.durationMs,
    });
  }
  break;
}

case "om_activation": {
  const msgId = actions.getCurrentMessageId() ?? lastAssistantId();
  if (msgId) {
    actions.updateOmMarker(msgId, event.cycleId, { status: "activated" });
  }
  break;
}

case "om_status":
  actions.updateOmStatus(event.windows);
  break;
```

Add a helper function at the top of the file (outside `dispatchEvent`):

```ts
/** Find the last assistant message id, for OM markers that fire after message_end. */
function lastAssistantId(): string | null {
  // This needs access to messageOrder + messages. Pass via a new parameter
  // or expose a getLastAssistantMessageId() action on SessionActions.
  // For now, expose via actions.getLastAssistantMessageId().
  return null; // placeholder — wire in step below
}
```

Actually, cleaner approach: add a `getLastAssistantMessageId()` to `SessionActions`. This gives the reducer access without needing direct store access.

Add to `SessionActions`:

```ts
getLastAssistantMessageId: () => string | null;
```

Implement in `createSessionStore`:

```ts
getLastAssistantMessageId() {
  for (let i = store.messageOrder.length - 1; i >= 0; i--) {
    const id = store.messageOrder[i];
    if (store.messages[id]?.role === "assistant") return id;
  }
  return null;
},
```

Then use `actions.getLastAssistantMessageId()` in the reducer instead of the placeholder `lastAssistantId()`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/session/__tests__/event-reducer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/session/event-reducer.ts apps/desktop/src/stores/session/session-store.ts apps/desktop/src/stores/session/__tests__/event-reducer.test.ts
git commit -m "feat(desktop): handle OM events in dispatchEvent reducer"
```

---

### Task 6: Extend `hydrateSessionMessages` for reload

**Files:**

- Modify: `apps/desktop/src/stores/session/hydrate-messages.ts`
- Test: `apps/desktop/src/stores/session/__tests__/hydrate-messages.test.ts`

**Step 1: Write failing test**

Add to `hydrate-messages.test.ts`:

```ts
it("converts CustomMessage(om_marker) to om_marker part on preceding assistant", () => {
  const messages: AgentMessage[] = [
    { role: "assistant", content: "hello", timestamp: 1000 } as AgentMessage,
    {
      role: "custom",
      customType: "om_marker",
      content: "",
      display: false,
      timestamp: 2000,
      details: {
        cycleId: "c1",
        operationType: "observation",
        status: "complete",
        durationMs: 3000,
        tokensProcessed: 5000,
        tokensProduced: 1000,
        observations: "test",
      },
    } as AgentMessage,
  ];

  const result = hydrateSessionMessages(messages);
  expect(result).toHaveLength(1); // CustomMessage doesn't create a new UIMessage
  expect(result[0].role).toBe("assistant");
  const marker = result[0].parts.find((p) => p.type === "om_marker");
  expect(marker).toBeDefined();
  expect(marker!.cycleId).toBe("c1");
  expect(marker!.status).toBe("complete");
});

it("stamps loading markers as disconnected on reload", () => {
  const messages: AgentMessage[] = [
    { role: "assistant", content: "hello", timestamp: 1000 } as AgentMessage,
    {
      role: "custom",
      customType: "om_marker",
      content: "",
      display: false,
      timestamp: 2000,
      details: {
        cycleId: "c1",
        operationType: "observation",
        status: "loading",
        tokensProcessed: 5000,
      },
    } as AgentMessage,
  ];

  const result = hydrateSessionMessages(messages);
  const marker = result[0].parts.find((p) => p.type === "om_marker");
  expect(marker!.status).toBe("disconnected");
});

it("handles om_marker with no preceding assistant (orphan)", () => {
  const messages: AgentMessage[] = [
    {
      role: "custom",
      customType: "om_marker",
      content: "",
      display: false,
      timestamp: 1000,
      details: { cycleId: "c1", operationType: "observation", status: "complete" },
    } as AgentMessage,
  ];

  const result = hydrateSessionMessages(messages);
  // Orphan marker: skip silently (no assistant to attach to)
  expect(result).toHaveLength(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/session/__tests__/hydrate-messages.test.ts`
Expected: FAIL

**Step 3: Extend hydration**

In `hydrate-messages.ts`, modify the main loop. When encountering `msg.role === "custom"` with `customType === "om_marker"`:

```ts
// Inside the hydrateSessionMessages loop:
if (msg.role === "custom" && "customType" in msg && msg.customType === "om_marker") {
  const details = (msg as { details?: Record<string, unknown> }).details;
  if (!details) continue;

  // Find the last assistant UIMessage in the result so far
  let lastAssistant: UIMessage | undefined;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role === "assistant") {
      lastAssistant = result[i];
      break;
    }
  }
  if (!lastAssistant) continue; // orphan marker — skip

  const status = details.status as string;
  lastAssistant.parts.push({
    type: "om_marker",
    cycleId: details.cycleId as string,
    operationType: details.operationType as "observation" | "reflection" | "buffering",
    status:
      status === "loading" || status === "buffering"
        ? "disconnected"
        : (status as MessagePart extends { type: "om_marker" } ? MessagePart["status"] : never),
    ...(details.durationMs !== undefined ? { durationMs: details.durationMs as number } : {}),
    ...(details.tokensProcessed !== undefined
      ? { tokensProcessed: details.tokensProcessed as number }
      : {}),
    ...(details.tokensProduced !== undefined
      ? { tokensProduced: details.tokensProduced as number }
      : {}),
    ...(details.observations !== undefined ? { observations: details.observations as string } : {}),
    ...(details.currentTask !== undefined ? { currentTask: details.currentTask as string } : {}),
    ...(details.suggestedResponse !== undefined
      ? { suggestedResponse: details.suggestedResponse as string }
      : {}),
    ...(details.error !== undefined ? { error: details.error as string } : {}),
  });
  continue;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/session/__tests__/hydrate-messages.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/session/hydrate-messages.ts apps/desktop/src/stores/session/__tests__/hydrate-messages.test.ts
git commit -m "feat(desktop): hydrate om_marker parts from CustomMessage on reload"
```

---

## Phase 3: UI Components (desktop renderer)

### Task 7: `OmMarkerPart` component (inline badge)

**Files:**

- Create: `apps/desktop/src/components/chat-area/parts/om-marker-part.tsx`
- Test: `apps/desktop/src/components/chat-area/parts/__tests__/om-marker-part.test.tsx`

**Step 1: Write failing test**

```tsx
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { OmMarkerPart } from "../om-marker-part.tsx";

describe("OmMarkerPart", () => {
  it("renders loading state", () => {
    const part = {
      type: "om_marker" as const,
      cycleId: "c1",
      operationType: "observation" as const,
      status: "loading" as const,
      tokensProcessed: 12500,
    };
    const { container } = render(() => <OmMarkerPart part={part} />);
    expect(container.textContent).toContain("Observing");
    expect(container.textContent).toContain("12.5k");
  });

  it("renders complete state with compression ratio", () => {
    const part = {
      type: "om_marker",
      cycleId: "c1",
      operationType: "observation",
      status: "complete",
      tokensProcessed: 32500,
      tokensProduced: 4100,
      durationMs: 3500,
    };
    const { container } = render(() => <OmMarkerPart part={part} />);
    expect(container.textContent).toContain("Observed");
    expect(container.textContent).toContain("32.5k");
    expect(container.textContent).toContain("4.1k");
    expect(container.textContent).toContain("8x"); // compression ratio
  });

  it("renders failed state", () => {
    const part = {
      type: "om_marker",
      cycleId: "c1",
      operationType: "observation",
      status: "failed",
      error: "LLM error",
      durationMs: 100,
    };
    const { container } = render(() => <OmMarkerPart part={part} />);
    expect(container.textContent).toContain("failed");
    expect(container.textContent).toContain("LLM error");
  });
});
```

**Step 2: Implement `OmMarkerPart`**

Create `om-marker-part.tsx`. Key elements:

- Badge row with icon + status text (collapsed)
- Expandable detail panel (observations, current task, suggested response, stats)
- Token formatting helper: `formatTokens(n)` — `<1000` plain, `>=1000` → `"12.3k"`, `>=1M` → `"1.2M"`
- Compression ratio: `Math.round(tokensProcessed / tokensProduced)` when both present and ratio > 1
- Color by status using sakti's design tokens: `bg-info/10 text-info` (loading), `bg-success/10 text-success` (complete/activated), `bg-destructive/10 text-destructive` (failed), `bg-warning/10 text-warning` (disconnected), `bg-accent/10 text-accent-foreground` (buffering states)
- Icons: use `solid-icons/fi` (`FiEye`, `FiLoader`, `FiXCircle`, `FiAlertTriangle`) or Tabler Outline
- Expand/collapse via local `createSignal`

```tsx
import { createSignal, Show, type Component } from "solid-js";
import { FiEye, FiLoader, FiXCircle, FiAlertTriangle, FiChevronDown } from "solid-icons/fi";
import type { MessagePart } from "~/stores/types.ts";
import { ObservationRenderer } from "./observation-renderer.tsx";
import { cn } from "~/lib/utils/index.ts";

type OmMarkerPart = Extract<MessagePart, { type: "om_marker" }>;

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

function compressionRatio(processed?: number, produced?: number): number | undefined {
  if (!processed || !produced || produced >= processed) return undefined;
  return Math.round(processed / produced);
}

const STATUS_STYLES: Record<OmMarkerPart["status"], { bg: string; icon: Component<{ class?: string }>; label: string }> = {
  loading: { bg: "bg-info/10 text-info", icon: FiLoader, label: "Observing" },
  complete: { bg: "bg-success/10 text-success", icon: FiEye, label: "Observed" },
  failed: { bg: "bg-destructive/10 text-destructive", icon: FiXCircle, label: "Observation failed" },
  buffering: { bg: "bg-accent/10 text-accent-foreground border border-dashed border-accent/30", icon: FiLoader, label: "Buffering" },
  "buffering-complete": { bg: "bg-accent/10 text-accent-foreground border border-dashed border-accent/30", icon: FiEye, label: "Buffered" },
  "buffering-failed": { bg: "bg-destructive/10 text-destructive border border-dashed border-destructive/30", icon: FiXCircle, label: "Buffered observation failed" },
  activated: { bg: "bg-success/10 text-success", icon: FiEye, label: "Activated" },
  disconnected: { bg: "bg-warning/10 text-warning", icon: FiAlertTriangle, label: "Observation interrupted" },
};

export function OmMarkerPart(props: { part: OmMarkerPart }) {
  const [expanded, setExpanded] = createSignal(false);
  const style = () => STATUS_STYLES[props.part.status];
  const ratio = () => compressionRatio(props.part.tokensProcessed, props.part.tokensProduced);
  const hasDetail = () =>
    props.part.observations || props.part.currentTask || props.part.suggestedResponse || props.part.error;

  return (
    <div class="mb-1" data-component="om-marker-part" data-om-cycle={props.part.cycleId} data-om-status={props.part.status}>
      <button
        class={cn("flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", style().bg)}
        onClick={() => hasDetail() && setExpanded(!expanded())}
      >
        <style().icon class={cn("h-3.5 w-3.5 shrink-0", props.part.status === "loading" || props.part.status === "buffering" ? "animate-spin" : "")} />
        <span class="min-w-0 flex-1 truncate">
          {/* Status-specific text */}
          <Show when={props.part.status === "loading" || props.part.status === "buffering"}>
            {style().label} ~{formatTokens(props.part.tokensProcessed ?? 0)} tokens...
          </Show>
          <Show when={(props.part.status === "complete" || props.part.status === "activated" || props.part.status === "buffering-complete") && props.part.tokensProcessed}>
            {style().label} {formatTokens(props.part.tokensProcessed!)}→{formatTokens(props.part.tokensProduced ?? 0)} tokens
            <Show when={ratio()}> (-{ratio()}x)</Show>
          </Show>
          <Show when={props.part.status === "failed" || props.part.status === "buffering-failed"}>
            {style().label}
          </Show>
          <Show when={props.part.status === "disconnected"}>
            {style().label} (~{formatTokens(props.part.tokensProcessed ?? 0)} tokens)
          </Show>
        </span>
        <Show when={props.part.durationMs !== undefined}>
          <span class="shrink-0 text-muted-foreground/70 tabular-nums">
            {(props.part.durationMs! / 1000).toFixed(1)}s
          </span>
        </Show>
        <Show when={hasDetail()}>
          <FiChevronDown class={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", expanded() && "rotate-180")} />
        </Show>
      </button>

      <Show when={expanded() && hasDetail()}>
        <div class="mt-1 rounded-lg border border-border/50 bg-muted/30 p-3 text-sm">
          {/* Stats row */}
          <Show when={props.part.tokensProcessed !== undefined}>
            <div class="mb-2 flex gap-4 text-xs text-muted-foreground">
              <Show when={props.part.tokensProcessed !== undefined}>
                <span>Input: {formatTokens(props.part.tokensProcessed!)}</span>
              </Show>
              <Show when={props.part.tokensProduced !== undefined}>
                <span>Output: {formatTokens(props.part.tokensProduced!)}</span>
              </Show>
              <Show when={ratio() && ratio()! > 1}>
                <span>Compression: {ratio()}x</span>
              </Show>
            </div>
          </Show>

          {/* Error */}
          <Show when={props.part.error}>
            <div class="rounded-md bg-destructive/5 p-2 text-destructive text-xs">{props.part.error}</div>
          </Show>

          {/* Observations */}
          <Show when={props.part.observations}>
            <ObservationRenderer text={props.part.observations!} />
          </Show>

          {/* Current task */}
          <Show when={props.part.currentTask}>
            <div class="mt-2 text-xs">
              <span class="font-medium text-muted-foreground">Current task: </span>
              {props.part.currentTask}
            </div>
          </Show>

          {/* Suggested response */}
          <Show when={props.part.suggestedResponse}>
            <div class="mt-1 text-xs italic text-muted-foreground">{props.part.suggestedResponse}</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
```

**Step 3: Run test to verify it passes**

Run: `npx vitest run src/components/chat-area/parts/__tests__/om-marker-part.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/desktop/src/components/chat-area/parts/om-marker-part.tsx apps/desktop/src/components/chat-area/parts/__tests__/om-marker-part.test.tsx
git commit -m "feat(desktop): OmMarkerPart component with 8 visual states"
```

---

### Task 8: `ObservationRenderer` component

**Files:**

- Create: `apps/desktop/src/components/chat-area/parts/observation-renderer.tsx`
- Test: `apps/desktop/src/components/chat-area/parts/__tests__/observation-renderer.test.tsx`

**Step 1: Write failing test**

```tsx
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { ObservationRenderer } from "../observation-renderer.tsx";

describe("ObservationRenderer", () => {
  it("parses priority emojis into colored cards", () => {
    const text =
      "<observations>\n* 🔴 P1: Critical bug\n* 🟡 P2: Warning\n* 🟢 P3: Minor\n</observations>";
    const { container } = render(() => <ObservationRenderer text={text} />);
    const cards = container.querySelectorAll("[data-priority]");
    expect(cards.length).toBe(3);
    expect(cards[0].getAttribute("data-priority")).toBe("P1");
    expect(cards[1].getAttribute("data-priority")).toBe("P2");
    expect(cards[2].getAttribute("data-priority")).toBe("P3");
  });

  it("renders text without priority emojis as plain paragraphs", () => {
    const { container } = render(() => <ObservationRenderer text="Just a plain observation" />);
    expect(container.textContent).toContain("plain observation");
  });
});
```

**Step 2: Implement `ObservationRenderer`**

```tsx
import { For, type Component } from "solid-js";
import { cn } from "~/lib/utils/index.ts";

interface ObservationItem {
  priority?: "P1" | "P2" | "P3";
  text: string;
}

const PRIORITY_STYLES: Record<"P1" | "P2" | "P3", string> = {
  P1: "border-l-destructive bg-destructive/5",
  P2: "border-l-warning bg-warning/5",
  P3: "border-l-success bg-success/5",
};

function parseObservations(text: string): ObservationItem[] {
  // Strip XML tags
  const cleaned = text
    .replace(/<\/?observations>/g, "")
    .replace(/<\/?current-task>/g, "")
    .replace(/<\/?suggested-response>/g, "")
    .trim();
  if (!cleaned) return [];

  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: ObservationItem[] = [];

  for (const line of lines) {
    // Match priority emoji pattern: 🔴 P1, 🟡 P2, 🟢 P3
    const match = line.match(/^[🔴🟡🟢⚫⚪]+\s*(P[123])?\s*:?\s*(.+)$/);
    if (match) {
      const priority = match[1] as "P1" | "P2" | "P3" | undefined;
      const itemText = match[2] || line;
      items.push({ priority, text: itemText });
    } else if (line.startsWith("-") || line.startsWith("*")) {
      items.push({ text: line.replace(/^[-*]\s*/, "") });
    } else {
      items.push({ text: line });
    }
  }

  return items;
}

export function ObservationRenderer(props: { text: string }) {
  const items = () => parseObservations(props.text);

  return (
    <div class="flex flex-col gap-1" data-component="observation-renderer">
      <For each={items()}>
        {(item) => (
          <div
            class={cn(
              "rounded-r-md border-l-2 px-3 py-1.5 text-xs",
              item.priority ? PRIORITY_STYLES[item.priority] : "border-l-border bg-muted/30",
            )}
            data-priority={item.priority ?? undefined}
          >
            <Show when={item.priority}>
              <span class="mr-1 font-medium">{item.priority}</span>
            </Show>
            {item.text}
          </div>
        )}
      </For>
    </div>
  );
}
```

**Step 3: Run test, commit**

Run: `npx vitest run src/components/chat-area/parts/__tests__/observation-renderer.test.tsx`

```bash
git add apps/desktop/src/components/chat-area/parts/observation-renderer.tsx apps/desktop/src/components/chat-area/parts/__tests__/observation-renderer.test.tsx
git commit -m "feat(desktop): ObservationRenderer with priority emoji parsing"
```

---

### Task 9: Register `om_marker` in part registry

**Files:**

- Modify: `apps/desktop/src/components/chat-area/parts/register-parts.ts`

**Step 1: Register the component**

```ts
import { registerPartComponent } from "./part-registry.ts";
import { OmMarkerPart } from "./om-marker-part.tsx";
import { TextPart } from "./text-part.tsx";
import { ThinkingPart } from "./thinking-part.tsx";
import { ToolPart } from "./tool-part.tsx";

let registered = false;

export function registerDefaultPartComponents(): void {
  if (registered) return;

  registerPartComponent("text", TextPart);
  registerPartComponent("thinking", ThinkingPart);
  registerPartComponent("tool_call", ToolPart);
  registerPartComponent("om_marker", OmMarkerPart);

  registered = true;
}
```

**Step 2: Run full desktop test suite**

Run: `npx vitest run`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/src/components/chat-area/parts/register-parts.ts
git commit -m "feat(desktop): register OmMarkerPart in part registry"
```

---

### Task 10: `OmProgressBars` component (sidebar)

**Files:**

- Create: `apps/desktop/src/components/layout/sidebar/om-progress-bars.tsx`
- Test: `apps/desktop/src/components/layout/sidebar/__tests__/om-progress-bars.test.tsx`

**Step 1: Write failing test**

```tsx
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { OmProgressBars } from "../om-progress-bars.tsx";

describe("OmProgressBars", () => {
  it("renders two progress bars with percentages", () => {
    const { container } = render(() => (
      <OmProgressBars
        messages={{ tokens: 18000, threshold: 30000 }}
        observations={{ tokens: 11000, threshold: 40000 }}
      />
    ));
    expect(container.textContent).toContain("60%"); // messages
    expect(container.textContent).toContain("28%"); // observations (rounded)
    expect(container.textContent).toContain("18k"); // messages tokens
    expect(container.textContent).toContain("11k"); // observations tokens
  });

  it("uses green color under 60%", () => {
    const { container } = render(() => (
      <OmProgressBars
        messages={{ tokens: 5000, threshold: 30000 }}
        observations={{ tokens: 1000, threshold: 40000 }}
      />
    ));
    const fills = container.querySelectorAll("[data-slot='bar-fill']");
    expect(fills[0].className).toContain("bg-success");
  });

  it("uses blue color at or above 60%", () => {
    const { container } = render(() => (
      <OmProgressBars
        messages={{ tokens: 25000, threshold: 30000 }}
        observations={{ tokens: 1000, threshold: 40000 }}
      />
    ));
    const fills = container.querySelectorAll("[data-slot='bar-fill']");
    expect(fills[0].className).toContain("bg-info");
  });
});
```

**Step 2: Implement `OmProgressBars`**

```tsx
import { type Component } from "solid-js";
import { cn } from "~/lib/utils/index.ts";

interface WindowData {
  tokens: number;
  threshold: number;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

function barColor(percentage: number): string {
  return percentage >= 60 ? "bg-info" : "bg-success";
}

function ProgressBar(props: { label: string; data: WindowData }) {
  const percentage = () =>
    Math.min(100, Math.round((props.data.tokens / props.data.threshold) * 100));

  return (
    <div class="flex-1">
      <div class="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{props.label}</span>
        <span class="tabular-nums">{percentage()}%</span>
      </div>
      <div class="relative h-4 overflow-hidden rounded bg-muted/50">
        <div
          class={cn("h-full rounded transition-all duration-300", barColor(percentage()))}
          style={{ width: `${percentage()}%` }}
          data-slot="bar-fill"
        />
        <span class="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-foreground/70">
          {formatTokens(props.data.tokens)} / {formatTokens(props.data.threshold)}
        </span>
      </div>
    </div>
  );
}

export function OmProgressBars(props: { messages: WindowData; observations: WindowData }) {
  return (
    <div class="flex gap-3" data-component="om-progress-bars">
      <ProgressBar label="Messages" data={props.messages} />
      <ProgressBar label="Observations" data={props.observations} />
    </div>
  );
}
```

**Step 3: Run test, commit**

```bash
git add apps/desktop/src/components/layout/sidebar/om-progress-bars.tsx apps/desktop/src/components/layout/sidebar/__tests__/om-progress-bars.test.tsx
git commit -m "feat(desktop): OmProgressBars sidebar component with dual progress bars"
```

---

### Task 11: `MemorySidebarCard` + wire into layout

**Files:**

- Create: `apps/desktop/src/components/layout/sidebar/memory-sidebar-card.tsx`
- Modify: The left sidebar layout component (check `workspace-layout.tsx` or similar)
- Test: `apps/desktop/src/components/layout/sidebar/__tests__/memory-sidebar-card.test.tsx`

**Step 1: Write failing test**

```tsx
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { MemorySidebarCard } from "../memory-sidebar-card.tsx";

describe("MemorySidebarCard", () => {
  it("renders collapsed with thin bar when omStatus is set", () => {
    const { container } = render(() => (
      <MemorySidebarCard
        omStatus={{
          messages: { tokens: 18000, threshold: 30000 },
          observations: { tokens: 11000, threshold: 40000 },
        }}
      />
    ));
    expect(container.textContent).toContain("Memory");
    // Thin bar exists when collapsed
    expect(container.querySelector("[data-slot='thin-bar']")).toBeTruthy();
  });

  it("expands to show progress bars on click", () => {
    // ... test expand/collapse
  });

  it("shows disabled state when omStatus is null", () => {
    const { container } = render(() => <MemorySidebarCard omStatus={null} />);
    expect(container.textContent).toContain("Memory");
    expect(container.querySelector("[data-slot='thin-bar']")).toBeFalsy();
  });
});
```

**Step 2: Implement `MemorySidebarCard`**

Collapsible card with:

- Header: "Memory" + chevron toggle
- Collapsed: thin 1px progress bar (from `omStatus.messages`)
- Expanded: `OmProgressBars` component + config info

```tsx
import { createSignal, Show, type Component } from "solid-js";
import { TbOutlineChevronRight } from "solid-icons/tb";
import { FiEye } from "solid-icons/fi";
import { cn } from "~/lib/utils/index.ts";
import type { OmWindowState } from "~/stores/types.ts";
import { OmProgressBars } from "./om-progress-bars.tsx";

function thinBarColor(percentage: number): string {
  if (percentage >= 85) return "bg-warning";
  if (percentage >= 60) return "bg-info";
  return "bg-success";
}

export function MemorySidebarCard(props: { omStatus: OmWindowState | null }) {
  const [expanded, setExpanded] = createSignal(false);
  const messagePercent = () =>
    props.omStatus
      ? Math.min(
          100,
          Math.round((props.omStatus.messages.tokens / props.omStatus.messages.threshold) * 100),
        )
      : 0;

  return (
    <div class="border-border/50 border-b" data-component="memory-sidebar-card">
      <button
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30"
        onClick={() => setExpanded(!expanded())}
      >
        <TbOutlineChevronRight
          class={cn("h-3 w-3 transition-transform", expanded() && "rotate-90")}
        />
        <FiEye class="h-3.5 w-3.5" />
        <span class="flex-1 font-medium">Memory</span>
        <Show when={props.omStatus}>
          <span class="tabular-nums text-muted-foreground/70">{messagePercent()}%</span>
        </Show>
      </button>

      {/* Thin bar when collapsed */}
      <Show when={!expanded() && props.omStatus}>
        <div class="h-1 w-full overflow-hidden bg-muted/30" data-slot="thin-bar">
          <div
            class={cn("h-full transition-all duration-300", thinBarColor(messagePercent()))}
            style={{ width: `${messagePercent()}%` }}
          />
        </div>
      </Show>

      {/* Expanded content */}
      <Show when={expanded() && props.omStatus}>
        <div class="px-3 pb-3">
          <OmProgressBars
            messages={props.omStatus!.messages}
            observations={props.omStatus!.observations}
          />
        </div>
      </Show>
    </div>
  );
}
```

**Step 3: Wire into the sidebar layout**

Find the left sidebar in the desktop layout (likely in `workspace-layout.tsx` or a sidebar component). Add `<MemorySidebarCard omStatus={session.store.omStatus} />` in the sidebar.

Read `workspace-layout.tsx` to find the exact insertion point.

**Step 4: Run test, commit**

```bash
git add apps/desktop/src/components/layout/sidebar/memory-sidebar-card.tsx apps/desktop/src/components/layout/sidebar/__tests__/memory-sidebar-card.test.tsx apps/desktop/src/components/layout/workspace-layout.tsx
git commit -m "feat(desktop): MemorySidebarCard with collapsible progress bars in sidebar"
```

---

## Phase 4: Integration + Polish

### Task 12: Full integration verification

**Step 1: Run `vp check`**

Run: `vp check --fix`
Expected: 0 warnings, 0 errors

**Step 2: Run full test suite**

Run: `vp run -r test`
Expected: All tests pass

**Step 3: Verify no `return await this.maybeBuffer` regression**

Run: `rg -n "return await this\.maybeBuffer" packages/agent/src/observational-memory/engine.ts`
Expected: No matches (exit code 1)

**Step 4: Manual smoke test (if possible)**

Start the desktop app (`vp run desktop#dev`), send a message that triggers observation (enough tokens), verify:

- Badge appears inline in chat
- Progress bars update in sidebar
- Badge expands to show observations
- Badge survives reload

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(observational-memory): OM WS/UI integration — badges, progress bars, observation renderer"
```

---

## Key Reference Files

- Design doc: `docs/plans/2026-07-02-om-ws-ui-integration-design.md`
- Sakti engine: `packages/agent/src/observational-memory/engine.ts`
- Sakti agent-run: `packages/agent/src/runner/agent-run.ts`
- Sakti event types: `packages/agent/src/types.ts`
- Sakti event reducer: `apps/desktop/src/stores/session/event-reducer.ts`
- Sakti message types: `apps/desktop/src/stores/types.ts`
- Sakti session store: `apps/desktop/src/stores/session/session-store.ts`
- Sakti hydration: `apps/desktop/src/stores/session/hydrate-messages.ts`
- Sakti part registry: `apps/desktop/src/components/chat-area/parts/register-parts.ts`
- Mastra badge: `openspec/references/mastra/packages/playground/src/lib/ai-ui/tools/badges/observation-marker-badge.tsx`
- Mastra progress bars: `openspec/references/mastra/packages/playground/src/domains/agents/components/memory-sidebar/agent-observational-memory.tsx`
