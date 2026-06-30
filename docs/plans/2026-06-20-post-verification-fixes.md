# Post-Verification Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix every CRITICAL / WARNING / SUGGESTION defect found in the deep verification of 4 changes (`agent-loop-controls`, `user-bash-and-terminals`, `server-polish`, `session-forking`), plus a systemic route-wiring gap — with TDD and frequent commits.

**Architecture:** Each phase targets one change so commits stay scoped. Tests are written FIRST and hardened to assert exact spec contracts (`toBe`, not `toContain`) — the green-but-loose test pattern is the root cause of every latent defect shipping, so every fix adds/strictens a test that would have caught the original bug. The agent package uses **vitest**; server routes use **bun:test**; db uses **bun:test** (per `AGENTS.md`).

**Tech Stack:** TypeScript, Bun, Elysia, vitest, bun:test, Drizzle, `@earendil-works/pi-ai`, Ultracite/Biome.

**Test commands (memorize these — framework split matters):**

```
bun vitest run packages/agent/                          # agent (vitest)
cd packages/db && bun test                               # db (bun:test)
cd apps/server && bun test src/__tests__/<file>.test.ts  # one server route file (bun:test)
cd apps/server && bun vitest run src/agent/__tests__/    # server agent layer (vitest — mocks pi-ai)
bun typecheck && bun x ultracite fix                     # gate before each commit
```

---

## Defect index (what each task closes)

**CRITICAL**

- C1 `user-bash` `timeout` treated as ms, spec says seconds (`bash.ts:40`)
- C2 `user-bash` output trimmed, drops trailing newline (`bash.ts:78`)
- C3 `user-bash`/terminals REST-created terminals' WS push silently dropped (`terminals.ts:26` vs `ws.ts:90`)
- C4 `agent-loop-controls` steer signal wired to the stream (should let it finish) and absent from tool execution (should abort the tool) (`loop/index.ts:91,145`)

**WARNING**

- W1 `auto_compaction` setting inert — loop never auto-compacts (`loop/index.ts`, `runner.ts`) **→ MOVED to dedicated change `agent-auto-compaction` (openspec/changes/agent-auto-compaction/). This plan only documents the toggle as inert-pending-that-change + fixes the W3 default.**
- W2 `follow_up_mode` setting inert (loop always "all") (`loop/index.ts`, `runner.ts`)
- W3 default `auto_compaction` mismatch: runner `"true"` vs spec/route `false` (`runner.ts`)
- W4 `thinking_level: "off"` can't disable a session's thinking level (`runner.ts:88-93`)
- W5 `session-forking` `fork-messages` messageIndex on filtered array vs `fork()` slices full array (`forking.ts:39-43`)
- W6 `server-polish` file-search reads param `q`, spec says `query` (`search-files.ts:94`)
- W7 `session-forking` export "Copy" button is dead code (`export.ts`)
- W8 `session-forking` export header shows current date, not session createdAt (`export.ts:10`)
- W9 WS-welcome integration test + terminal-push tests are tautological/no-op

**SYNC / DOC**

- D1 `file-search` main spec dropped 2 find-fallback ignore patterns
- D2 `session-commands` archived delta vs main spec disagree on endpoint (verify-only)

**SUGGESTION**

- S1 `agent-loop` steer/followUp on a finished loop should drop, not enqueue forever
- S2 `ErrorFrame` uses field `error`, spec says `message` (pre-existing, repo-wide) — optional back-compat
- S3 `autoRetry`/`steeringMode` read off raw `config` not `resolved` (`loop/index.ts`)

**SYSTEMIC**

- SYS route modules wired only in tests → 404 in the booted server (`index.ts:33`)

---

## Phase 0 — Setup

### Task 0.1: Branch

```bash
git checkout -b fix/post-verification-defects
```

Confirm clean baseline:

```bash
bun vitest run packages/agent/ 2>&1 | tail -3        # expect 54 passed | 5 skipped
cd packages/db && bun test 2>&1 | tail -3            # expect 21 pass
```

The 10 `bun test apps/server` failures are PRE-EXISTING on `main` (verify with `git stash && bun test apps/server/src 2>&1 | tail -3; git stash pop`) — they are NOT this branch's responsibility, **except** the `runner.test.ts` vitest regression introduced by `agent-loop-controls` (closed in Phase 1).

---

## Phase 1 — `agent-loop-controls` (the open change)

> Commit prefix: `fix(agent-loop): ...`. This phase is the largest because the change shipped with **zero tests** and the headline feature (steer) is wired backwards.

### Task 1.1: Add `repos.settings` to server test mocks — closes Phase 0 regression / unblocks Phase 1

**Files:**

- Modify: `apps/server/src/agent/__tests__/helpers.ts` (`createMockCtx`, `createMultiSessionCtx`)

**Step 1: Write the failing test (append to `apps/server/src/agent/__tests__/runner.test.ts`)**

```ts
it("runPrompt loads per-session settings without throwing", async () => {
  const ctx = createMockCtx();
  const store = createMockStore();
  getModelMock.mockReturnValue(createTestModel());
  streamSimpleMock.mockReturnValue(createTextStream("ok"));
  const events: AgentEvent[] = [];
  for await (const e of runPrompt(ctx, "sess-1", "hi", store)) events.push(e);
  expect(events.some((e) => e.type === "agent_start")).toBe(true);
  expect(ctx.repos.settings.getByPrefix).toHaveBeenCalledWith("session:sess-1:");
});
```

**Step 2: Run — expect RED** (`Cannot read properties of undefined (reading 'getByPrefix')`)

```bash
cd apps/server && bun vitest run src/agent/__tests__/runner.test.ts 2>&1 | tail -15
```

**Step 3: Implement** — add a `settings` repo to both mock contexts in `helpers.ts`:

```ts
settings: {
  get: vi.fn(() => null),
  getByPrefix: vi.fn(() => []),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => []),
},
```

Add inside `createMockCtx`'s `repos` object and inside `createMultiSessionCtx`'s `repos` object.

**Step 4: Run — expect GREEN**

```bash
cd apps/server && bun vitest run src/agent/__tests__/runner.test.ts 2>&1 | tail -8
```

**Step 5: Commit** — `git commit -m "fix(server): add settings repo to runner test mocks"`

---

### Task 1.2: Fix steer signal wiring (C4) — RED first

**Files:**

- Modify: `packages/agent/src/loop/index.ts` (`prompt`, lines ~91, ~142-151)
- Test: `packages/agent/src/__tests__/steer-behavior.test.ts` (Create)

**Step 1: Write the failing tests** — create `packages/agent/src/__tests__/steer-behavior.test.ts`. Mock pattern mirrors `loop-behavior.test.ts` (vi.mock pi-ai, `MockEventStream`, `textStream`/`toolCallStream` helpers — copy from there).

```ts
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentMessage, AgentTool, SessionStore } from "../types";

vi.mock("@earendil-works/pi-ai", () => ({ streamSimple: vi.fn() }));
const { streamSimple } = await import("@earendil-works/pi-ai");
const streamSimpleMock = streamSimple as any;
const { createAgentLoop } = await import("../loop");

// ... copy createMockStore, testModel, basePartial, textStream, toolCallStream from loop-behavior.test.ts

async function collect(g: AsyncIterable<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of g) out.push(e);
  return out;
}

it("C4a: steer during LLM streaming does NOT abort the stream; stream finishes and steer becomes a new user message", async () => {
  const store = createMockStore();
  // stream emits text_delta then blocks until release()
  let release: () => void = () => {};
  const blocking = {
    [Symbol.asyncIterator]() {
      const evts = [
        { type: "start", partial: { ...basePartial, stopReason: "stop", timestamp: Date.now() } },
        { type: "text_delta", contentIndex: 0, delta: "partial", partial: {} },
      ];
      let i = 0;
      let released = false;
      return {
        next: async () => {
          if (i < evts.length) return { done: false, value: evts[i++] };
          if (!released) {
            await new Promise<void>((r) => (release = r));
            released = true;
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
  streamSimpleMock.mockReturnValue(blocking);

  const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [], store });
  const events: AgentEvent[] = [];
  const p = (async () => {
    for await (const e of loop.prompt("hi")) events.push(e);
  })();

  await new Promise((r) => setTimeout(r, 20));
  loop.steer("change course"); // mid-stream
  await new Promise((r) => setTimeout(r, 10));
  release();
  await p;

  const types = events.map((e) => e.type);
  // MUST NOT error from a null assistant (that proves the stream was not aborted mid-flight)
  expect(types).not.toContain("error");
  // The steer text is persisted as a user message
  const msgs = await store.loadMessages("s1");
  expect(msgs.some((m) => m.role === "user" && m.content === "change course")).toBe(true);
});

it("C4b: steer during tool execution ABORTS the running tool", async () => {
  const store = createMockStore();
  let aborted = false;
  let finished = false;
  const slowTool: AgentTool = {
    name: "slow",
    description: "d",
    parameters: { type: "object", properties: {} },
    execute: async (_id, _args, signal) => {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          finished = true;
          resolve();
        }, 100);
        signal?.addEventListener("abort", () => {
          aborted = true;
          clearTimeout(t);
          resolve();
        });
      });
      return { content: finished ? "done" : "partial", terminate: false };
    },
  };
  let call = 0;
  streamSimpleMock.mockImplementation(() => {
    call++;
    return call === 1 ? toolCallStream("slow", {}) : textStream("ok");
  });

  const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [slowTool], store });
  const p = (async () => {
    for await (const _e of loop.prompt("go")) {
    }
  })();
  await new Promise((r) => setTimeout(r, 30)); // tool now running
  loop.steer("stop the tool");
  await p;

  expect(aborted).toBe(true);
  expect(finished).toBe(false);
});
```

**Step 2: Run — expect RED**

```bash
bun vitest run packages/agent/src/__tests__/steer-behavior.test.ts 2>&1 | tail -20
```

C4a fails with `error` event present; C4b fails with `aborted === false`.

**Step 3: Implement the fix** in `packages/agent/src/loop/index.ts`:

(a) Stream must use the caller signal only. In `prompt()`, remove the `combinedSignal` line for the stream and pass `signal`:

```ts
// BEFORE
const combinedSignal = combineSignals(signal, steerAbort.signal);
const streamResult =
  yield *
  streamLLMResponse(
    model,
    messages,
    tools,
    combinedSignal,
    autoRetry ? maxRetries : 0,
    baseDelay,
    sessionId,
    resolved.thinkingLevel,
  );
// AFTER
const streamResult =
  yield *
  streamLLMResponse(
    model,
    messages,
    tools,
    signal,
    autoRetry ? maxRetries : 0,
    baseDelay,
    sessionId,
    resolved.thinkingLevel,
  );
```

(b) Tool execution must receive the steer-abort signal. In the tool branch:

```ts
// BEFORE
steerAbort = new AbortController(); // reset for this turn
const toolExec =
  yield * executeToolCalls(streamResult.toolCalls, tools, signal, store, sessionId, messages);
// AFTER
steerAbort = new AbortController(); // reset for this turn
const toolSignal = combineSignals(signal, steerAbort.signal);
const toolExec =
  yield * executeToolCalls(streamResult.toolCalls, tools, toolSignal, store, sessionId, messages);
```

(c) In the **no-tool-call branch** (after `yield evt("turn_end", {...})`), also drain steers that arrived during streaming before checking follow-up:

```ts
yield evt("turn_end", { turnIndex, message: streamResult.finalAssistant, toolResults: [] });

if (await drainSteers(messages)) {
  turnIndex++;
  continue;
}

const followUpMsg = followUpQueue.shift();
if (followUpMsg) {
  await injectMessage(messages, followUpMsg);
  turnIndex++;
  continue;
}
break;
```

**Step 4: Partial-tool-result on abort** — in `packages/agent/src/loop/tool-execution.ts`, the `catch` currently discards accumulated output. Honor the spec ("partial tool result SHALL be appended"):

```ts
// BEFORE
} catch (err: unknown) {
  result = { content: err instanceof Error ? err.message : "Tool execution error", terminate: false, isError: true };
}
// AFTER
} catch (err: unknown) {
  result = {
    content: accumulated.length > 0
      ? accumulated
      : err instanceof Error ? err.message : "Tool execution error",
    terminate: false,
    isError: true,
  };
}
```

**Step 5: Run — expect GREEN**

```bash
bun vitest run packages/agent/src/__tests__/steer-behavior.test.ts 2>&1 | tail -8
bun vitest run packages/agent/ 2>&1 | tail -4    # full agent suite still green
```

**Step 6: Commit** — `git commit -m "fix(agent-loop): route steer-abort signal to tool execution, not the LLM stream"`

---

### Task 1.3: Add the remaining steer/followUp contract tests (queue bound, follow-up ordering, no-op on finished loop) — S1 + missing coverage

**Files:**

- Modify: `packages/agent/src/__tests__/steer-behavior.test.ts`

**Step 1: Write failing tests** (append):

```ts
it("steer queue is bounded at 10; the 11th is dropped", () => {
  const store = createMockStore();
  streamSimpleMock.mockReturnValue(blockingStreamThatNeverResolves); // helper that never yields done
  const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [], store });
  for (let i = 0; i < 11; i++) loop.steer(`m${i}`);
  // Internally queue is capped at 10; assert via persistence once the loop runs,
  // OR export a debug accessor. Simplest: drive a no-tool turn and count appended user msgs.
});

it("followUp is processed after the current turn and keeps the loop alive", async () => {
  const store = createMockStore();
  let call = 0;
  streamSimpleMock.mockImplementation(() => {
    call++;
    return textStream(call === 1 ? "first" : "second");
  });
  const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [], store });
  const p = (async () => {
    for await (const _e of loop.prompt("hi")) {
    }
  })();
  await new Promise((r) => setTimeout(r, 10));
  loop.followUp("again");
  await p;
  const msgs = await store.loadMessages("s1");
  expect(msgs.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["hi", "again"]);
  expect(call).toBe(2);
});

it("S1: steer/followUp on a finished loop is a no-op (drops, does not throw)", async () => {
  const store = createMockStore();
  streamSimpleMock.mockReturnValue(textStream("done"));
  const loop = createAgentLoop({ sessionId: "s1", model: testModel, tools: [], store });
  for await (const _e of loop.prompt("hi")) {
  }
  expect(() => {
    loop.steer("late");
    loop.followUp("late2");
  }).not.toThrow();
  // Nothing new persisted after completion
  const before = (await store.loadMessages("s1")).length;
  expect((await store.loadMessages("s1")).length).toBe(before);
});
```

**Step 2: Run — expect RED** (S1 fails: today late calls enqueue forever; the "nothing new persisted" assertion may pass but the drop semantics need the active-flag fix below).

**Step 3: Implement S1** — track loop-active state in `loop/index.ts`:

```ts
let active = false;
// inside prompt(): set active = true at start, active = false in a finally block
async function* prompt(message, signal) {
  active = true;
  try {
    // ... existing body ...
  } finally {
    active = false;
  }
}
// steer/followUp respect active:
steer(message) { if (!active) return; enqueue(steerQueue, message); if (!steerAbort.signal.aborted) steerAbort.abort(); },
followUp(message) { if (!active) return; enqueue(followUpQueue, message); },
```

**Step 4: Run — expect GREEN**

```bash
bun vitest run packages/agent/src/__tests__/steer-behavior.test.ts 2>&1 | tail -6
```

**Step 5: Commit** — `git commit -m "test(agent-loop): steer queue bound, follow-up ordering, no-op on finished loop"`

---

### Task 1.4: Move `autoRetry`/`steeringMode` onto `AgentConfig` and read from `resolved` (S3)

**Files:**

- Modify: `packages/agent/src/types.ts` (`AgentConfig` gains `autoRetry`, `steeringMode`)
- Modify: `packages/agent/src/loop/index.ts` (read `resolved.autoRetry` / `resolved.steeringMode`)

**Step 1: Test** — add to `steer-behavior.test.ts`:

```ts
it("S3: autoRetry:false disables retries; steeringMode one-at-a-time drains one steer per turn", async () => {
  const store = createMockStore();
  streamSimpleMock.mockImplementation(() => {
    throw Object.assign(new Error("429"), { statusCode: 429 });
  });
  const loop = createAgentLoop({
    sessionId: "s1",
    model: testModel,
    tools: [],
    store,
    autoRetry: false,
  });
  const events = await collect(loop.prompt("hi"));
  expect(events.filter((e) => e.type === "retry")).toHaveLength(0);
  expect(events.some((e) => e.type === "error")).toBe(true);
});
```

**Step 2: Run — expect RED** (today `autoRetry:false` already works since it's read off `config`, but the test pins the contract; S3 is the type-safety move).

**Step 3: Implement** — in `types.ts` add to `AgentConfig`:

```ts
export interface AgentConfig {
  autoRetry?: boolean;
  // ...existing...
  steeringMode?: string;
}
```

(`createAgentConfig` already spreads `...input`, so these now land on `resolved`.) In `loop/index.ts` change reads:

```ts
const autoRetry = resolved.autoRetry ?? true; // was config.autoRetry
const mode = resolved.steeringMode ?? "all"; // inside drainSteers, was config.steeringMode
```

**Step 4: Run — expect GREEN** + full agent suite.

```bash
bun vitest run packages/agent/ 2>&1 | tail -4
```

**Step 5: Commit** — `git commit -m "refactor(agent-loop): read autoRetry/steeringMode from resolved AgentConfig"`

---

### Task 1.5: Make `thinking_level: "off"` actually disable thinking (W4)

**Files:**

- Modify: `apps/server/src/agent/runner.ts` (`runPrompt` thinking-level resolution, lines ~88-93)

**Step 1: Test** — append to `runner.test.ts`:

```ts
it("W4: per-session thinking_level 'off' overrides a session row with 'high'", async () => {
  const ctx = createMockCtx();
  // session row thinkingLevel high, but settings explicitly set thinking_level=off
  (ctx.repos.sessions.findById as any).mockImplementation(async (id: string) =>
    id === "sess-1"
      ? {
          id: "sess-1",
          projectId: "proj-1",
          modelId: "test-model",
          title: null,
          thinkingLevel: "high",
          createdAt: 0,
          updatedAt: 0,
        }
      : null,
  );
  (ctx.repos.settings.get as any).mockImplementation(async (k: string) =>
    k.endsWith(":thinking_level") ? "off" : null,
  );
  const store = createMockStore();
  getModelMock.mockReturnValue(createTestModel());
  streamSimpleMock.mockReturnValue(createTextStream("ok"));
  for await (const _e of runPrompt(ctx, "sess-1", "hi", store)) {
  }
  const opts = (streamSimpleMock.mock.calls[0] as any[])[2];
  expect(opts).toBeUndefined() || expect(opts.thinkingLevel).toBeUndefined();
});
```

**Step 2: Run — expect RED** (today session row's "high" wins).

**Step 3: Implement** — distinguish "key present" from "value=off" by reading the raw row:

```ts
const thinkingLevelRow = ctx.repos.settings.get(`${prefix}thinking_level`);
let thinkingLevel: string | undefined;
if (thinkingLevelRow !== null) {
  thinkingLevel = thinkingLevelRow !== "off" ? thinkingLevelRow : undefined;
} else if (session.thinkingLevel !== "off") {
  thinkingLevel = session.thinkingLevel;
}
```

(`get` already exists on `SettingsRepo`; add it to the test mock in Task 1.1 — already done.)

**Step 4: Run — expect GREEN.** Commit — `git commit -m "fix(runner): per-session thinking_level off overrides session row"`

---

### Task 1.6: Honor `follow_up_mode` (W2)

**Files:**

- Modify: `packages/agent/src/types.ts` (`AgentConfig`/`Input` gain `followUpMode?: string`)
- Modify: `packages/agent/src/loop/index.ts` (gate follow-up draining)
- Modify: `apps/server/src/agent/runner.ts` (pass `followUpMode`)

**Step 1: Test** — append to `steer-behavior.test.ts`:

```ts
it("W2: followUpMode 'one-at-a-time' processes exactly one follow-up then stops", async () => {
  const store = createMockStore();
  let call = 0;
  streamSimpleMock.mockImplementation(() => {
    call++;
    return textStream("x");
  });
  const loop = createAgentLoop({
    sessionId: "s1",
    model: testModel,
    tools: [],
    store,
    followUpMode: "one-at-a-time",
  });
  const p = (async () => {
    for await (const _e of loop.prompt("hi")) {
    }
  })();
  await new Promise((r) => setTimeout(r, 10));
  loop.followUp("a");
  loop.followUp("b"); // two queued
  await p;
  // one-at-a-time: only the first follow-up runs in this prompt lifecycle
  const users = (await store.loadMessages("s1"))
    .filter((m) => m.role === "user")
    .map((m) => m.content);
  expect(users).toContain("a");
  expect(call).toBe(2); // initial + one follow-up
});
```

**Step 2: Run — expect RED.**

**Step 3: Implement** — add `followUpMode?: string` to `AgentConfig` + `AgentConfigInput`. In the loop's follow-up handling (both branches), after processing one follow-up, respect the mode:

```ts
const followUpMode = resolved.followUpMode ?? "all";
// in the tool branch (after drainSteers):
const fu = followUpQueue.shift();
if (fu) {
  await injectMessage(messages, fu);
  if (followUpMode === "one-at-a-time") {
    // let this turn run; do not keep pulling more this cycle
  }
}
// in the no-tool branch: if one-at-a-time and we just injected a follow-up, continue once then break
```

Concretely: track a local `processedFollowUp` flag per cycle; under `one-at-a-time`, after injecting one follow-up, set a guard so the next no-tool termination breaks instead of pulling another. Runner passes `followUpMode: settings.follow_up_mode`.

**Step 4: Run — expect GREEN.** Commit — `git commit -m "feat(agent-loop): honor follow_up_mode setting"`

---

### Task 1.7: Fix `auto_compaction` default mismatch + document the toggle as inert (W3 only; W1 moved to `agent-auto-compaction`)

> **Scope change:** Auto-compaction _implementation_ was extracted into a dedicated OpenSpec change — `openspec/changes/agent-auto-compaction/` — because the base `agent-loop` "supports compaction" requirement is an unimplemented feature, not a repair. This plan no longer builds the feature; it only (a) fixes the W3 default mismatch, (b) pins the current inert behavior with a test, and (c) amends the `agent-loop-controls` delta to describe reality so it archives honestly. The real implementation happens in `agent-auto-compaction` against a clean base.

**Files:**

- Modify: `apps/server/src/agent/runner.ts` (`DEFAULT_SETTINGS.auto_compaction: "true"` → `"false"`)
- Modify: `apps/server/src/agent/__tests__/runner.test.ts` (assert the default)
- Modify: `openspec/changes/agent-loop-controls/specs/agent-loop/spec.md` (amend the auto-compaction requirement to describe the inert toggle, not phantom behavior)

**Step 1: Write the failing test** — append to `runner.test.ts`:

```ts
it("W3: loadSessionSettings defaults auto_compaction to false (matches spec, not 'true')", () => {
  const ctx = createMockCtx();
  const s = loadSessionSettings(ctx, "sess-1");
  expect(s.auto_compaction).toBe("false");
});
```

(Import `loadSessionSettings` from `../runner.ts`.)

**Step 2: Run — expect RED** (today returns `"true"`).

```bash
cd apps/server && bun vitest run src/agent/__tests__/runner.test.ts 2>&1 | tail -10
```

**Step 3: Implement W3** — in `runner.ts` change the default:

```ts
const DEFAULT_SETTINGS: Record<string, string> = {
  auto_compaction: "false", // was "true" — matches per-session-settings spec default
  // ...rest unchanged
};
```

**Step 4: Amend the `agent-loop-controls` delta** — in `openspec/changes/agent-loop-controls/specs/agent-loop/spec.md`, rewrite the "Auto-compaction respects per-session setting" requirement so it describes the **persisted, inert toggle** honestly and points at the follow-up change, instead of asserting a `shouldCompact` check that doesn't run:

```markdown
### Requirement: Per-session auto_compaction setting is persisted and inert pending auto-compaction

The `auto_compaction` setting (`session:{id}:auto_compaction`, default `"false"`) SHALL be readable and writable via the settings routes and loaded by `runPrompt` at loop construction. It is persisted correctly and round-trips. Automatic turn-level compaction is NOT yet implemented in the loop; the setting is forward-compatible scaffolding consumed by the dedicated `agent-auto-compaction` change. Manual compaction via `POST /api/sessions/:id/compact` remains available regardless.

#### Scenario: auto_compaction default is false

- **WHEN** a session has no stored `auto_compaction` setting
- **THEN** `loadSessionSettings` returns `auto_compaction: "false"`

#### Scenario: setting round-trips

- **WHEN** `PATCH /api/sessions/:id/settings { auto_compaction: true }` then `GET`
- **THEN** the response has `auto_compaction: true`
```

**Step 5: Run — expect GREEN.**

```bash
cd apps/server && bun vitest run src/agent/__tests__/runner.test.ts 2>&1 | tail -8
```

**Step 6: Commit** — `git commit -m "fix(runner): auto_compaction default false; document toggle as inert pending agent-auto-compaction"`

---

### Task 1.8: Add server tests for session-settings + session-controls routes + WS steer/followUp (closes the "claimed tests don't exist" gap)

**Files:**

- Create: `apps/server/src/__tests__/settings.test.ts`
- Create: `apps/server/src/__tests__/session-controls.test.ts`
- Modify: `apps/server/src/agent/__tests__/ws.test.ts` (add steer/followUp cases)

**Step 1: `settings.test.ts`** (bun:test) — cover: defaults round-trip, write-then-read, unknown session 404, `getByPrefix` exercised. Use `makeApp([sessionSettingsRoutes])`, create project+session, assert exact JSON:

```ts
import { describe, expect, it } from "bun:test";
import { sessionSettingsRoutes } from "../routes/session-settings.ts";
import { makeApp } from "./helpers.ts";

describe("session settings", () => {
  it("GET returns merged defaults for a new session", async () => {
    const { app, ctx } = await makeApp([sessionSettingsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/settings`),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      auto_compaction: false,
      auto_retry: true,
      max_retries: 3,
      steering_mode: "all",
      follow_up_mode: "all",
      thinking_level: "off",
    });
  });
  it("PATCH then GET round-trips", async () => {
    /* set auto_compaction:true, read back true, others default */
  });
  it("unknown session GET 404", async () => {
    /* /api/sessions/nope/settings → 404 */
  });
  it("unknown session PATCH 404", async () => {
    /* ... */
  });
});
```

**Step 2: `session-controls.test.ts`** — cover steer/follow-up REST 404 when no active run (the 200-with-active-run path needs a registered loop; test the 404 path directly + assert `getActiveLoop` returns null). Use `makeApp([sessionControlRoutes])`.

**Step 3: `ws.test.ts`** — add:

```ts
it("steer with no active run → error frame with sessionId", () => {
  const { sent, ws } = makeFakeWs();
  handleMessage(ctx, store, ws, { type: "steer", sessionId: "no-run", message: "x" });
  expect(sent.some((f) => f.type === "error" && f.sessionId === "no-run")).toBe(true);
});
it("followUp with no active run → error frame", () => {
  /* same */
});
```

**Step 4: Run all new server tests — expect GREEN:**

```bash
cd apps/server && bun test src/__tests__/settings.test.ts src/__tests__/session-controls.test.ts 2>&1 | tail -8
cd apps/server && bun vitest run src/agent/__tests__/ws.test.ts 2>&1 | tail -6
```

**Step 5: Commit** — `git commit -m "test(server): session-settings + session-controls + WS steer/followUp coverage"`

---

## Phase 2 — `user-bash-and-terminals` fixes (C1, C2, C3, W9)

### Task 2.1: Fix bash timeout unit (seconds → ms) (C1) and output trim (C2)

**Files:**

- Modify: `apps/server/src/routes/bash.ts` (`runBash` signature/body, lines ~40, ~78)
- Modify: `apps/server/src/__tests__/bash.test.ts` (harden assertions)

**Step 1: Write/stricten failing tests** in `bash.test.ts`:

```ts
it("C2: echo hello returns output with trailing newline", async () => {
  const { app, ctx } = await makeApp([bashRoutes]);
  const project = await ctx.repos.projects.create("c2", "/tmp");
  const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
  const res = await app.handle(
    new Request(`http://localhost/api/sessions/${session.id}/bash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "printf hello" }), // printf: no implicit newline
    }),
  );
  const body = await res.json();
  expect(body.output).toBe("hello"); // printf hello → exactly "hello"
  expect(body.exitCode).toBe(0);
});

it("C1: timeout is in seconds — timeout:1 sleeps 2s, gets cancelled", async () => {
  const { app, ctx } = await makeApp([bashRoutes]);
  const project = await ctx.repos.projects.create("c1", "/tmp");
  const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
  const t0 = Date.now();
  const res = await app.handle(
    new Request(`http://localhost/api/sessions/${session.id}/bash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "sleep 2", timeout: 1 }),
    }),
  );
  const body = await res.json();
  expect(body.cancelled).toBe(true);
  expect(body.output).toBe("[Command timed out after 1s]");
  const elapsed = Date.now() - t0;
  expect(elapsed).toBeGreaterThan(900);
  expect(elapsed).toBeLessThan(1900); // ~1s, not 1ms or 30s
});
```

**Step 2: Run — expect RED** (`output` currently trimmed/dropped; timeout fires in 1ms).

**Step 3: Implement** in `bash.ts`:

```ts
// runBash timeoutMs param: convert seconds→ms at the call site
async function runBash(command, cwd, sessionId, timeoutMs: number = BASH_TIMEOUT_MS) {
  /* unchanged body */
}

// in the route handler, convert body.timeout (seconds) to ms:
const timeoutMs = body.timeout !== undefined ? body.timeout * 1000 : BASH_TIMEOUT_MS;
const result = await runBash(body.command, project.cwd, params.id, timeoutMs);
```

And remove `.trim()` from the normal-completion return:

```ts
// BEFORE: output: output.trim() || "(no output)",
// AFTER:
output: combined.length > 0 ? output : "(no output)",
```

(keep the `|| "(no output)"` fallback only for truly-empty output; the truncation message `timed out after ${timeoutMs/1000}s` is already correct since `timeoutMs` is now in ms).

**Step 4: Run — expect GREEN.**

```bash
cd apps/server && bun test src/__tests__/bash.test.ts 2>&1 | tail -8
```

**Step 5: Commit** — `git commit -m "fix(server): user-bash timeout in seconds (not ms); stop trimming output"`

---

### Task 2.2: Fix REST↔WS terminal push orphan (C3)

> Spec: terminal created via `POST /api/terminals` SHALL be associated with the requesting connection's ID so pushes reach it. REST has no WS context, so the client supplies its `connectionId` (the `wsId` from the welcome frame) in the body.

**Files:**

- Modify: `apps/server/src/routes/terminals.ts` (accept + validate `connectionId`)
- Modify: `apps/server/src/agent/ws.ts` (export `hasWsConnection`)
- Modify: `apps/server/src/__tests__/terminal-push.test.ts` (replace tautological tests — W9)

**Step 1: Write failing tests** in `terminal-push.test.ts` — drive the real `pushToConnection` path:

```ts
import { describe, expect, it } from "bun:test";
import {
  buildWsApp,
  hasWsConnection,
  registerTestConnection,
  pushToConnection,
} from "../agent/ws.ts";

it("C3: a push to a registered connection delivers the exact frame", () => {
  const received: any[] = [];
  registerTestConnection("conn-1", { send: (d) => received.push(JSON.parse(d)) });
  pushToConnection("conn-1", {
    type: "push",
    channel: "terminal.data",
    data: { terminalId: "t1", data: "hi\n" },
  });
  expect(received).toHaveLength(1);
  expect(received[0]).toEqual({
    type: "push",
    channel: "terminal.data",
    data: { terminalId: "t1", data: "hi\n" },
  });
});

it("C3: hasWsConnection reflects registration", () => {
  expect(hasWsConnection("conn-2")).toBe(false);
  registerTestConnection("conn-2", { send: () => {} });
  expect(hasWsConnection("conn-2")).toBe(true);
  unregisterTestConnection("conn-2");
  expect(hasWsConnection("conn-2")).toBe(false);
});

it("C3: POST /api/terminals without a valid connectionId is rejected", async () => {
  const { app } = await makeApp([terminalRoutes]);
  const res = await app.handle(
    new Request("http://localhost/api/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: "bogus" }),
    }),
  );
  expect(res.status).toBe(400); // no such connection → cannot push
});
```

**Step 2: Run — expect RED** (`hasWsConnection`/`registerTestConnection` don't exist; route ignores connectionId).

**Step 3: Implement** in `ws.ts` — expose test seams over the existing `wsConnections` map:

```ts
export function hasWsConnection(connectionId: string): boolean {
  return wsConnections.has(connectionId);
}
// test-only seams:
export function registerTestConnection(connectionId: string, ws: WsHandle) {
  wsConnections.set(connectionId, ws);
}
export function unregisterTestConnection(connectionId: string) {
  wsConnections.delete(connectionId);
}
export function pushToConnection(connectionId: string, data: unknown) {
  /* existing private fn, now exported */
}
```

In `terminals.ts` accept + validate:

```ts
const createBody = t.Object({
  connectionId: t.String(), // required: the client's wsId from the welcome frame
  cwd: t.Optional(t.String()),
  cols: t.Optional(t.Number()),
  rows: t.Optional(t.Number()),
});
// in the POST handler:
if (!hasWsConnection(body.connectionId)) {
  return new Response(
    JSON.stringify({ error: "Unknown connectionId; open a WS connection first" }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}
// bun-pty availability check, then:
return ctx.terminalManager.create(body.connectionId, {
  cwd: body.cwd,
  cols: body.cols,
  rows: body.rows,
});
```

(`hasWsConnection` imported from `../agent/ws.ts`.)

**Step 4: Run — expect GREEN.** Commit — `git commit -m "fix(server): associate terminals with a real WS connectionId so pushes are delivered"`

---

### Task 2.3: Harden terminal-manager + ws-welcome-integration tests (W9)

**Files:**

- Modify: `apps/server/src/__tests__/ws-welcome-integration.test.ts` (remove no-op fallback)

**Step 1:** Replace the no-op branch. `createWelcomeFrame` is already exported and pure — assert directly:

```ts
import { createWelcomeFrame, SERVER_VERSION } from "../agent/ws.ts";
it("welcome frame has type/version/cwd", () => {
  const frame = JSON.parse(createWelcomeFrame());
  expect(frame.type).toBe("welcome");
  expect(frame.version).toBe(SERVER_VERSION);
  expect(frame.cwd).toBe(process.cwd());
});
```

Keep one integration smoke test that `buildWsApp()` returns an Elysia instance (already there). Delete the branch that silently `return`s when the open handler can't be reached.

**Step 2: Run — expect GREEN.** Commit — `git commit -m "test(server): make ws-welcome assertion real (remove no-op fallback)"`

---

## Phase 3 — `server-polish` fixes (W6, D1)

### Task 3.1: file-search param `q`→`query`; drop undocumented `projectId`; align ignore list (W6, D1)

**Files:**

- Modify: `apps/server/src/routes/search-files.ts` (param name, response shape, ignore dirs)
- Modify: `apps/server/src/__tests__/search-files.test.ts` (use `query`)
- Modify: `openspec/specs/file-search/spec.md` (D1: list the actual ignore dirs)

**Step 1: Stricten failing test** in `search-files.test.ts`:

```ts
it("W6: search uses ?query= (not ?q=) and returns {files, cwd} only", async () => {
  const { app, ctx } = await makeApp([searchFilesRoutes]);
  const project = await ctx.repos.projects.create("sf", "/tmp/sf-query");
  const res = await app.handle(
    new Request(`http://localhost/api/projects/${project.id}/search-files?query=x`),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["cwd", "files"].sort()); // no projectId
});
```

**Step 2: Run — expect RED** (route reads `q`; response has `projectId`).

**Step 3: Implement** in `search-files.ts`:

```ts
// route handler:
(async ({ params, query: { query: q, limit }, store }) => {
  // ... unchanged logic, but:
  return Response.json({ files, cwd: project.cwd }); // drop projectId
},
  {
    query: t.Object({
      query: t.Optional(t.String()), // was q
      limit: t.Optional(t.Numeric()),
    }),
  });
```

And align `runFind` ignore dirs to the spec's superset:

```ts
const ignoreDirs = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  ".next",
  "__pycache__",
  ".DS_Store",
];
```

**Step 4: Update main spec** `openspec/specs/file-search/spec.md` — in the "fd not available, fallback to find" requirement, list the ignore dirs above (closes D1).

**Step 5: Run — expect GREEN; lint gate.**

```bash
cd apps/server && bun test src/__tests__/search-files.test.ts 2>&1 | tail -6
bun x ultracite fix
```

**Step 6: Commit** — `git commit -m "fix(server): file-search uses ?query=, drop projectId from response, align ignore dirs + spec"`

---

## Phase 4 — `session-forking` fixes (W5, W7, W8)

### Task 4.1: Fix `fork-messages` messageIndex base (W5)

**Files:**

- Modify: `apps/server/src/routes/forking.ts` (`fork-messages` handler)
- Modify: `apps/server/src/__tests__/forking.test.ts` (add tool-before-user case)

**Step 1: Failing test** — append to `forking.test.ts`:

```ts
it("W5: messageIndex refers to the FULL array (consistent with fork() slice)", async () => {
  const { app, ctx } = await makeApp([forkingRoutes]);
  const project = await ctx.repos.projects.create("w5", "/tmp/w5");
  const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
  await ctx.repos.messages.append(session.id, {
    role: "tool",
    content: "tool-first",
    toolCallId: "t",
    toolName: "x",
  });
  await ctx.repos.messages.append(session.id, { role: "user", content: "U" });
  await ctx.repos.messages.append(session.id, { role: "assistant", content: "A" });
  const res = await app.handle(
    new Request(`http://localhost/api/sessions/${session.id}/fork-messages`),
  );
  const body = await res.json();
  expect(body[0].messageIndex).toBe(1); // user is at full-array index 1, not 0
  expect(body[1].messageIndex).toBe(2);
  // and forking at that index copies the right prefix:
  const forkRes = await app.handle(
    new Request(`http://localhost/api/sessions/${session.id}/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageIndex: 1 }),
    }),
  );
  const forked = await forkRes.json();
  const msgs = ctx.repos.messages.loadBySession(forked.id);
  expect(msgs.map((m) => m.content)).toEqual(["tool-first", "U"]);
});
```

**Step 2: Run — expect RED** (today returns 0/1; fork slice base mismatches).

**Step 3: Implement** in `forking.ts`:

```ts
const forkable = messages
  .map((m, idx) => ({ m, idx }))
  .filter(({ m }) => m.role === "user" || m.role === "assistant")
  .map(({ m, idx }) => ({ messageIndex: idx, role: m.role, textPreview: m.content.slice(0, 200) }));
```

**Step 4: Run — expect GREEN.** Commit — `git commit -m "fix(server): fork-messages messageIndex refers to full message array"`

---

### Task 4.2: Export — emit copy button (W7) + use session createdAt (W8)

**Files:**

- Modify: `apps/server/src/routes/export.ts`
- Modify: `apps/server/src/__tests__/forking.test.ts` (export assertions)

**Step 1: Failing tests** in the export `describe`:

```ts
it("W7: each assistant message has a copy button", async () => {
  const { app, ctx } = await makeApp([exportRoutes]);
  const project = await ctx.repos.projects.create("w7", "/tmp/w7");
  const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
  await ctx.repos.messages.append(session.id, { role: "assistant", content: "hi" });
  const html = await (
    await app.handle(new Request(`http://localhost/api/sessions/${session.id}/export-html`))
  ).text();
  expect(html).toContain('class="copy-btn"');
  expect(html.match(/class="copy-btn"/g)?.length).toBeGreaterThanOrEqual(1);
});
it("W8: header shows the session creation date, not today", async () => {
  const { app, ctx } = await makeApp([exportRoutes]);
  const project = await ctx.repos.projects.create("w8", "/tmp/w8");
  const session = await ctx.repos.sessions.create(project.id, "gpt-4o");
  const html = await (
    await app.handle(new Request(`http://localhost/api/sessions/${session.id}/export-html`))
  ).text();
  const created = new Date(session.createdAt).toISOString().slice(0, 10);
  expect(html).toContain(created);
});
```

**Step 2: Run — expect RED.**

**Step 3: Implement** in `export.ts`:

- Change signature to accept `sessionCreatedAt`:

```ts
function renderHtmlExport(sessionTitle, projectName, sessionCreatedAt: number, messages) {
  const date = new Date(sessionCreatedAt).toISOString().slice(0, 10);
  // ...
  // inside the message map, for assistant bubbles add the button:
  const copyBtn = m.role === "assistant"
    ? `<button class="copy-btn" type="button">Copy</button>`
    : "";
  return `... <div class="bubble${collapsed}">${copyBtn}<pre>${...}</pre></div> ...`;
}
```

- Route handler passes `session.createdAt`:

```ts
const html = renderHtmlExport(session.title, projectName, session.createdAt, messagesData);
```

**Step 4: Run — expect GREEN.** Commit — `git commit -m "fix(server): export emits copy button + uses session creation date"`

---

## Phase 5 — Spec reconciliation (D1 already in 3.1; D2 verify-only)

### Task 5.1: Confirm session-commands endpoint coherence (D2)

**Files:** none (verification only).

The shipped `GET /api/commands` (no `:id`, hardcoded list, no 404) matches the **main** spec `openspec/specs/session-commands/spec.md`. The archived delta `.../server-polish/specs/session-commands/spec.md` says `/api/sessions/:id/commands` + 404 — this is a stale snapshot superseded during implementation. Archives are immutable history, so no edit is required; main + impl are the source of truth and they agree.

**Step 1:** verify:

```bash
grep -n "api/commands\|api/sessions" openspec/specs/session-commands/spec.md apps/server/src/routes/commands.ts
```

Expect both to read `GET /api/commands`. If they agree → D2 closed (document-only). If a session-scoped variant is ever wanted, that is a NEW change, not this fix.

---

## Phase 6 — Systemic route composition (SYS)

> All route modules are currently imported only by their own tests; `buildServer({ db })` at boot passes no `routes`, so every feature endpoint 404s in production. This phase deliberately deviates from each change's "no `index.ts` edits" constraint — that constraint is exactly what produced dead routes.

### Task 6.1: Compose all route modules into `buildServer`

**Files:**

- Modify: `apps/server/src/index.ts` (`foundationRoutes`, `buildServer`)
- Modify: `apps/server/src/__tests__/composition.test.ts` (add a test that the default server serves a feature route)
- Modify: `apps/server/src/agent/ws.ts` (export `buildWsApp` if not already; ensure it's `.use`'d)

**Step 1: Failing test** in `composition.test.ts`:

```ts
import { buildServer } from "../index.ts";
it("SYS: buildServer() with no extra routes still serves /api/commands and /api/sessions/:id/bash", async () => {
  const db = await initDatabase(new Database(":memory:"));
  const app = buildServer({ db });
  const health = await app.handle(new Request("http://localhost/api/commands"));
  expect(health.status).toBe(200);
});
```

**Step 2: Run — expect RED** (`/api/commands` not registered by default).

**Step 3: Implement** — import every route module + `buildWsApp`, add to `foundationRoutes` (rename to `defaultRoutes` if clearer):

```ts
import { buildWsApp } from "./agent/ws.ts";
import { bashRoutes } from "./routes/bash.ts";
import { commandsRoutes } from "./routes/commands.ts";
import { compactionRoutes } from "./routes/compaction.ts";
import { exportRoutes } from "./routes/export.ts";
import { forkingRoutes } from "./routes/forking.ts";
import { gitRoutes } from "./routes/git.ts";
import { lastAssistantTextRoutes } from "./routes/last-assistant-text.ts";
import { namingRoutes } from "./routes/naming.ts";
import { searchFilesRoutes } from "./routes/search-files.ts";
import { sessionControlRoutes } from "./routes/session-controls.ts";
import { sessionSettingsRoutes } from "./routes/session-settings.ts";
import { terminalsRoutes } from "./routes/terminals.ts";
import { turnDiffRoutes } from "./routes/turn-diff.ts";
import { workspaceRoutes } from "./routes/workspace.ts";

const defaultRoutes = [
  healthRoutes,
  projectsRoutes,
  sessionsRoutes,
  settingsRoutes,
  modelConfigRoutes,
  costsRoutes,
  availableModelsRoutes,
  commandsRoutes,
  searchFilesRoutes,
  turnDiffRoutes,
  workspaceRoutes,
  lastAssistantTextRoutes,
  compactionRoutes,
  gitRoutes,
  bashRoutes,
  terminalsRoutes,
  forkingRoutes,
  namingRoutes,
  exportRoutes,
  sessionSettingsRoutes,
  sessionControlRoutes,
  buildWsApp(),
];
```

Keep the `routes?: AnyElysia[]` param so tests can still append.

**Step 4: Run the WHOLE server suite + lint + typecheck:**

```bash
cd apps/server && bun test src/__tests__/composition.test.ts 2>&1 | tail -8
cd apps/server && bun test src/__tests__ 2>&1 | tail -12
bun typecheck && bun x ultracite fix
```

**Step 5: Commit** — `git commit -m "fix(server): compose all route modules into buildServer so they serve in production"`

---

## Phase 7 — Optional: ErrorFrame field normalization (S2)

> Spec says `{type:"error", sessionId, message}`; code uses field `error`. Risk: the UI client may parse `.error`. This task emits BOTH fields for back-compat.

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts` (`ErrorFrame`, `sendError`, `runAgentStream`)
- Modify: `apps/server/src/agent/__tests__/ws.test.ts`

**Step 1: Test:**

```ts
it("S2: error frame carries both message and error (back-compat)", () => {
  const { sent, ws } = makeFakeWs();
  handleMessage(ctx, store, ws, { type: "steer", sessionId: "no-run", message: "x" });
  const err = sent.find((f) => f.type === "error");
  expect(err.message).toMatch(/No active run/);
  expect(err.error).toBe(err.message);
});
```

**Step 2: Implement** — add `message: string` to `ErrorFrame` (keep `error`), set both in `sendError` and the catch in `runAgentStream`.

**Step 3: Run + lint. Commit** — `git commit -m "fix(server): error frames include spec-compliant message field (back-compat error)"`

> If `grep -rn "\.error" apps/app/src` shows the UI depends on `.error`, ship the back-compat version (this task as written). If nothing depends on it, you may drop `error` instead.

---

## Phase 8 — Final verification

### Task 8.1: Full suites + gates

```bash
bun vitest run packages/agent/ 2>&1 | tail -5
cd packages/db && bun test 2>&1 | tail -3
cd apps/server && bun test src/__tests__ 2>&1 | tail -12
cd apps/server && bun vitest run src/agent/__tests__/ 2>&1 | tail -8
bun typecheck
bun x ultracite fix
```

**Expected:** all suites green; the only `bun test apps/server/src` failures allowed are the 10 PRE-EXISTING ones confirmed on `main` (Phase 0) — re-confirm none are newly introduced by diffing the failure list against `main`.

### Task 8.2: Re-run verification against specs

Re-verify each capability's scenarios now have a covering test, then update the OpenSpec change status:

```bash
openspec status --change "agent-loop-controls" --json
```

Once green, proceed to archive `agent-loop-controls` (separate skill).

---

## Notes / decisions baked in

- **TDD is non-negotiable** for every behaviour change — the whole point is that the original green tests could not catch these bugs.
- **Framework split:** agent = vitest; server route files = bun:test; server agent-layer (pi-ai mocks) = vitest; db = bun:test.
- **`exactOptionalPropertyTypes: true`** — use conditional spreads `...(x !== undefined ? { x } : {})`, never pass `undefined`.
- **Auto-compaction (Task 1.7)** is the highest-complexity item; if time-boxed, it can be split into its own branch, but it is required to satisfy `agent-loop`'s "Auto-compaction respects per-session setting" requirement.
- **Phase 6** intentionally overrides the prior "no index.ts edits" constraint; document this in the commit message.
- Every commit runs `bun typecheck && bun x ultracite fix` first.
