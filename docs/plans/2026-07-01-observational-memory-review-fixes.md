# Observational Memory Processor — Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Prerequisite:** The OM processor (Phases A–E) is implemented and `vp check` / `vp run -r test` are green. This plan fixes the issues found in the post-implementation deep-dive review. It does **not** re-scope the feature — every fix maps to a review finding.

**Goal:** Make the observational-memory processor actually correct at runtime: the observer must avoid duplicates, the engine must see the current run's messages, the first model call must benefit from prior observations, failures must be logged, and the four test files the original plan required must exist and assert the real data flow.

**Architecture:** Surgical fixes to the existing module — no new packages, no new deps. Two critical correctness bugs (C1, C2) are fixed first and pinned with the tests that should have caught them. The plan-regression fixes (I1–I4) and minor cleanup (M1–M7) follow. Each task is TDD: failing test → minimal fix → green → commit.

**Tech Stack:** TypeScript, `effect`, `vitest` via `vite-plus/test`, `typebox` (already a dep via `profiles-store`). `exactOptionalPropertyTypes: true`.

---

## Scope decisions (decided upfront — do not re-litigate during execution)

1. **C2 fix removes `leafId` from `ObservationalMemoryDeps`.** The engine reads the current leaf via `sessionStorage.getLeafId()` on each `loadUnobservedMessages` call. This is a breaking change to the deps shape but only two call sites construct it (`apps/server/src/agent/runner.ts`, the test helper). Keeping a stale `leafId` field is the bug; an "initial hint" would still mislead.
2. **M1 is doc-only + dead-code trim, not a true background detach.** Renaming `setBufferingObservationFlag`/`updateBufferedObservations` would churn the DB adapter (out of scope). Actually detaching with `Effect.runFork` changes failure/lifecycle semantics and is its own plan. We document that "buffered" = incremental chunking within the turn and remove the genuinely-dead op-tracking only if a step verifies it's unreachable.
3. **I3 (missing test files) is folded into Tasks 1–3**, not done separately. Each fix lands with the test file the original plan required for that layer. Task 4 adds the one cross-cutting test (`loop-integration.test.ts`) that was also missing.
4. **No new public exports.** Fixes are internal. The `index.ts` re-export list stays as-is unless a step explicitly says otherwise.
5. **OM stays best-effort.** Every fix preserves "OM failure never aborts a run."

## Review issues → task map

| Finding | Severity | Task | File(s) |
| ------- | -------- | ---- | ------- |
| C1 — observer drops `existingObservations` | Critical | 1 | `observer.ts`, `prompts.ts` |
| C2 — engine freezes `leafId`; run messages invisible | Critical | 2 | `engine.ts`, `config.ts`, `runner.ts` |
| I3 — missing `observer.test.ts` / `engine.test.ts` | Important | 1, 2 | `__tests__/` |
| I1 — no first-turn `<observations>` injection | Important | 3 | `agent-loop.ts` |
| I3 — missing `loop-integration.test.ts` | Important | 4 | `__tests__/` |
| I2 — `logError` is a no-op | Important | 5 | `config.ts`, `engine.ts`, deps builder |
| I4 — `settings.json` OM schema not added | Important | 6 | `observational-memory-deps.ts` |
| M1 — "async" buffering misnamed / dead op-tracking | Minor | 7 | `buffering-coordinator.ts`, `engine.ts` |
| M2 — `extractObservedMessageIds` stub | Minor | 8 | `engine.ts` |
| M3 — error-handling asymmetry / dead catch | Minor | 9 | `engine.ts` |
| M4 — `getBaseSystemPrompt` latent gotcha | Minor | 10 | `agent-run.ts` |
| M5/M6/M7 — token-counter model context, type narrow, overhead floor | Minor | 11 | `token-counter.ts`, deps builder, `profile-resolver.ts` |

## Verified anchors

| Concern | File:line |
| ------- | --------- |
| Observer destructure that drops `existingObservations` | `packages/agent/src/observational-memory/observer.ts:45` |
| `buildObserverHistoryMessage` hardcoded task prompt | `packages/agent/src/observational-memory/prompts.ts:540` |
| `buildObserverTaskPrompt(existingObservations)` works | `packages/agent/src/observational-memory/prompts.ts:384-412` (test at `prompts.test.ts:59`) |
| Engine frozen `leafId` field + usage | `packages/agent/src/observational-memory/engine.ts:46,56,88` |
| `ObservationalMemoryDeps.leafId` decl | `packages/agent/src/observational-memory/config.ts:52` |
| Runner leaf capture (before user msg append) | `apps/server/src/agent/runner.ts:561,571` |
| `getPathToRoot` walks ancestors only | `packages/agent/src/session/storage.ts:179-207` |
| `getLeafId` returns current leaf | `packages/agent/src/session/storage.ts:145-154` |
| `logError` no-op | `packages/agent/src/observational-memory/engine.ts:518-521` |
| Loop OM hook (post-turn only) | `packages/agent/src/core/agent-loop.ts:385-409` |
| Loop `firstTurn` branch (inject point for I1) | `packages/agent/src/core/agent-loop.ts:289-291` |
| `getBaseSystemPrompt` reads harness, not context | `packages/agent/src/runner/agent-run.ts:104-107` |
| Settings store is freeform `Record<string,unknown>` | `apps/server/src/lib/settings-file-store.ts:4` |
| Manual `typeof` OM cast | `apps/server/src/agent/observational-memory-deps.ts:22-42` |
| `Logger` type export | `@sakti-code/logger` (`export type { Logger }`) |
| typebox usage pattern | `apps/server/src/lib/profiles-store.ts:7-41` |
| Existing loop test harness to mirror | `packages/agent/src/core/__tests__/agent-loop.test.ts` |
| Existing buffering test fakes | `packages/agent/src/observational-memory/__tests__/buffering.test.ts:78-441` |

---

## Phase 1 — Critical correctness

### Task 1: Observer passes `existingObservations` (C1) + `observer.test.ts` (I3)

**Files:**
- Modify: `packages/agent/src/observational-memory/observer.ts:44-81`
- Modify: `packages/agent/src/observational-memory/prompts.ts:530-542`
- Create: `packages/agent/src/observational-memory/__tests__/observer.test.ts`

**Step 1: Write the failing test.** Create `observer.test.ts`. Mock `@sakti-code/llm` `complete` exactly like `buffering.test.ts:23-29`. Assert the user message passed to `complete` contains the prior observations when `existingObservations` is set, and that they are absent when it is omitted. Capture the call via `vi.mocked(complete).mock.calls`.

```ts
import { complete } from "@sakti-code/llm";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ObservationalMemoryDeps } from "../config.ts";
import { TokenCounter } from "../token-counter.ts";
import { runObserver, ObservationError } from "../observer.ts";
// ... faux model + mock setup mirroring buffering.test.ts lines 23-76

it("includes existing observations in the observer prompt", async () => {
  vi.mocked(complete).mockResolvedValue(
    completeTextResult("<observations>\n* 🔴 New obs\n</observations>"),
  );
  await runObserver({
    messagesToObserve: [{ role: "user", content: "hi", timestamp: 1 }],
    existingObservations: "* 🔴 (10:00) User likes tea",
    deps,
  });
  const call = vi.mocked(complete).mock.calls[0]![0];
  const userMsg = (call.messages as { content: string }[])[0]!;
  expect(userMsg.content).toContain("Previous Observations");
  expect(userMsg.content).toContain("User likes tea");
});

it("omits Previous Observations block when none provided", async () => {
  vi.mocked(complete).mockResolvedValue(completeTextResult("<observations>x</observations>"));
  await runObserver({
    messagesToObserve: [{ role: "user", content: "hi", timestamp: 1 }],
    existingObservations: "",
    deps,
  });
  const userMsg = (vi.mocked(complete).mock.calls[0]![0].messages as { content: string }[])[0]!;
  expect(userMsg.content).not.toContain("Previous Observations");
});

it("throws ObservationError on finishReason error", async () => {
  vi.mocked(complete).mockResolvedValue(completeErrorResult("boom"));
  await expect(
    runObserver({ messagesToObserve: [], existingObservations: "", deps }),
  ).rejects.toBeInstanceOf(ObservationError);
});
```

**Step 2: Run — verify fail.** `vp run '@sakti-code/agent#test'` → the first test fails (`userMsg.content` does not contain "Previous Observations").

**Step 3: Fix `prompts.ts:530-542`** — accept `existingObservations`:

```ts
export function buildObserverHistoryMessage(
  messages: AgentMessage[],
  existingObservations?: string,
): { role: "user"; content: string } {
  const formatted = messages
    .map((msg) => formatAgentMessageForObserver(msg))
    .filter(Boolean)
    .join("\n\n");
  return {
    role: "user",
    content: `## New Message History to Observe\n\n${formatted}\n\n---\n\n${buildObserverTaskPrompt(existingObservations)}`,
  };
}
```

**Step 4: Fix `observer.ts:44-62`** — thread `existingObservations` through:

```ts
export async function runObserver(input: ObserverInput): Promise<ObserverResult> {
  const { messagesToObserve, existingObservations, deps, abortSignal } = input;
  const system = buildObserverSystemPrompt(deps.instruction);
  const historyMessage = buildObserverHistoryMessage(messagesToObserve, existingObservations);
  const messages = [
    { role: "user" as const, content: historyMessage.content, timestamp: Date.now() },
  ];
  // ... rest unchanged
}
```

**Step 5: Run — verify pass.** `vp run '@sakti-code/agent#test'` → green.

**Step 6: Commit.** `fix(agent): pass existing observations into observer prompt`

---

### Task 2: Engine refreshes leaf per turn (C2) + `engine.test.ts` (I3)

**Files:**
- Modify: `packages/agent/src/observational-memory/engine.ts:46,56,87-101`
- Modify: `packages/agent/src/observational-memory/config.ts:52` (remove `leafId`)
- Modify: `apps/server/src/agent/runner.ts:561,565-573` (drop capture)
- Modify: `packages/agent/src/observational-memory/__tests__/buffering.test.ts:438` (drop `leafId` from `createDeps`)
- Create: `packages/agent/src/observational-memory/__tests__/engine.test.ts`

**Step 1: Write the failing test.** The `FakeSessionStorage` in `buffering.test.ts:400-402` returns all entries regardless of leaf — that is why C2 slipped through. The new `engine.test.ts` must use a fake that **honors the tree walk** (parent-chain traversal) so appending a child after engine construction is visible. Build a minimal tree-honoring fake inline:

```ts
// In engine.test.ts — a FakeSessionStorage that actually walks parentId.
class TreeSessionStorage {
  private entries = new Map<string, SessionTreeEntry>();
  private leafId: string | null = null;
  appendEntry = (e: SessionTreeEntry) => Effect.sync(() => { this.entries.set(e.id, e); this.leafId = e.id; });
  getLeafId = () => Effect.succeed(this.leafId);
  getPathToRoot = (leafId: string | null) => Effect.gen(function* () {
    if (!leafId) return [] as SessionTreeEntry[];
    const path: SessionTreeEntry[] = [];
    let cur = this.entries.get(leafId);
    while (cur) { path.unshift(cur); cur = cur.parentId ? this.entries.get(cur.parentId) : undefined; }
    return path;
  });
  // ... other methods returning Effect.succeed/Effect.void
}

it("sees messages appended AFTER engine construction (leaf refresh)", async () => {
  const storage = new FakeObservationalMemoryStorage(); // reuse from buffering.test or inline
  const session = new TreeSessionStorage();
  // seed one prior message
  session.appendEntrySync(msgEntry({ role: "user", content: "old", timestamp: 1 }));
  const deps = createDeps(storage, session); // thresholds: observation 100
  const engine = new ObservationalMemoryEngine({ deps });
  const record = await engine.getOrCreateRecord();

  // Append a NEW child message AFTER the engine exists (simulates a run turn).
  session.appendEntrySync(msgEntry({ role: "user", content: "x".repeat(200), timestamp: 2 }));

  const unobserved = await engine.loadUnobservedMessages(record);
  expect(unobserved.some((m) => m.role === "user" && m.content.startsWith("x"))).toBe(true);
});
```

Add a `appendEntrySync` helper on the test fake (pushes into the map and advances leaf). Also assert the sync-observe path fires on the new message (stub `complete` to return an `<observations>` block; assert `storage.updateActiveObservations` was called).

**Step 2: Run — verify fail.** `loadUnobservedMessages` returns `[]` for the appended child (engine used frozen `this.leafId`, which points at the prior leaf, so `getPathToRoot` excludes the child).

**Step 3: Remove `leafId` from `config.ts:52`.**

**Step 4: Fix `engine.ts`** — drop the `leafId` field (`:46,56`) and read it dynamically in `loadUnobservedMessages` (`:87-101`):

```ts
async loadUnobservedMessages(record: ObservationalMemoryRecord): Promise<AgentMessage[]> {
  const leafId = await Effect.runPromise(this.sessionStorage.getLeafId());
  const pathEntries = await Effect.runPromise(this.sessionStorage.getPathToRoot(leafId));
  const messageEntries = pathEntries.filter((entry) => entry.type === "message");
  // ... rest unchanged
}
```

**Step 5: Update call sites.**
- `apps/server/src/agent/runner.ts:561` — delete `const leafId = yield* storage.getLeafId();` and remove `leafId,` from the deps object (`:571`).
- `buffering.test.ts:438` — remove `leafId: null,` from `createDeps`.

**Step 6: Run — verify pass.** `vp run '@sakti-code/agent#test'` → green, including the new `engine.test.ts`.

**Step 7: Commit.** `fix(agent): refresh observational-memory leaf each turn so the current run is observable`

---

## Phase 2 — Plan regressions

### Task 3: First-turn `<observations>` injection (I1)

**Files:**
- Modify: `packages/agent/src/core/agent-loop.ts:289-291` (the `if (firstTurn)` branch)
- Modify: `packages/agent/src/observational-memory/__tests__/loop-integration.test.ts` (created in Task 4 — write the assertion there now, implement the fix here)

> Order note: Task 4 creates the loop-integration test file. To keep TDD honest, **write the first-turn-injection test case in Task 4 Step 1 first**, watch it fail, then come back here to implement. The two tasks are paired.

**Step 1 (after Task 4 Step 1): implement.** In `agent-loop.ts`, inside the `if (firstTurn)` block, before `firstTurn = false`, inject prior observations into `currentContext.systemPrompt` (no observe/reflect — cheap read-only):

```ts
if (firstTurn) {
  if (config.observationalMemory) {
    const om = config.observationalMemory;
    const injected = yield* Effect.tryPromise({
      try: async () => {
        const record = await om.engine.getOrCreateRecord();
        const observations = om.engine.buildContextSystemMessage(record);
        return observations ? `${om.getBaseSystemPrompt()}\n\n${observations}` : undefined;
      },
      catch: (error: unknown) => {
        config.logger?.error("om initial inject failed", error, { sessionId: config.sessionId });
        return undefined;
      },
    });
    if (injected !== undefined) {
      currentContext = { ...currentContext, systemPrompt: injected };
    }
  }
  firstTurn = false;
} else {
  yield* emitEffect(emit, { type: "turn_start" });
}
```

**Step 2: Run — verify pass.** The Task 4 first-turn test goes green; the existing 31 loop tests stay green (OM absent → unchanged path).

**Step 3: Commit.** `feat(agent): inject observations into the first turn's system prompt`

---

### Task 4: `loop-integration.test.ts` (I3) — drives Task 3 + covers the per-turn hook

**Files:**
- Create: `packages/agent/src/observational-memory/__tests__/loop-integration.test.ts`

**Step 1: Write the failing tests.** Mirror the minimal loop-config setup in `packages/agent/src/core/__tests__/agent-loop.test.ts`. Use a **fake engine** that records calls and returns canned observations — do not hit `complete`:

```ts
const fakeEngine = {
  getOrCreateRecord: vi.fn(async () => ({ activeObservations: "* 🔴 prior", id: "r1" })),
  maybeObserve: vi.fn(async (r) => { (r as any).observed = true; return r; }),
  maybeReflect: vi.fn(async (r) => r),
  buildContextSystemMessage: vi.fn(() => "<observations>* 🔴 prior</observations>"),
};
const getBaseSystemPrompt = vi.fn(() => "BASE");

it("first model call's system prompt contains <observations>", async () => {
  // drive ONE turn with a stubbed streamAssistantResponse that records context.systemPrompt
  // assert the recorded system prompt includes "<observations>" and "BASE"
});

it("after a turn, maybeObserve ran and next turn reflects new observations", async () => {
  // fakeEngine.maybeObserve resolves, buildContextSystemMessage returns updated text on 2nd call
  // drive TWO turns, assert maybeObserve called and turn-2 prompt has the new observations
});

it("without observationalMemory config, the loop is byte-for-byte unchanged", async () => {
  // same driver, no OM — assert fakeEngine never called and prompt == "BASE"
});
```

**Step 2: Run — verify fail.** First test fails because first-turn injection isn't implemented yet (Task 3).

**Step 3: Implement Task 3 (go there).** Then run — all three pass.

**Step 4: Commit (together with Task 3's code change).** If committing the test separately first (red), use `test(agent): add observational-memory loop-integration tests (red)` then Task 3's commit carries the green. Either is fine — pick one and be consistent.

---

### Task 5: Real logging through deps (I2)

**Files:**
- Modify: `packages/agent/src/observational-memory/config.ts` (add `logger?`)
- Modify: `packages/agent/src/observational-memory/engine.ts:47-66,518-521`
- Modify: `apps/server/src/agent/observational-memory-deps.ts` (pass `ctx.log?.agent`)
- Modify: `packages/agent/src/observational-memory/__tests__/buffering.test.ts:426-441` (optional `logger` in `createDeps`)

**Step 1: Write the failing test** in `engine.test.ts` (created in Task 2): pass a spy logger, force `runObserver`/`runReflector` to throw (mock `complete` to reject), call `maybeObserve`, assert `logger.warn` was called with the phase and stringified error. Force the error by making the fake storage's `getPathToRoot` reject, or by mocking `complete` to throw.

**Step 2: Run — verify fail.** `logError` is a no-op → `logger.warn` never called.

**Step 3: Add `logger` to deps** (`config.ts`):

```ts
import type { Logger } from "@sakti-code/logger";
// ...
export interface ObservationalMemoryDeps {
  // ... existing fields ...
  readonly logger?: Logger | undefined;
}
```

**Step 4: Wire into `engine.ts`** — store `this.logger = options.deps.logger` and replace the no-op:

```ts
private logError(phase: string, error: unknown): void {
  this.logger?.warn("observational-memory failure (best-effort)", {
    phase,
    error: error instanceof Error ? error.message : String(error),
  });
}
```

**Step 5: Pass from server.** In `observational-memory-deps.ts:155-170`, add `...(ctx.log?.agent === undefined ? {} : { logger: ctx.log.agent })` to the returned object.

**Step 6: Run — verify pass.** `vp run '@sakti-code/agent#test'` + `vp run '@sakti-code/server#test'`.

**Step 7: Commit.** `feat(agent): log observational-memory failures through injected logger`

---

### Task 6: `settings.json` OM schema (I4)

**Files:**
- Create: `apps/server/src/lib/observational-memory-settings.ts`
- Modify: `apps/server/src/agent/observational-memory-deps.ts:22-66` (use the schema)
- Create: `apps/server/src/lib/__tests__/observational-memory-settings.test.ts`

**Step 1: Write the failing test.**

```ts
it("rejects a typo'd threshold key", () => {
  expect(() => parseOmSettings({ observationalMemory: { enabled: true, obserationThreshold: 100 } }))
    .toThrow();
});
it("rejects a non-number observationThreshold", () => {
  expect(() => parseOmSettings({ observationalMemory: { enabled: true, observationThreshold: "30000" } }))
    .toThrow();
});
it("accepts a minimal enabled-only config", () => {
  expect(parseOmSettings({ observationalMemory: { enabled: true } })?.enabled).toBe(true);
});
it("returns undefined when disabled or absent", () => {
  expect(parseOmSettings({ observationalMemory: { enabled: false } })).toBeUndefined();
  expect(parseOmSettings({})).toBeUndefined();
});
```

**Step 2: Run — verify fail** (module/function doesn't exist).

**Step 3: Implement `observational-memory-settings.ts`** using the typebox pattern from `profiles-store.ts:7-41`:

```ts
import Type from "typebox";
import { Value } from "typebox/value";

const OmBufferingSchema = Type.Object({
  observationBufferTokens: Type.Number(),
  observationBufferActivation: Type.Optional(Type.Number()),
  reflectionBufferActivation: Type.Optional(Type.Number()),
});

export const OmSettingsSchema = Type.Object({
  enabled: Type.Boolean(),
  observationThreshold: Type.Optional(Type.Number()),
  reflectionThreshold: Type.Optional(Type.Number()),
  instruction: Type.Optional(Type.String()),
  buffering: Type.Optional(OmBufferingSchema),
});

export interface ParsedOmSettings {
  enabled: boolean;
  observationThreshold?: number;
  reflectionThreshold?: number;
  instruction?: string;
  buffering?: { observationBufferTokens: number; observationBufferActivation?: number; reflectionBufferActivation?: number };
}

export function parseOmSettings(raw: Record<string, unknown>): ParsedOmSettings | undefined {
  const om = raw.observationalMemory;
  if (!om || typeof om !== "object") return undefined;
  Value.Assert(OmSettingsSchema, om);
  const decoded = Value.Decode(OmSettingsSchema, om);
  if (!decoded.enabled) return undefined;
  return decoded;
}
```

**Step 4: Refactor `observational-memory-deps.ts`.** Replace `readOmSettings` + `readBufferingSettings` (`:22-66`) with two calls into `parseOmSettings` (one for the OM block, reusing the parsed `buffering`). Keep the `resolveOmConfig` return shape identical so `runner.ts` is untouched.

**Step 5: Run — verify pass.** `vp run '@sakti-code/server#test'`.

**Step 6: Commit.** `feat(server): validate observational-memory settings with typebox`

---

## Phase 3 — Minor cleanup

### Task 7: Buffering terminology honesty (M1)

**Files:**
- Modify: `packages/agent/src/observational-memory/buffering-coordinator.ts:64-96` (doc comment)
- Modify: `packages/agent/src/observational-memory/engine.ts:194-389` (doc comments on `maybeBufferObservation` / `maybeBufferReflection`)

**Step 1: Verify the op-tracking is reachable or dead.** `rg -n "isAsyncBufferingInProgress|setAsyncOp|asyncBufferingOps" packages/agent/src/observational-memory/`. Confirm `shouldTriggerAsyncObservation`/`shouldTriggerAsyncReflection` consult it for re-entry guarding.

**Step 2: Decision.**
- If reachable (re-entry guard for the inline-awaited path): **keep it**, add a doc comment on `BufferingCoordinator` (`:64-71`) clarifying "buffered = incremental chunking within the awaited turn; the in-flight Promise is a re-entry guard, not a background task. True background detach is deferred."
- If a map is written but never read after Step 1: remove that map and its setters/getters. Do not rename the storage API.

**Step 3: No test change** (doc/refactor-only). Run `vp run '@sakti-code/agent#test'` to confirm no regression.

**Step 4: Commit.** `docs(agent): clarify observational-memory buffering is incremental, not backgrounded`

---

### Task 8: Real `extractObservedMessageIds` (M2)

**Files:**
- Modify: `packages/agent/src/observational-memory/engine.ts:479-516`

**Step 1: Write the failing test** in `engine.test.ts`: after a sync observe over known messages, assert `storage.updateActiveObservations` was called with `observedMessageIds` containing the message entry ids (not `[]`). Use the tree-honoring fake from Task 2 and spy on `updateActiveObservations`.

**Step 2: Run — verify fail** (current stub returns `[]`).

**Step 3: Implement.** The engine already calls `getPathToRoot`; to map `AgentMessage` → entry id, thread the entries (not just the built messages) through `loadUnobservedMessages`. Cleanest: change `runSyncObserve`/`maybeBufferObservation` to compute ids from the `MessageEntry[]` they already loaded, before `buildSessionContextFromEntries` collapses them:

```ts
private extractObservedMessageIds(entries: SessionTreeEntry[]): string[] {
  return entries.filter((e) => e.type === "message").map((e) => e.id);
}
```

Adjust `loadUnobservedMessages` to also return the filtered entries (or add a paired `loadUnobservedMessageEntries`), and have the two observe call sites pass those entries in.

**Step 4: Run — verify pass.**

**Step 5: Commit.** `fix(agent): populate observedMessageIds safeguard during observe`

---

### Task 9: Error-handling symmetry (M3)

**Files:**
- Modify: `packages/agent/src/observational-memory/engine.ts:108-147,154-192,427-477`

**Step 1: Decide the invariant.** Recommendation: **inner methods (`runSyncObserve`, `runSyncReflect`) do NOT catch** — they let errors propagate; the public `maybeObserve`/`maybeReflect` are the single best-effort boundary (log + return original record). This removes the dead outer catch and makes the two paths symmetric.

**Step 2: Refactor.** Remove the `try/catch` from `runSyncReflect` (`:471-476`); keep its `finally` for `setReflectingFlag(false)`. Leave `runSyncObserve` as-is (already doesn't catch). Confirm `maybeObserve`/`maybeReflect` outer try/catch now actually catches both.

**Step 3: Add a test** in `engine.test.ts`: force `runReflector` to throw (mock `complete` to reject); call `maybeReflect`; assert it returns the original record **and** `logger.warn` was called (covers Task 5 wiring too) **and** `setReflectingFlag(id, false)` was still invoked (finally ran).

**Step 4: Run — verify pass.**

**Step 5: Commit.** `refactor(agent): single best-effort error boundary in OM maybeObserve/maybeReflect`

---

### Task 10: `getBaseSystemPrompt` gotcha comment (M4)

**Files:**
- Modify: `packages/agent/src/runner/agent-run.ts:99-109`

**Step 1.** Add a doc comment on `getBaseSystemPrompt` explaining: it deliberately reads `harness.getSystemPrompt()` (the stable composed base) rather than `currentContext.systemPrompt`, so observations don't accumulate across turns; the trade-off is that any `prepareNextTurn` edit to the system prompt is overwritten when OM is on (no such editor exists today).

**Step 2.** No test (doc-only). `vp run '@sakti-code/agent#test'` to confirm no regression.

**Step 3: Commit.** `docs(agent): document getBaseSystemPrompt base-source trade-off`

---

### Task 11: Token-counter polish (M5, M6, M7)

**Files:**
- Modify: `packages/agent/src/observational-memory/token-counter.ts:530-533,594-601,664`
- Modify: `apps/server/src/agent/observational-memory-deps.ts:83-88,158-165`
- Modify: `apps/server/src/lib/profile-resolver.ts:6` (`ResolvedModelRef.thinkingLevel`)

**M7 — overhead floor.** In `token-counter.ts:598`, the per-toolCall `overhead -= 12` can drive `overhead` negative for assistant turns with many parallel tool calls. Floor the final result:

```ts
// countMessage, end:
return Math.max(0, Math.round(payloadTokens + overhead));
```

**M5 — model context.** In `observational-memory-deps.ts:83-88`, construct the TokenCounter with the observe model so image estimation uses the right provider table:

```ts
function getTokenCounter(observeModel: Model): TokenCounter {
  return new TokenCounterImpl({ model: { provider: observeModel.provider, modelId: observeModel.id } });
}
```

Drop the module singleton (or key the cache by `provider/modelId`). Pass per-run, not per-server — correctness > the micro-savings.

**M6 — thinkingLevel type.** In `profile-resolver.ts:3-7`, narrow `ResolvedModelRef.thinkingLevel: string` → `ThinkingLevel | "off"`, and return `ref.thinkingLevel ?? "off"` already satisfies it. Then in `observational-memory-deps.ts:158-165` drop the `as ThinkingLevel` casts.

**Step 1: Tests.**
- M7: add to `token-counter.test.ts` — an assistant message with 10 tool calls returns `>= 0`.
- M5: add to `observational-memory-deps.test.ts` — TokenCounter is constructed with the observe model's provider (spy on `new TokenCounterImpl` or assert via a `runWithModelContext`-observable effect). If hard to assert, assert the constructed config shape via a thin factory seam.
- M6: add to `profile-resolver.test.ts` — `resolveModelRef(...).thinkingLevel` is assignable to `ThinkingLevel | "off"` (compile-time; a `satisfies` test is enough).

**Step 2–4: implement each, run, commit.** Suggested split commits:

```
fix(agent): floor token-counter message overhead at zero
feat(server): construct OM token counter with the observe model context
refactor(server): narrow ResolvedModelRef.thinkingLevel to ThinkingLevel|'off'
```

---

## Phase 4 — Finalize

### Task 12: Full verify (definition of done)

**Step 1.** `vp run -r test` — all packages green.
**Step 2.** `vp check` — format + lint + typecheck clean.
**Step 3.** Confirm the four previously-missing test files now exist and assert real data flow (not just mocks):
   ```
   packages/agent/src/observational-memory/__tests__/observer.test.ts
   packages/agent/src/observational-memory/__tests__/engine.test.ts
   packages/agent/src/observational-memory/__tests__/loop-integration.test.ts
   packages/agent/src/observational-memory/__tests__/reflector.test.ts   ← if not created above, add a minimal one covering escalation + cap (mirror Task 1's structure)
   ```
   If `reflector.test.ts` is still absent after Task 11, add it here (escalation retry until `MAX_COMPRESSION_LEVEL`, cap returns whatever it has, `ReflectionError` on `finishReason:"error"`).
**Step 4.** Re-confirm vestigial storage methods still have no production callers: `rg -n "insertObservationalMemoryRecord|setObservingFlag" packages/ apps/ --glob '!**/__tests__/**'` → only the interface + DB adapter.
**Step 5.** Manual dogfood (optional but recommended): enable OM in `settings.json`, run a session past the observation threshold in the desktop app, confirm (a) `<observations>` appears in the **first** turn's system prompt via the dev toolbar, (b) the observer does not duplicate prior observations, (c) the `getObservationalMemory` record grows within the same run.
**Step 6.** Commit any `vp check --fix` reformats: `style(agent): format observational-memory review fixes`.

---

## Explicitly OUT of scope (do not do in this plan)

- **True background-detached buffering** (fire-and-forget `Effect.runFork` for `maybeBufferObservation`/`maybeBufferReflection`). Task 7 documents the gap; actual detach is its own plan.
- **Renaming the `setBufferingObservationFlag` / `updateBufferedObservations` / `swapBufferedToActive` storage API.** Would churn the DB adapter and the verified storage contract.
- **WS/UI visibility** for OM activity (unchanged from the original plan's deferral).
- **`resource:{projectId}` scope** (unchanged deferral).
- **Vector retrieval / recall tool** (unchanged deferral).

## Definition of done

- C1 fixed: observer prompt receives `existingObservations`; `observer.test.ts` pins it.
- C2 fixed: `leafId` removed from `ObservationalMemoryDeps`; engine reads `sessionStorage.getLeafId()` each turn; `engine.test.ts` uses a tree-honoring fake and would have caught the bug.
- I1 fixed: the first model call's system prompt includes `<observations>`; `loop-integration.test.ts` pins it.
- I2 fixed: `logError` routes through an injected `Logger`; failure test asserts a `warn` was emitted.
- I4 fixed: OM settings validated via typebox; typos/bad types throw.
- M1–M7 addressed per their tasks.
- All four originally-required test files exist and assert the real data flow (not fakes that bypass it).
- `vp run -r test` and `vp check` green; OM still never aborts a run.
