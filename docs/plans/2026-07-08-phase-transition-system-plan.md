# Phase Transition System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `ask`-based lifecycle with a `transition` tool driven by a server-side gate/auto table, a stable cache-safe system prompt, an auto-chaining runner, yes/no gates, and a phase/progress-aware `<reminder>` guardrail.

**Architecture:** Tool = dumb signal (like ask). Server owns policy: a transition table maps each phase edge to gate/auto + side-effects + an `<instruction>` template. The ws-handler intercepts `transition` tool-execution (mirroring the ask hook); the runner auto-chains across auto-edges and pauses at gates. System prompt collapses to stable `BASE_PROMPT`; phase guidance rides `<instruction>` blocks (tool result between phases, handoff user message at mission start). Sakti becomes a library (SDD utils exported) so the runtime can produce progress-aware reminders; a `changeName` column links missions to changes.

**Tech Stack:** TypeScript, Hono, node:sqlite + Drizzle, Vitest, `vp` toolchain.

**Design doc:** `docs/plans/2026-07-08-phase-transition-system.md`

**Key commands:**

- `vp run '@sakti-code/sakti#test'`, `vp run '@sakti-code/server#test'`, `vp run '@sakti-code/tools#test'`
- `vp run -r test` (all), `vp check`
- 3 pre-existing baseline failures in `packages/sakti` (inquirer-removal, unrelated) — expected.

**Conventions:** TDD. `exactOptionalPropertyTypes: true` (use `delete` / conditional spread, never assign `undefined`). Tests in `__tests__/`. No `.only`/`.skip`.

**Grounding notes (verified during brainstorming):**

- `ask` interception: `ws-handler.ts:202-244` — `tool_execution_start` for `"ask"` sets `pendingAskKind/Body`; `completion` pre-sets `status:"review"`. New runs clear it.
- Confirm route: `routes/sessions/confirm.ts` — `ASK_KINDS[kind].onApprove/onReject`; clears pending.
- Tool registry: `tool-registry.ts` `TOOL_FACTORIES` + `ToolContext { cwd, editMode, noopOwner, snapshotStore, websearchOperations }`.
- Skill injection: `runner.ts:490` `getBuiltinSkillForPhase(phaseKey)` → `buildSkillInjectionMessages`.
- Migrations: drizzle folder-based, `packages/db/migrations/<ts>_<name>/migration.sql` + `snapshot.json`.
- `task-progress.ts`: `getTaskProgressForChange(changesDir, changeName, projectRoot)` → `{total, completed}` (schema-aware, never throws).
- Agents: `server-agents.ts` — build/verify/plan differ in permission ruleset + activeToolNames.

---

## Phase 1 — Foundation (no behavior change)

### Task 1: Export SDD utils from `@sakti-code/sakti` (sakti-as-library)

**Files:**

- Create: `packages/sakti/src/sdd/utils/index.ts` (barrel)
- Modify: `packages/sakti/src/index.ts`

**Step 1: Create the utils barrel** re-exporting: `getTaskProgressForChange`, `formatTaskStatus`, `countTasksFromContent`, `type TaskProgress` (task-progress.ts); and the change-metadata readers (`readChangeMetadata`, `writeChangeMetadata`, `resolveSchemaForChange`) from change-metadata.ts.

**Step 2: Re-export from the package root.** In `src/index.ts` add `export * from "./sdd/utils/index.js";`.

**Step 3: Test (RED).** `packages/sakti/src/sdd/utils/__tests__/exports.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as sakti from "../../../index.js";
describe("sakti library exports SDD utils", () => {
  it("exports task-progress helpers", () => {
    expect(typeof sakti.getTaskProgressForChange).toBe("function");
    expect(typeof sakti.formatTaskStatus).toBe("function");
  });
  it("exports change-metadata readers", () => {
    expect(typeof sakti.readChangeMetadata).toBe("function");
  });
});
```

**Step 4:** `vp run '@sakti-code/sakti#test'` → GREEN. **Step 5:** Commit `feat(sakti): export SDD utils for library use`.

---

### Task 2: `sessions.changeName` column + migration

**Files:**

- Modify: `packages/db/src/schema.ts` (sessions table — add `changeName`)
- Create: migration folder `packages/db/migrations/<new-ts>_change_name/migration.sql` (generate via drizzle-kit, see package.json scripts; if no kit, hand-write the SQL + copy snapshot.json forward)

**Step 1 (RED):** Test `packages/db/src/__tests__/change-name.test.ts` asserting the column exists + is nullable:

```ts
import { DatabaseSync } from "node:sqlite";
import { initDatabase } from "../init.js";
import { eq } from "drizzle-orm";
import { sessions } from "../schema.js";
// create temp db, init, insert a session with changeName null + one with a value, read back
```

**Step 2:** Add to schema.ts sessions table: `changeName: text("change_name"),` (nullable, no default).
**Step 3:** Generate the migration (run the db package's migration generate script; or hand-write `ALTER TABLE sessions ADD COLUMN change_name text;` in a new migration folder with an updated snapshot.json copied from the latest).
**Step 4:** `vp run '@sakti-code/db#test'` → GREEN. **Step 5:** Commit `feat(db): add sessions.changeName column`.

---

## Phase 2 — The transition tool + table

### Task 3: `transition-table.ts` (the policy single source of truth)

**Files:**

- Create: `apps/server/src/agent/config/transition-table.ts`
- Create: `apps/server/src/agent/config/__tests__/transition-table.test.ts`

**Step 1 (RED):** Test the lookups:

```ts
import { describe, it, expect } from "vite-plus/test";
import { getEdge, type TransitionEdge } from "../transition-table.ts";
describe("transition table", () => {
  it("build→verify is auto + forced observe", () => {
    const e = getEdge("build", "verify");
    expect(e.mode).toBe("auto");
    expect(e.requiresForcedObserve).toBe(true);
  });
  it("verify→archive is gate", () => {
    expect(getEdge("verify", "archive").mode).toBe("gate");
  });
  it("verify→build is auto", () => {
    expect(getEdge("verify", "build").mode).toBe("auto");
  });
  it("specify→build is gate", () => {
    expect(getEdge("specify", "build").mode).toBe("gate");
  });
  it("plan→mission is gate", () => {
    expect(getEdge("plan", "mission").mode).toBe("gate");
  });
  it("every edge has a non-empty <instruction> template", () => {
    for (const edge of allEdges()) expect(edge.instruction).toMatch(/<instruction>/);
  });
});
```

**Step 2:** Implement `transition-table.ts`:

```ts
export type Phase = "plan" | "specify" | "build" | "verify" | "archive" | "mission";
export type Mode = "gate" | "auto";
export interface TransitionEdge {
  from: Phase;
  to: Phase;
  mode: Mode;
  requiresForcedObserve?: boolean;
  instruction: string;
}
const TABLE: Record<string, TransitionEdge> = {
  /* keyed `${from}->${to}` */
};
export function getEdge(from: Phase, to: Phase): TransitionEdge {
  /* lookup; throw on unknown edge */
}
export function allEdges(): TransitionEdge[] {
  return Object.values(TABLE);
}
```

Each `instruction` is the `<instruction>…</instruction>` template the next phase receives (see design doc table). The forced-observe flag is set only on build→verify.

**Step 3:** `vp run '@sakti-code/server#test'` → GREEN. **Step 4:** Commit `feat(server): transition table (gate/auto + instruction templates)`.

---

### Task 4: The `transition` tool (packages/tools)

**Files:**

- Create: `packages/tools/src/transition/index.ts`
- Create: `packages/tools/src/transition/__tests__/transition.test.ts`
- Modify: `packages/tools/src/index.ts` (export `createTransitionTool`)

**Step 1 (RED):** Test the tool is a pure signal (like ask):

```ts
// tool takes {to, body}; execute() returns terminate:true with a neutral result (instruction injected server-side post-call)
```

**Step 2:** Implement — minimal, mirroring `createAskTool`:

```ts
const schema = Type.Object({ to: Type.String(), body: Type.String() });
export function createTransitionTool(): AgentTool<typeof schema, undefined> {
  return {
    name: "transition",
    label: "transition",
    description:
      "Move to the next phase. Pass the destination (`to`) and a `body` (mission brief / fixing plan / summary). Ends your turn.",
    parameters: schema,
    async execute() {
      return {
        content: [{ type: "text", text: "Phase transition recorded." }],
        details: undefined,
        terminate: true,
      };
    },
  };
}
```

The tool does NO side-effects (no DB, no observe) — it's a pure signal. The server (ws-handler + runner) processes it. The phase-specific `<instruction>` is delivered server-side (Task 10), not from this tool result.

**Step 3:** Export from `packages/tools/src/index.ts`. **Step 4:** `vp run '@sakti-code/tools#test'` → GREEN. **Step 5:** Commit `feat(tools): add transition tool`.

---

## Phase 3 — Stable system prompt

### Task 5: Dissolve role sections → stable `BASE_PROMPT`

**Files:**

- Modify: `apps/server/src/agent/config/prompts.ts`
- Modify: `apps/server/src/agent/config/server-agents.ts` (all agents share `BASE_PROMPT`)
- Modify: `apps/server/src/agent/config/index.ts` (drop BUILD/VERIFY/PLAN_PROMPT re-exports if no longer needed)
- Modify: `apps/server/src/agent/__tests__/system-prompt-composition.test.ts` + `apps/server/src/agent/config/__tests__/prompts.test.ts`

**Step 1 (RED):** Update tests — BUILD/VERIFY/PLAN prompts no longer exist as separate composed strings; all agents use `BASE_PROMPT`. Assert `BASE_PROMPT` is the system prompt for build/verify/plan agents.
**Step 2:** In prompts.ts remove `BUILD_PROMPT`/`VERIFY_PROMPT`/`PLAN_PROMPT` and `withBase` (keep `BASE_PROMPT`, `EXPLORE_PROMPT`, `GENERAL_PROMPT`, `DEFAULT_SYSTEM_PROMPT`). Explore/General are subagents — they keep their own composed prompts (not phase-bound).
**Step 3:** server-agents.ts — build/verify/plan agents: `systemPrompt: BASE_PROMPT`. (They still differ in permission + activeToolNames — verify stays edit-denied; add `transition`, remove `ask`.)
**Step 4:** Fix any other imports (grep `BUILD_PROMPT|VERIFY_PROMPT|PLAN_PROMPT`). **Step 5:** `vp run '@sakti-code/server#test'` + `vp check`. **Step 6:** Commit `refactor(server): stable BASE_PROMPT system prompt (role sections dissolve)`.

---

## Phase 4 — Pending-transition state + ws-handler hook

### Task 6: `pendingTransition` state + intercept `transition` calls

**Files:**

- Modify: `packages/db/src/schema.ts` (rename or repurpose `pending_ask_kind`/`pending_ask_body` → `pending_transition_to`/`pending_transition_body`; OR add new columns. **Decision:** add `pendingTransitionTo`/`pendingTransitionBody` alongside, migrate ask usages off, then drop ask columns in a later cleanup task. For now ADD the new columns.)
- Modify: `apps/server/src/agent/ws-handler.ts` (the ask intercept at :202 → add a parallel `transition` intercept)
- Migration folder for the new columns

**Step 1 (RED):** Test: when a `transition` tool-execution*start event fires with `{to:"verify", body:"…"}`, the session gets `pendingTransitionTo:"verify"` set (for gate edges) — and for AUTO edges the hook does NOT set pending (the runner chains immediately). \_Note:* distinguishing gate/auto in the hook requires the transition table — inject `getEdge` into the hook or do the mode-lookup in the runner. **Decision:** the hook records the raw `{to, body}` to pendingTransition; the RUNNER (Task 11) resolves mode + acts. Simpler hook.

**Step 2:** Add `pendingTransitionTo`/`pendingTransitionBody` columns (migration).
**Step 3:** In ws-handler, add a `transition` branch mirroring the ask branch (intercept `tool_execution_start` `toolName==="transition"`, persist `pendingTransitionTo/Body`). Keep the existing ask branch for now (removed in Task 9).
**Step 4:** `vp run '@sakti-code/server#test'`. **Step 5:** Commit `feat(server): pendingTransition state + ws-handler intercept`.

---

## Phase 5 — Gate flow (confirm route)

### Task 7: Rewrite confirm route for transition gates (yes/no)

**Files:**

- Modify: `apps/server/src/routes/sessions/confirm.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`

**Step 1 (RED):** Tests:

- YES on a gate-edge → run that edge's side-effects (status flip; forced observe for build→verify; graduation for plan→mission) + clear pendingTransition + the route returns the updated session.
- **NO** → clear pendingTransition, **no status change, no side-effect** (just dismiss). Assert status unchanged.
- Unknown edge → 400.

**Step 2:** Rewrite confirm.ts: read `pendingTransitionTo` (the edge = current phase → that target). `action: "approve" | "reject"`:

- approve → `getEdge(from, to).onApprove(ctx, sessionId, body)` (move the per-edge side-effect handlers from ask-kinds into the transition table as `onApprove` fns) → clear pending.
- reject (NO) → clear pending ONLY. No status change. No side-effect.
  **Step 3:** Move the live side-effect logic (forced observe, graduation, status flips) from `ask-kinds.ts` into the transition table's per-edge `onApprove` (graduation wired to plan→mission; forceReset to build→verify; status flips to each edge's target).
  **Step 4:** `vp run '@sakti-code/server#test'`. **Step 5:** Commit `feat(server): confirm route yes/no gate semantics`.

---

## Phase 6 — Migrate skills (ask→transition) + remove ask

### Task 8: Rewrite skill handoff instructions

**Files:** `builtin-skills/sakti-plan/SKILL.md`, `sakti-specify/SKILL.md`, `sakti-build/SKILL.md`, `sakti-verify/SKILL.md`

Replace every `ask({ kind: "…" })` instruction with the corresponding `transition({ to: "…" })`:

- sakti-plan: graduation → `transition({ to: "mission", body: <brief> })`.
- sakti-specify: → `transition({ to: "build", body: <spec summary> })`.
- sakti-build: → `transition({ to: "verify", body: <completion summary> })`. (Auto-edge — note it auto-runs verify, no card.)
- sakti-verify: issues → write fixing plan + `transition({ to: "build", body: <fixing plan> })`; clean → `transition({ to: "archive", body: <verify summary incl. mid-run adjustments> })`.
  Also: sakti-build's resume logic (Gap 1) — remove the "all tasks checked → skip to final review" bug; instead, after a verify→build transition, read the fixing plan from the transition call and address each issue.
  Also: add the "batch refinements into the verify summary" guidance to sakti-verify.
  **Commit:** `feat(skills): migrate handoffs to transition tool`.

---

### Task 9: Remove `ask` tool + `ask-kinds.ts` + dead `spec` kind

**Files:**

- Delete: `packages/tools/src/ask/`
- Delete: `apps/server/src/agent/config/ask-kinds.ts` + its test
- Modify: `tool-registry.ts` (remove `ask` factory, add `transition`)
- Modify: `server-agents.ts` activeToolNames (remove `ask`, add `transition`)
- Modify: `ws-handler.ts` (remove the ask intercept branch — transition branch from Task 6 replaces it)
- Modify: `routes/sessions/confirm.ts` (drop the last ask references)
- Migration: drop `pending_ask_kind`/`pending_ask_body` columns (now unused)

Grep `ask` across the server/tools to catch stragglers. `vp run -r test` + `vp check`. **Commit:** `refactor: remove ask tool, replaced by transition`.

---

## Phase 7 — `<instruction>` delivery

### Task 10: Deliver `<instruction>` to the next phase

**Files:**

- Modify: runner (where the next phase's run starts — after auto-chain or gate-approve) — inject the edge's `instruction` template as a system/user message at the start of the next run, alongside the skill injection.
- Modify: `graduation.ts` (plan→mission) — embed the specify-mode `<instruction>` into the mission's handoff user message (the brief).

**Step 1 (RED):** Test: after a build→verify transition, the verify run's context includes `<instruction>You are now in verify mode…</instruction>`. After plan→mission graduation, the mission's first user message contains the brief + `<instruction>You are now in specify mode…</instruction>`.
**Step 2:** Wire `getEdge(from,to).instruction` into the next-run startup (the same place skill injection happens — runner.ts:490 region).
**Step 3:** In graduation, append the specify-mode `<instruction>` to the mission brief.
**Step 4:** Tests green. **Commit:** `feat(server): deliver <instruction> blocks (tool result + handoff message)`.

---

## Phase 8 — Auto-chain engine (the hard core)

### Task 11: Runner post-turn auto-chaining

**Files:** `apps/server/src/agent/runner.ts` (and possibly `ws-handler.ts` run driver)

**Architecture:** After an agent turn ends, the runner inspects: did the turn contain a `transition` call? (read from `pendingTransitionTo` set by the hook, or scan the turn's messages). If yes:

- Resolve the edge (`getEdge(currentPhase, pendingTransitionTo)`).
- **AUTO edge:** run `onApprove` side-effects (status flip, forced observe if flagged) → clear pending → **immediately start the next phase's agent run** (same session; the runner recurses / loops). The next run gets the `<instruction>` (Task 10) + the skill for the new phase.
- **GATE edge:** leave pendingTransition set → the confirm route handles it on user YES/NO. Chain pauses.

**Step 1 (RED):** Integration-style test: simulate build calling `transition({to:"verify"})` → assert status flips to review, forced observe ran, AND the verify agent run was triggered (no manual user message) — i.e. the chain advanced automatically. Then verify calling `transition({to:"build"})` → assert build re-ran automatically. Then verify calling `transition({to:"archive"})` → assert the chain PAUSED (pendingTransition set, no auto-run) — gate.
**Step 2:** Implement the post-turn inspection + auto-chain loop in the runner. Cap recursion depth defensively (a gate must eventually pause). Guard against infinite loops (e.g. a buggy skill that transitions back and forth).
**Step 3:** Tests green. **This is the highest-risk task** — expect iteration; if the run-driver shape makes "start next run from within a run" awkward, explore using a queue/loop in `runAgentStream` rather than naive recursion. **Commit:** `feat(server): auto-chain engine across auto-edges`.

---

## Phase 9 — Runtime guardrail

### Task 12: Phase/progress-aware `<reminder>` injection

**Files:**

- Create: `apps/server/src/agent/reminder.ts`
- Create: `apps/server/src/agent/__tests__/reminder.test.ts`
- Modify: runner (post-turn: if turn ended with NO `transition` call AND phase is autonomous → inject `<reminder>` + re-run)

**Step 1 (RED):** Tests for `buildReminder(phase, progress?)`:

- build + progress `{completed:3,total:5}` → contains "2 of 5 tasks" (or "3/5") + "call transition({to:\"verify\"})".
- verify (no progress) → contains "completeness/correctness/coherence" + the two transition options.
- After cap (2 stalls) → escalation tone; then signal "surface to user".
  **Step 2:** Implement reminder.ts with the phase templates (build progress-aware via `getTaskProgressForChange`; verify phase-aware). Stall counter stored on the session (in-memory or a column — decide; in-memory map keyed by sessionId is simplest, reset on phase change).
  **Step 3:** Wire into runner: autonomous phase + no transition call + turn ended → inject `<reminder>` as a user message + re-run; cap at 2 → stop + surface.
  **Step 4:** Tests green. **Commit:** `feat(server): phase/progress-aware <reminder> guardrail`.

---

## Phase 10 — changeName linkage + progress wiring

### Task 13: Set `changeName` at mission creation (graduation)

**Files:** `graduation.ts`, the session-create route (where the mission spawns)

**Step 1 (RED):** Test: plan→mission graduation sets `changeName` on the new mission session (the plan session knows the change name).
**Step 2:** Wire `changeName` into the mission-create path (the plan→mission gate onApprove creates the mission — pass the change name).
**Step 3:** Tests green. **Commit:** `feat(server): set changeName on mission creation`.

---

### Task 14: Progress-aware build reminder wiring

**Files:** `reminder.ts` (Task 12 left a placeholder) + the sakti-library import

**Step 1 (RED):** Test: a build-phase stall with `session.changeName="x"` + a tasks.md of 5 checkboxes (3 checked) → reminder text includes the real counts from `getTaskProgressForChange`.
**Step 2:** In reminder.ts, resolve the change dir via the project's sakti root (exported in Task 1) + `session.changeName`, call `getTaskProgressForChange`, inject counts. If changeName is null or tasks.md unreadable, fall back to phase-aware (no counts) — never crash.
**Step 3:** Tests green. **Commit:** `feat(server): progress-aware build reminders via sakti library`.

---

## Phase 11 — Verification

### Task 15: Full suite + check + sanity

**Step 1:** `vp run -r test` — only the 3 pre-existing baseline failures.
**Step 2:** `vp check` — 0 errors.
**Step 3:** Sanity greps:

```bash
grep -rn "ask" packages/tools/src --include="*.ts"          # expect: none (ask removed)
grep -rn "ask-kinds\|AskKind" apps/server/src --include="*.ts"  # expect: none
grep -rn 'kind: "session"\|kind: "completion"' apps/server    # expect: none (replaced by transition)
grep -rn "BUILD_PROMPT\|VERIFY_PROMPT\|PLAN_PROMPT" apps/server/src  # expect: none (dissolved)
```

**Step 4:** Commit any final fixes.

---

## Open Items / Risks (flag during implementation)

- **Auto-chain run-driver shape (Task 11):** the hardest piece. "Start the next agent run from within a run" may need a loop/queue in `runAgentStream` rather than recursion. Validate the approach with a minimal spike before full implementation; if it fights the architecture, surface it (don't force a bad shape — 3+ failed attempts = question the approach, per debugging skill).
- **Guardrail stall counter persistence:** in-memory map (lost on restart) vs a column. In-memory is fine for v1; document the tradeoff.
- **Migration ordering:** adding columns (changeName, pendingTransition\*) then dropping ask columns — keep migrations sequential and testable.
- **Skill-injection-at-mission-start still unproven:** the handoff-message `<instruction>` (Task 10) is the robust path; the runner skill injection for the graduated mission should also be validated end-to-end once graduation unblocks.
- **Cap on auto-chain depth:** ensure a buggy skill can't infinite-loop build↔verify; the gate at verify→archive is the natural terminator, but add a defensive max-iterations.
