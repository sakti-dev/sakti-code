# Intake Main-Memory + Child Intakes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Observational Memory the single context/memory strategy; reshape intake into one never-chatted main memory (the project's resource-scope OM record) plus many child intakes that read it read-only and graduate missions back into it; remove traditional compaction entirely.

**Architecture:** Phase 0 deletes the compaction subsystem (OM's `maybeObserve→pruneObservedMessages` loop, already wired into every turn, becomes the sole window manager — verified at `session/session.ts:65`). Phase 1–2 build the intake model: `resolveOmConfig` gates on kind (intake → read-only, no own OM); children are `kind=intake` sessions reading the project OM via the existing read-only path; graduation runs a one-shot resource-scope engine on the child (`engine.ts:84-86` keys it at the project slot) and writes the reflection into the main intake's OM. Phase 3 gives missions own-OM + project-read-only (inject-both). Phase 4 makes onboarding a grid of child-intake cards.

**Tech Stack:** TypeScript, SolidJS, Hono, node:sqlite + Drizzle, vitest, OM engine (`@sakti-code/agent`).

**Commands:**

- `vp check` — format + lint + typecheck gate (run before every commit)
- `vp run -r test` — all tests
- `vp run '@sakti-code/agent#test' <path>` / `vp run '@sakti-code/server#test' <path>` / `vp run desktop#test <path>` — single-package (paths relative to package root; quote the target)
- **NEVER** use `vp test run <path>`.

**Design doc:** `docs/plans/2026-07-04-intake-main-memory-design.md` (read before starting).

**Inventory reference:** Phase 0 deletion targets come from the exhaustive compaction inventory in the design exploration; line numbers are current as of `d8960ac2`. Re-confirm with `rg` before deleting — a missed reference is a compile error.

**DB note:** The DB will be deleted, so no legacy `compaction` entries / `compactionSummary` messages survive. Remove those types/branches outright; no backward-compat shims.

---

## Phase 0 — Drop the compaction subsystem

**Coupling warning:** Phase 0 is one large interdependent deletion; intermediate states will NOT compile. Work bottom-up (leaf dependents first), verify with `vp check` + `vp run -r test` ONCE at the end of Task 0.8, then commit. Do not commit mid-phase.

### Task 0.1: Delete pure compaction files + their tests

**Files — DELETE outright:**

- `packages/agent/src/memory/compaction/compaction.ts`
- `packages/agent/src/memory/compaction/auto-compaction.ts`
- `packages/agent/src/memory/compaction/pinned-turns.ts`
- `packages/agent/src/memory/compaction/prune.ts`
- `packages/agent/src/memory/compaction/__tests__/compaction.test.ts`
- `packages/agent/src/memory/compaction/__tests__/auto-compaction.test.ts`
- `packages/agent/src/memory/compaction/__tests__/pinned-turns.test.ts`
- `packages/agent/src/memory/compaction/__tests__/prune.test.ts`
- `packages/agent/src/memory/compaction/__tests__/prompt-bundles.test.ts`
- `packages/agent/src/__tests__/helpers/test-compaction-prompts.ts`
- `packages/agent/src/__tests__/types-compaction-reason.test.ts`
- `apps/server/src/__tests__/compaction.test.ts`
- `apps/server/src/agent/__tests__/ws-handler-compact-dispatch.test.ts`
- `apps/server/src/agent/commands/__tests__/compact.test.ts`
- `apps/server/src/agent/commands/compact.ts`
- `apps/server/src/routes/sessions/compaction.ts`

**Files — DELETE desktop compaction UI:**

- `apps/desktop/src/stores/session/handlers/compaction-events.ts`
- `apps/desktop/src/components/chat-area/parts/compaction-part.tsx`
- `apps/desktop/src/stores/session/__tests__/compaction-handlers.test.ts`

Do not run `vp check` yet — the importers still reference these. Continue.

### Task 0.2: Edit shared infrastructure in `memory/compaction/`

These files stay but lose their compaction pieces. Re-read each before editing.

**`packages/agent/src/memory/compaction/retry-loop.ts`** — KEEP retry; DELETE compaction phase:

- Delete `runCompactionPhaseEffect` (def + the two call sites in `executeWithRetryEffect`).
- Remove `checkCompaction` / `runCompaction` from `RetryRunnerDepsEffect`.
- Delete `StuckGuardState` interface (exists only for compaction) + its references.
- Keep: `shouldRetry`, `computeRetryDelay`, `RetrySettings`, `parseRetrySettings`, `abortableSleep`, `RetryRunnerDepsEffect` (retry-only members), `executeWithRetryEffect`.

**`packages/agent/src/memory/compaction/branch-summarization.ts`** — strip compaction-entry handling:

- Remove `import { estimateTokens } from "./compaction"` — re-inline a local token estimator or drop if unused after edits.
- Remove `createCompactionSummaryMessage` import + its use.
- Delete the `case "compaction":` branch in `getMessageFromEntry` and `entry.type === "compaction"` in `prepareBranchEntries`.

**`packages/agent/src/memory/compaction/prompt-bundles.ts`** — DELETE `CompactionPrompts` interface (lines ~7-16). KEEP `BranchSummaryPrompts` + `SkillsInstructions`.

**`packages/agent/src/memory/compaction/utils.ts`** — KEEP (`serializeConversation`, `FileOperations`, `computeFileLists` used by branch-summary + public API). No edits unless `estimateTokens` relocation is needed (decide in 0.2 branch-summary edit).

**`packages/agent/src/memory/compaction/__tests__/retry-loop.test.ts`** — delete compaction-phase tests (lines ~432, 435-460, 559-580: `compaction_start`/`compaction_end` assertions + the "runs compaction" + "error compaction_end" tests). Keep pure-retry tests.

### Task 0.3: Remove the `compaction` entry type + builder branch

**`packages/agent/src/session/entries.ts`:**

- Delete `interface CompactionEntry<T>` (~35-42).
- Remove `| CompactionEntry` from the `SessionTreeEntry` union (~97). **Keep `ObservationPruneEntry` (82-90, 104) — that's OM.**
- Delete `interface CompactResult` (~214-219), `interface CompactionSettings` (~221-225), `interface CompactionPreparation` (~233-242).

**`packages/agent/src/session/session.ts`:**

- Delete the `CompactionEntry` import (line 7) and `createCompactionSummaryMessage` import (line 22).
- In `buildSessionContextFromEntries`: delete `let compaction = null` (32), the `else if (entry.type === "compaction")` branch (46-48), and the entire `if (compaction) { … }` block (83-111). The `else` branch (107-111) becomes the body: just `for (const entry of pathEntries) appendMessage(entry)`.
- Delete `appendCompaction` from `SessionShape` (120-126), its Effect impl (255-277), the `shape` object member (401), `PromiseSession.appendCompaction` (517-535), and the `promiseSessionAsShape` wrapper (651-654).

**`packages/agent/src/session/messages.ts`:** delete `createCompactionSummaryMessage`, `COMPACTION_SUMMARY_PREFIX/SUFFIX`, and the `compactionSummary` case (lines ~6,13,17-23,63-74,128,134).

**`packages/agent/src/types.ts`:** delete `CompactionSummaryMessage` (181-186) and remove `| CompactionSummaryMessage` from the `AgentMessage` union (193).

**OM-adjacent cleanup** (now-dead `compactionSummary` cases, since the role is gone):

- `packages/agent/src/memory/observational-memory/token-counter.ts:559,657` — delete `case "compactionSummary":`.
- `packages/agent/src/memory/observational-memory/prompts.ts:515` — delete `case "compactionSummary":`.
- `packages/agent/src/memory/observational-memory/__tests__/token-counter.test.ts:160` — remove the `role: "compactionSummary"` fixture case.
- `packages/agent/src/session/__tests__/session.test.ts:58,61` — drop the `appendCompaction` + `compactionSummary` assertion.

### Task 0.4: Strip compaction from the runner

**`packages/agent/src/runner/agent-run.ts`:**

- Delete imports of `checkCompaction`/`runAutoCompactionEffect` (6), `CompactionSettings` (7), `CompactionPrompts` (8). Keep `executeWithRetryEffect`, `RetryRunnerDepsEffect`, `RetrySettings` from retry-loop (9-14).
- Delete `AgentRunDeps.compactionPrompts` (26) and `.compactionSettings` (27).
- Drop `compactionSettings, compactionPrompts` from the destructure (90-91).
- Delete the `checkCompaction:` retry-dep callback (230-265) and `runCompaction:` callback (266-289), incl. `consecutiveCompacts` plumbing (249-251) and the stuck-guard load/debug (182-188).

**`packages/agent/src/runner/session-settings.ts`:**

- Drop imports of `parseCompactionSettings`, `CompactionSettings` (1-2).
- Delete the `auto_compaction` default key (19), `autoCompaction()` (35) and `compaction()` (37,64,70) accessors.

**`packages/agent/src/runner/__tests__/session-settings.test.ts`** — drop `autoCompaction`/`compaction()` assertions (20,41,79).

**`packages/agent/src/runner/__tests__/agent-run.test.ts`** — remove `TEST_COMPACTION_PROMPTS` (11), the `compactionPrompts` arg (80), and `compactionSettings: parseCompactionSettings(...)` (122-123).

### Task 0.5: Strip compaction from the harness

**`packages/agent/src/agent/agent-harness.ts`:**

- Delete the `DEFAULT_COMPACTION_SETTINGS, prepareCompaction, compactEffect as runCompactEffect` import (9-13).
- Drop `CompactionPrompts` from the prompt-bundles import (14-18); keep `BranchSummaryPrompts`, `SkillsInstructions`.
- Delete `private compactionPrompts` field (250), its assignment in the constructor (321), and `AgentHarnessOptions.compactionPrompts` (516).
- Delete `compactEffect(customInstructions?)` (1324-1431) and `async compact(...)` (1433-1440).
- Edit comments that reference compaction (258, 1276, 1642, 1772, 1822, 1844, 1860, 1949, 1972-1977, 2071-2099, 2189).
- **Drain trigger:** the deleted `compactEffect` held the pending-system-prompt-refresh drain (1411-1418). Relocate that drain to the agent-switch path (where the pending refresh actually originates) so a model/prompt change still flushes cleanly. Read the surrounding logic before moving.

**`packages/agent/src/agent/__tests__/agent-harness.test.ts`** — delete the `session_before_compact` hook test (974,985) and the `compactEffect` test (1793,1813,1820); strip the ~51 `compactionPrompts: TEST_COMPACTION_PROMPTS` lines.

**`packages/agent/src/agent/__tests__/agent-switch.test.ts`, `core/__tests__/cache-stability.test.ts`, `agent/__tests__/agent-harness-continue.test.ts`** — strip `compactionPrompts` / `TEST_COMPACTION_PROMPTS` usages.

**`packages/agent/src/index.ts`** — delete re-exports: `compactEffect`/`compact` (36-37), `checkCompaction`/`runAutoCompactionEffect` (22), `CompactionSettings` (33), `CompactionPrompts` (47), `CompactionSummaryMessage`/`COMPACTION_SUMMARY_*`/`createCompactionSummaryMessage` (199,206,207,210). Keep `serializeConversation`/`FileOperations` (63-64) and `BranchSummaryPrompts`.

**`packages/agent/src/agent/harness-types.ts`** — remove `"compaction"` from `AgentHarnessPhase` (~268).

### Task 0.6: Strip compaction from the server

**`apps/server/src/app.ts`** — drop `compactionRoutes` import (16) + `.route("/", compactionRoutes)` (43).

**`apps/server/src/agent/ws-handler.ts`:**

- Delete `runCompact` import (9).
- Delete `CommandMessage` interface (71-78) and `| CommandMessage` (88).
- Delete the `command`/`compact` schema branch (187-192).
- Delete `handleCompactCommand()` (351-475) and its dispatch (555-561).

**`apps/server/src/agent/config/force-reset.ts`** — drop `runCompact` import (5); delete the `else { await runCompact(...) }` branch (44-47). Leave the OM-on `forceObserve` branch. (Phase 3 collapses this further.) Edit the docstring.

**`apps/server/src/agent/config/__tests__/force-reset.test.ts`** — rewrite: drop the `runCompact` mock + OM-off→runCompact test; keep only the OM-on→forceObserve test (Phase 3 will replace this entirely).

**`apps/server/src/agent/config/compaction-prompts.ts`** — delete `COMPACTION_PROMPTS` (11-99). KEEP `BRANCH_SUMMARY_PROMPTS` (106-140); inline the `COMPACTION_PROMPTS.summarizationSystem` reference at line 139. Rename file → `branch-summary-prompts.ts` (optional but cleaner) and update importers.

**`apps/server/src/agent/config/index.ts`** — drop `COMPACTION_PROMPTS` from the re-export (3).

**`apps/server/src/agent/runner.ts`:**

- Drop `COMPACTION_PROMPTS` import (32); remove from harness options (497) and `runAgentRunEffect` field (606).
- Delete `settings.compaction()` (443) + the `compactionSettings` field (605).
- Delete stuck-guard: `loadStuckGuardState`/`persistStuckGuardState` (275-297), their settings keys `auto_compaction_paused`/`consecutive_compacts` (268-269,276,279,289,293,295), and the `loadStuckGuard`/`persistStuckGuard` callbacks (615-616).

**`apps/server/src/routes/sessions/session-settings.ts`** — drop `auto_compaction` default (8) + typebox schema (17).

**`apps/server/src/__tests__/composition.test.ts`** — drop `compactionRoutes` from the composed-app fixture (11,35,56).

### Task 0.7: Strip compaction from the desktop

**`apps/desktop/src/stores/server/actions.ts`** — delete the `/compact` slash-command branch (200-211).

**`apps/desktop/src/stores/session/event-handler.ts`** — drop `registerCompactionHandlers` import (4) + call.

**`apps/desktop/src/stores/session/session-store.ts`** — delete `appendCompactionToken` (64,97,383-406), `updateCompactionMarker` (97,408-425), `addCompactionMarker` (362-380).

**`apps/desktop/src/stores/types.ts`** — delete the `{ type: "compaction"; … }` variant from `MessagePart` (41-49).

**`apps/desktop/src/components/chat-area/parts/register-parts.ts`** — drop `CompactionPart` import + registration (1,17).

**`apps/desktop/src/components/chat-area/timeline/estimate-turn-height.ts`** — delete `case "compaction":` (102).

**`apps/desktop/src/components/chat-area/timeline/timeline-renderer.tsx`** — drop the `compaction` half of the `part.type === "compaction" || part.type === "om_marker"` checks (83,97,101); keep `om_marker`.

**Desktop tests:** delete the compaction block in `stores/session/__tests__/turn-store.test.ts` (215-255); the two `/compact` tests in `stores/server/__tests__/actions.test.ts` (150-179); the "renders compaction parts" test in `components/chat-area/timeline/__tests__/timeline-renderer.test.tsx` (66-70).

**`packages/db/src/__tests__/session-entry-store.test.ts`** — delete the compaction-entry round-trip test (153-170).

**`packages/db/src/repos/__tests__/repos.test.ts`** — drop the `auto_compaction` row from the settings fixture (128,138).

**Comments only** (no logic): `packages/db/src/schema.ts:29`, `packages/db/src/session-entry-store.ts:31`.

### Task 0.8: Verify Phase 0 and commit

**Step 1:** `rg -i "compact" packages/ apps/ --glob '!docs/**' --glob '!*.md'` — expect only: `branch-summarization` (file name, kept), `serializeConversation` false-positives, `mode?: "compact"` in `search-bar.tsx`/`usage-stats.ts` (unrelated, keep). Any other hit = a missed reference; fix it.

**Step 2:** `vp check` — must be clean (0 errors). Fix iteratively.

**Step 3:** `vp run -r test` — must be green (only the known pre-existing `apps/server/src/__tests__/compaction.test.ts` is already deleted, so no known failures remain).

**Step 4:** Commit:

```bash
git add -A
git commit -m "refactor: drop traditional compaction in favor of observational memory

OM's maybeObserve→pruneObservedMessages loop (already wired into every turn
in agent-loop.ts, honoured by the context builder at session.ts:65) is a
threshold-triggered window manager that makes compaction redundant. Removes
the compaction subsystem (algorithm, auto-compaction, retry-loop phase,
runner/harness APIs, entry type + builder branch, CompactionSummaryMessage
role), the server /compact endpoint + WS branch, the force-reset OM-off
fallback, the stuck-guard (existed only for compaction), and all desktop
compaction UI/parts. Shared infra (retry, branch-summary, prompt-bundles,
utils) kept and stripped of compaction pieces."
```

---

## Phase 1 — Intake data model (children read project OM read-only)

### Task 1.1: Gate `resolveOmConfig` on session kind

**Why:** intake children must take the read-only path (no own OM); only missions run their own thread-scope OM.

**Files:**

- Modify: `apps/server/src/agent/config/resolve-observational-memory.ts`
- Test: `apps/server/src/agent/config/__tests__/resolve-observational-memory.test.ts`

**Step 1 — write failing test** (add to the describe block):

```ts
it("returns undefined for intake sessions (children read project OM read-only)", () => {
  const ctx = makeCtx(
    PROFILES,
    { observationalMemory: { enabled: true } },
    { getApiKey: () => "sk-test" },
  );
  const result = resolveOmConfig(ctx, {
    id: "s1",
    kind: "intake",
    projectId: "p1",
    profileId: null,
  });
  expect(result).toBeUndefined();
});

it("returns config for mission sessions", () => {
  const ctx = makeCtx(
    PROFILES,
    { observationalMemory: { enabled: true } },
    { getApiKey: () => "sk-test" },
  );
  const result = resolveOmConfig(ctx, {
    id: "s1",
    kind: "mission",
    projectId: "p1",
    profileId: null,
  });
  expect(result).toBeDefined();
  expect(result!.scope).toBe("thread");
});
```

**Step 2:** `vp run '@sakti-code/server#test' src/agent/config/__tests__/resolve-observational-memory.test.ts` — expect FAIL (intake currently returns a config).

**Step 3 — implement:** in `resolveOmConfig`, immediately after `if (!omSettings) return undefined;` (line 60), add:

```ts
// Intake children never run their own OM — they read the project's
// resource-scope OM read-only (the main intake's memory). Only missions
// observe their own thread. Graduation writes the project OM (Phase 2).
if (session.kind === "intake") {
  return undefined;
}
```

**Step 4:** re-run the test — expect PASS.

**Step 5:** `vp check` then commit: `feat(om): intake sessions read project OM read-only (no own thread OM)`.

### Task 1.2: Repo — `listChildIntakesByProject`

**Files:**

- Modify: `packages/db/src/repos/index.ts` (replace the `findIntakeByProject` singleton with a list)
- Test: `packages/db/src/__tests__/sessions-kind.test.ts` (or a new `repos.test.ts` block)

**Step 1 — write failing test:**

```ts
it("listChildIntakesByProject returns all intake sessions for a project", async () => {
  // create two kind=intake sessions + one mission; assert only the two intakes come back, newest first
});
```

**Step 2:** run, expect FAIL (method missing).

**Step 3 — implement** in `SessionRepo`: replace `findIntakeByProject` with

```ts
listChildIntakesByProject(projectId: string) {
  return this.db.select().from(sessions)
    .where(and(eq(sessions.projectId, projectId), eq(sessions.kind, "intake")))
    .orderBy(desc(sessions.createdAt)).all();
}
```

Update call sites + the repo's exported type.

**Step 4:** test PASS; `vp check`; commit: `feat(db): listChildIntakesByProject replaces singleton findIntakeByProject`.

### Task 1.3: Route — create child intake + retire singleton upsert

**Files:**

- Modify: `apps/server/src/routes/projects/intake-session.ts` (repoint to create-child)
- Modify: `apps/server/src/__tests__/intake-session.test.ts`
- Modify: `apps/desktop/src/stores/server/actions.ts` (`upsertIntakeSession` → `createChildIntake`)

**Step 1 — write failing tests:** POST creates a NEW intake each call (201 every time, distinct ids); GET list returns all child intakes.

**Step 2:** run, expect FAIL.

**Step 3 — implement:** change the route to always `create` (no upsert); add `GET /api/projects/:id/intake-sessions` returning `listChildIntakesByProject`. Rename the desktop action `createChildIntake(projectId)` calling the create route. Update the Hono `App` type + `app.ts` route mounting.

**Step 4:** tests PASS; `vp check`; commit: `feat(intake): create-child route replaces singleton upsert`.

---

## Phase 2 — Graduation (child → main OM, then spawn mission)

### Task 2.1: Graduation handler in `ask-kinds.ts`

**Why:** on `ask(kind=session)` approval from a child intake, force-observe + force-reflect the child into the project's resource-scope OM, then let the existing card-Create spawn the mission.

**Files:**

- Modify: `apps/server/src/agent/config/ask-kinds.ts`
- New test: `apps/server/src/agent/config/__tests__/ask-kinds.test.ts` (graduation branch)

**Step 1 — write failing test** using a fake OM engine: assert that on `session.onApprove`, a resource-scope engine is built from the child's storage and `forceObserve`+`forceReflect` are called, and that an engine error is swallowed (doesn't throw).

**Step 2:** run, expect FAIL.

**Step 3 — implement:** extend `AskCtx` with a `graduate?: (childSessionId, projectId) => Promise<void>` callback. Wire `session.onApprove` to call it (best-effort try/catch + `ctx.log?.agent?.warn`). The callback's implementation (Phase 2.2) builds the one-shot resource-scope engine. Keep `session.onApprove` returning void; the mission spawn stays in the card-Create flow.

**Step 4:** test PASS; `vp check`; commit: `feat(intake): graduation hook on ask(kind=session) approve`.

### Task 2.2: Wire the graduation engine in the confirm route

**Files:**

- Modify: `apps/server/src/routes/sessions/confirm.ts` (bind `AskCtx.graduate`)
- Extract (optional): `apps/server/src/agent/config/graduation.ts` (the resource-scope engine builder, symmetric to `force-reset.ts`)

**Step 1 — write failing test:** `graduation.test.ts` — given a child session with messages, calling `graduate` builds an OM engine with `scope: "resource"` on the child's storage and calls `forceObserve` then `forceReflect`; the resulting record is keyed `(threadId=null, resourceId=projectId)`.

**Step 2:** run, expect FAIL.

**Step 3 — implement** `buildGraduation(ctx, childSession)` → `(sessionId) => Promise<void>`:

```ts
// resolveOmConfig-style: resolve observe+reflect models for the project,
// but force scope: "resource" so the engine writes the project's OM slot
// (engine.ts:84-86 keys resource scope at threadId=null, resourceId=projectId).
const engine = new ObservationalMemoryEngine({
  deps: {
    ...omConfig,
    scope: "resource",
    storage: omStorage,
    sessionId: sid,
    projectId: childSession.projectId,
    sessionStorage: createSessionStorage(ctx, sid),
  },
});
await engine.forceObserve();
await engine.forceReflect();
```

Wrap in try/catch (warn on failure). Bind it in `confirm.ts` when the session kind is `intake`.

**Step 4:** test PASS; `vp check`; commit: `feat(intake): graduation writes child reflection into project OM`.

### Task 2.3: Onboarding calls graduation before mission spawn

**Files:**

- Modify: `apps/desktop/src/components/onboarding/onboarding-panel.tsx` (`handleConfirmSession`)
- Modify: `apps/desktop/src/stores/server/actions.ts` (if graduation is server-side via confirm route, no client change beyond waiting for the approve to settle)

**Note:** graduation fires server-side in the `confirm` route (Task 2.2). The desktop `handleConfirmSession` already calls `createSession` after the ask is approved; confirm the approve→graduate ordering (graduate is in the confirm approve handler; mission spawn is the subsequent card-Create). Add a test that the mission is still created when graduation is a no-op (empty child). Commit: `feat(intake): onboarding graduates child then spawns mission`.

---

## Phase 3 — Missions: own OM + project OM read-only (option A)

### Task 3.1: Inject-both OM blocks in `agent-loop.ts`

**Why:** missions run their own thread OM AND must see the project's accumulated intake memory. Today the loop is either/or.

**Files:**

- Modify: `packages/agent/src/core/agent-loop.ts` (two sites: 289-318 first-turn, 419-454 turn-boundary)
- Test: `packages/agent/src/core/__tests__/agent-loop-om-readonly.test.ts` (extend) + a new inject-both test

**Step 1 — write failing test:** when both `observationalMemory` and `observationalMemoryReadOnly` are set, the system prompt contains BOTH the own-OM observations block AND the read-only block.

**Step 2:** run, expect FAIL (only own-OM injected today).

**Step 3 — implement:** at both sites, change `else if (config.observationalMemoryReadOnly)` to a separate `if` that runs even after the own-OM branch, APPENDING the read-only block to the already-built system prompt (not replacing it). Concretely: after the `if (config.observationalMemory) { … }` block sets `currentContext.systemPrompt`, add:

```ts
if (config.observationalMemoryReadOnly) {
  const ro =
    yield *
    Effect.tryPromise({
      try: () => config.observationalMemoryReadOnly!.getObservationsBlock(),
      catch: () => undefined,
    });
  if (ro !== undefined)
    currentContext = {
      ...currentContext,
      systemPrompt: `${currentContext.systemPrompt ?? ""}\n\n${ro}`,
    };
}
```

**Step 4:** test PASS; `vp check`; commit: `feat(om): inject project read-only OM alongside own thread OM`.

### Task 3.2: Runner builds the read-only block for missions too

**Files:**

- Modify: `apps/server/src/agent/runner.ts` (556-594): when `omConfig` is present (mission), ALSO build `omReadOnly` from the resource-scope record `(threadId=null, projectId)` — same `buildObservationsBlock` helper — and pass both.

**Step 1 — write failing test:** a mission run resolves both `observationalMemory` and `observationalMemoryReadOnly` deps; an intake run resolves only `observationalMemoryReadOnly`.

**Step 2:** run, expect FAIL.

**Step 3 — implement:** hoist the `omReadOnly` construction out of the `else` so it's always built (for missions it reads the project resource-scope record; for intakes it's the only block). Pass both to `runAgentRunEffect` when both exist.

**Step 4:** test PASS; `vp check`; commit: `feat(om): missions get project read-only OM in addition to own thread OM`.

### Task 3.3: Collapse `force-reset.ts` to always-forceObserve

**Files:**

- Modify: `apps/server/src/agent/config/force-reset.ts` (the OM-off branch is already gone from Phase 0; simplify the function — it always builds the engine and forceObserves)
- Modify: `apps/server/src/agent/config/__tests__/force-reset.test.ts` (rewrite for the no-branch shape)

**Step 1 — rewrite test:** a single test — `buildForceReset` always calls `forceObserve` (no OM-on/off branch).

**Step 2:** run, expect FAIL/old-shape.

**Step 3 — implement:** remove the `resolveOmConfig` branch; always build the engine + `forceObserve`. (If OM config is missing — no observe/reflect models configured — log a warning and skip, never strand the mission.)

**Step 4:** test PASS; `vp check`; commit: `refactor(force-reset): always forceObserve on plan→build (OM-only)`.

---

## Phase 4 — Onboarding grid UI

### Task 4.1: Grid of child-intake cards

**Files:**

- Modify: `apps/desktop/src/components/onboarding/onboarding-panel.tsx` (replace direct-chat with a card grid)
- New: `apps/desktop/src/components/onboarding/intake-card.tsx` (a card: title, updatedAt, snippet)
- Modify: `apps/desktop/src/stores/server/actions.ts` (`createChildIntake` from Task 1.3; `listChildIntakes` action if needed)
- Test: `apps/desktop/src/components/onboarding/__tests__/onboarding-panel.test.tsx`

**Step 1 — write failing test:** OnboardingPanel renders one card per child intake from `listChildIntakesByProject`; clicking a card opens that child's chat (`openProjectTab` with the child id); "New intake" creates a child and opens it.

**Step 2:** run, expect FAIL.

**Step 3 — implement:**

- OnboardingPanel: fetch child intakes for the active project; render a grid of `IntakeCard`; "New intake" button → `createChildIntake` → `openProjectTab`. When a specific child tab is active, render the existing chat view (`MessageTimeline` + `ChatInput` + `AskCard`) bound to that child — move that view into a child component used both here and, if needed, in the main chat area.
- The sidebar "plus" (currently `handleNewMission` → upsert intake) now calls `createChildIntake` instead (Task 1.3 action).

**Step 4:** test PASS; `vp run desktop#test`; `vp check`; commit: `feat(ui): onboarding becomes a grid of child-intake cards`.

### Task 4.2: Retire the singleton intake assumptions

**Files:**

- Audit: `apps/desktop/src` for remaining `upsertIntakeSession` / `intakeSessionId` singleton usage (notably `workspace-layout.tsx` which upserts on project open). Replace with "list children; create-on-demand."
- Update the desktop `SessionMeta`/store: no single intake id; children are normal sessions in the store.

**Verify:** `vp run desktop#test` + `vp check`; commit: `refactor(ui): drop singleton-intake assumptions from workspace bootstrap`.

---

## Final verification

- `vp check` — clean.
- `vp run -r test` — green.
- Manual smoke (if running the app): create a project → onboarding shows empty grid → "New intake" creates child A → chat → approve a brief → mission spawns; create child B → B's context includes the project OM observations from A's graduation.

## Risks tracked in the design doc (§8)

- No latent compaction safety net — OM must be configured (observe+reflect models) or a session has no window manager. Surface a clear warning when OM models are missing.
- Inject-both token cost on long missions — watch in practice.
- Graduation reflection quality — accept in v1; a later "re-reflect" action can revise.
