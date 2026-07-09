# Plan-Session Observational Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let plan sessions run their own thread-scope Observational Memory (observe/reflect) during planning, so long planning conversations get compressed — while still rolling the transcript up into the project's resource-scope memory at graduation.

**Architecture:** The agent loop already has two independent OM channels that compose every turn: (1) own-OM (thread-scope, read-write — `maybeObserve`/`maybeReflect`) and (2) read-only OM (resource-scope `resource:{projectId}` injected as stream messages). The server wires own-OM only when `resolveOmConfig` returns non-`undefined`, but that function short-circuits to `undefined` for `kind === "plan"` sessions. Removing that one gate makes plans observe their own thread exactly like missions do; the read-only resource injection (already always-on) and graduation rollup (already writes `resource:{projectId}` via `forceObserve`+`forceReflect`) are untouched. No engine, storage, or schema changes are required.

**Tech Stack:** TypeScript, Hono server (`apps/server`), `@sakti-code/agent` OM engine, vitest via `vp test`, Oxlint/Oxfmt via `vp check`.

---

## Background (verified during design)

- **Two OM channels in the loop:** `packages/agent/src/core/agent-loop.ts:443` (own-OM) and `:459` (read-only). They compose — proven by `packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts`.
- **The gate:** `apps/server/src/agent/config/resolve-observational-memory.ts:77` returns `undefined` for `kind === "plan"`.
- **Server wiring:** `apps/server/src/agent/runner.ts:457-489` builds `omOptions` only when `resolveOmConfig` is defined; `omReadOnly` is always built.
- **Graduation (unchanged by this work):** `apps/server/src/agent/config/graduation.ts` already force-observes the child transcript + force-reflects into `resource:{projectId}`. It re-observes all un-observed messages (nothing lost), and `createReflectionGeneration` (`packages/db/src/observational-memory-store.ts:278`) creates a new generation with `activeObservations = reflection`, so reflection compresses across graduations.

**Why no engine/storage changes are needed:** Both requirements raised in design (re-observe trailing messages at graduation; reflection lifecycle past the threshold) are already implemented by `forceObserve`/`forceReflect`/`maybeReflect` + the generational store. The only blocker is the plan gate.

---

### Task 1: Flip the gate-assertion test to RED

**Files:**

- Modify: `apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts:194-203`

**Step 1: Replace the test that asserts the old behavior**

The existing test at line 194 encodes the OLD behavior (plans get no own-OM). Replace it with one asserting the NEW behavior (plans resolve a thread-scope config).

Replace this block:

```ts
it("returns undefined for plan sessions (children read project OM read-only)", () => {
  const ctx = makeCtx(PROFILES, { observationalMemory: {} }, { getApiKey: () => "sk-test" });
  const result = resolveOmConfig(ctx, {
    id: "s1",
    kind: "plan",
    projectId: "p1",
    profileId: null,
  });
  expect(result).toBeUndefined();
});
```

with:

```ts
it("returns thread-scope config for plan sessions (plans observe their own thread)", () => {
  const ctx = makeCtx(PROFILES, { observationalMemory: {} }, { getApiKey: () => "sk-test" });
  const result = resolveOmConfig(ctx, {
    id: "s1",
    kind: "plan",
    projectId: "p1",
    profileId: null,
  });
  expect(result).toBeDefined();
  expect(result!.scope).toBe("thread");
});
```

**Step 2: Run the test to verify it FAILS**

Run: `vp test run apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts -t "plan sessions"`
Expected: FAIL — `expected undefined to be defined` (the gate at `resolve-observational-memory.ts:77` still returns `undefined`).

---

### Task 2: Remove the plan gate (GREEN)

**Files:**

- Modify: `apps/server/src/agent/config/resolve-observational-memory.ts:52-60` (doc comment) and `:74-79` (the gate)

**Step 1: Update the doc comment above `resolveOmConfig`**

Replace the existing JSDoc block (lines ~52-60):

```ts
/**
 * Build observational-memory config from profiles + settings.
 *
 * OM is always on — there is no on/off toggle. Returns `undefined` only when
 * the session is a plan child (kind gate — children read project OM
 * read-only) or model/API-key resolution fails. The runner assembles per-run
 * fields (storage, sessionId, etc.) into the full `ObservationalMemoryDeps`
 * at run time.
 */
```

with:

```ts
/**
 * Build observational-memory config from profiles + settings.
 *
 * OM is always on — there is no on/off toggle. Every session (plan or
 * mission) runs its own thread-scope OM (observe/reflect) AND reads the
 * project's resource-scope OM read-only; the two compose in the agent loop.
 * Returns `undefined` only when model/API-key resolution fails. The runner
 * assembles per-run fields (storage, sessionId, etc.) into the full
 * `ObservationalMemoryDeps` at run time.
 */
```

**Step 2: Delete the plan gate**

Remove this block (lines 74-79) entirely:

```ts
// Plan children never run their own OM — they read the project's
// resource-scope OM read-only (the main plan's memory). Only missions
// observe their own thread. Graduation writes the project OM (Phase 2).
if (session.kind === "plan") {
  return undefined;
}
```

**Step 3: Run the test to verify it PASSES**

Run: `vp test run apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts -t "plan sessions"`
Expected: PASS.

**Step 4: Run the full resolve-observational-memory suite**

Run: `vp test run apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts`
Expected: PASS (all cases, including the mission and skillFilterRoot cases, unaffected).

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/resolve-observational-memory.ts \
        apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts
git commit -m "feat(om): enable thread-scope observational memory for plan sessions"
```

---

### Task 3: Refresh graduation's stale comment

**Files:**

- Modify: `apps/server/src/agent/config/graduation.ts:20-24` (stale rationale paragraph)

The comment still explains a `kind: "mission"` bypass of a gate that no longer exists. Update it so future readers aren't misled. No behavior change.

**Step 1: Replace the stale paragraph**

In the JSDoc above `buildGraduation`, find this paragraph (lines ~20-24):

```ts
 * Why `kind: "mission"` in the resolve call: `resolveOmConfig` gates
 * `kind === "plan"` to undefined (children run no own OM). That gate is about
 * *running* OM during a turn, not about model availability — graduation is the
 * one operation that writes the project OM from a child, so we resolve the
 * project's configured observe/reflect models by bypassing the gate.
```

and replace it with:

```ts
 * The `kind: "mission"` passed to `resolveOmConfig` is historical: the plan
 * kind-gate was removed so plans now run their own thread-scope OM during
 * planning. Graduation still resolves the project's observe/reflect models and
 * forces `scope: "resource"` below so the child's transcript lands in the
 * project's OM slot, not the child's thread slot.
```

**Step 2: Run graduation tests to confirm no behavior change**

Run: `vp test run apps/server/src/agent/config/__tests__/graduation.test.ts`
Expected: PASS (unchanged).

> Note (optional, not required): with the gate gone, `kind: "mission"` at `graduation.ts:33` is now a no-op and could be changed to `kind: childSession.kind` for honesty. Leave it as-is to keep this change purely additive — `kind` is no longer read anywhere in `resolveOmConfig`.

**Step 3: Commit**

```bash
git add apps/server/src/agent/config/graduation.ts
git commit -m "docs(om): update graduation comment after plan gate removal"
```

---

### Task 4: Full verification

**Step 1: Run the OM-related agent tests (composition still holds)**

Run: `vp test run packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts`
Expected: PASS — confirms own-OM + read-only still compose (now also exercised by plan sessions).

**Step 2: Run the whole server suite**

Run: `vp run '@sakti-code/server#test'`
Expected: PASS — in particular `graduation.test.ts`, `confirm.test.ts`, and `model-resolver.test.ts` (which use `kind: "plan"`) must still pass.

**Step 3: Lint + typecheck**

Run: `vp check`
Expected: clean (Oxlint + Oxfmt + tsgolint). Fix any reported issues with `vp check --fix` if formatting drifted.

**Step 4: Manual smoke check (optional, if a running desktop/server is available)**

1. Start a plan session in a project with observe/reflect models configured in the profile.
2. Send enough messages to cross the observation threshold (~30k tokens, or lower the threshold via `settings.json` `observationalMemory.observationThreshold` to test quickly).
3. Confirm an `om_start` / `om_end` event fires (watch `~/.sakti/logs/agent.1.log` for `observational-memory` / `om_` lines) and a row appears in `observational_memory` (query: `SELECT * FROM observational_memory`).
4. Graduate the plan → mission; confirm `resource:{projectId}` gets a row (`SELECT lookup_key, scope, origin_type, generation_count FROM observational_memory`).

---

## Out of scope (explicitly)

- **No engine/storage/schema changes.** The observe/reflect/graduation lifecycle already satisfies both design requirements.
- **No new settings toggle.** Plans always observe (option A). The threshold remains the cost control.
- **Missions unchanged.** Missions already run thread-scope OM; they do not additionally write resource-scope (only graduation does). Not requested.
- **Graduation does not reuse thread observations.** It re-observes the raw transcript for the resource record (chosen design — option 1). For an exceptionally long single plan this means one large observer call at graduation; tunable via thresholds if it bites.
