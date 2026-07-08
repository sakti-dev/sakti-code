# Plan/Specify Phase Split — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split plan/specify phase ownership (plan=proposal only, specify=specs+design+tasks), collapse tweak→hotfix, rename design→specify, make skills the single source of truth (neutral prompts), and fix the plan-graduation ask bug.

**Architecture:** State-machine + schema changes in `packages/sakti` (foundation), prompt neutralization + phase-skill routing in `apps/server`, then skill content rewrites (the behavior owners). The phase flow UNIFIES: both workflows now follow `open→specify→build→verify→archive`; `workflow` only selects the specify MODE (brainstorming vs autonomous) and build-phase defaults — it no longer changes the phase sequence.

**Tech Stack:** TypeScript, Zod (schema), Vitest (tests), Markdown skills, `vp` toolchain (check/test).

**Design doc:** `docs/plans/2026-07-08-plan-specify-phase-split.md`

**Key commands:**

- Single-package test: `vp run '@sakti-code/sakti#test'` (note: the sakti package may be named differently — run `vp run -r test` to run all; verify package name with `ls packages/`)
- Full check: `vp check`
- Test-fix: `vp check --fix`

**Conventions:** TDD (test first → fail → implement → pass → commit). `exactOptionalPropertyTypes: true`. Tests colocated in `__tests__/`. Never `.only`/`.skip`.

---

## Phase 1 — Schema & state machine (packages/sakti)

These are foundational; everything references the new names. Do them first, in order.

### Task 1: Drop `tweak` workflow

**Files:**

- Modify: `packages/sakti/src/sdd/core/change-metadata/schema.ts:27`
- Modify: `packages/sakti/src/sdd/core/change-metadata/workflow-defaults.ts:27-35`
- Modify: `packages/sakti/src/sdd/commands/__tests__/state.test.ts:113` (seed type)
- Modify: `packages/sakti/src/sdd/core/change-metadata/__tests__/workflow-defaults.test.ts:25-31`
- Modify: `packages/sakti/src/sdd/program.ts:328` (CLI help text)

**Step 1: Update workflow-defaults tests (RED).** In `workflow-defaults.test.ts`, delete the "returns tweak defaults" test (lines 25-31). Run: `vp run '@sakti-code/sakti#test' -- workflow-defaults` → expected: the remaining tests still pass (we only removed a test). This step is removal, not RED; move on.

**Step 2: Drop `tweak` from the schema.** In `schema.ts:27`:

```ts
export const WorkflowSchema = z.enum(["full", "hotfix"]);
```

**Step 3: Drop the `tweak` case in workflow-defaults.ts.** Remove the `case "tweak":` fallthrough so only `hotfix` maps to the direct/branch/light preset:

```ts
case "hotfix":
  return {
    ...base,
    build_mode: "direct",
    review_mode: "off",
    isolation: "branch",
    verify_mode: "light",
  };
```

**Step 4: Fix the `seed` helper type in state.test.ts:113** — change `"full" | "hotfix" | "tweak"` to `"full" | "hotfix"`.

**Step 5: Update CLI help text** in `program.ts:328` — change `"full (default), hotfix, or tweak"` to `"full (default) or hotfix"`.

**Step 6: Run tests + check.** `vp run '@sakti-code/sakti#test'` and `vp check`. Fix any remaining `tweak` references the compiler/typecheck surfaces (grep `tweak` across `packages/sakti/src`).

**Step 7: Commit.**

```bash
git add -A && git commit -m "feat(sakti): drop tweak workflow, collapse to full/hotfix"
```

---

### Task 2: Rename phase `design`→`specify` + transition `design-complete`→`specify-complete`

**Files:**

- Modify: `packages/sakti/src/sdd/core/change-metadata/schema.ts:30,33-41`
- Modify: `packages/sakti/src/sdd/commands/state.ts:149,154-170`
- Modify: `packages/sakti/src/sdd/commands/__tests__/state.test.ts` (all `design`/`design-complete` references)

**Step 1: Update state.test.ts tests (RED).** Rename every `"design"` phase → `"specify"` and `"design-complete"` → `"specify-complete"` in the transition tests (lines 133-185). Update test names too (e.g. "open-complete advances to specify..."). Run tests → expected FAIL (schema still has `design`).

**Step 2: Rename in schema.ts.**

- Line 30: `export const PhaseSchema = z.enum(["open", "specify", "build", "verify", "archive"]);`
- Lines 33-41: rename `"design-complete"` → `"specify-complete"` in `StateTransitionEventSchema`.

**Step 3: Rename in state.ts.** Line 149: `const nextPhase = "specify";` (see Task 4 — this line gets fully rewritten there; for now just rename to keep compile green). Lines 154-170: `case "specify-complete":` and `requirePhase("specify")`.

**Step 4: Grep for any other `"design"` phase or `"design-complete"` references** in `packages/sakti/src` (excluding `design_doc`, which is Task 3, and `design.md` artifact which stays). Update them.

**Step 5: Run tests → GREEN.** `vp run '@sakti-code/sakti#test'`.

**Step 6: Commit.**

```bash
git add -A && git commit -m "refactor(sakti): rename design phase to specify"
```

---

### Task 3: Drop `design_doc` field + collapse to single design.md

**Files:**

- Modify: `packages/sakti/src/sdd/core/change-metadata/schema.ts:80`
- Modify: `packages/sakti/src/sdd/commands/state.ts:154-170` (the validation block)
- Modify: `packages/sakti/src/sdd/commands/__tests__/state.test.ts:166-185`

**Step 1: Update state.test.ts (RED).** Replace the three `design-complete`/`design_doc` tests (lines 166-185) with `specify-complete` tests that require `design.md` + `tasks.md` to exist (no `design_doc` field):

```ts
it("specify-complete requires design.md and tasks.md", async () => {
  seed("full", "specify");
  await expect(
    stateTransition(changeDir, "specify-complete", { projectRoot: tmpDir }),
  ).rejects.toThrow(/design\.md|tasks\.md/i);
});

it("specify-complete advances to build when design.md + tasks.md exist", async () => {
  seed("full", "specify");
  await fs.writeFile(path.join(changeDir, "design.md"), "# Design");
  await fs.writeFile(path.join(changeDir, "tasks.md"), "# Tasks");
  await stateTransition(changeDir, "specify-complete", { projectRoot: tmpDir });
  expect(await readField("phase")).toBe("build");
});
```

Run → expected FAIL.

**Step 2: Drop `design_doc` from ChangeMetadataSchema** (schema.ts:80). Remove the `design_doc: z.string().nullable().default(null),` line.

**Step 3: Rewrite the specify-complete case in state.ts** (was design-complete, lines 154-170). Replace the `design_doc` field check + file access with artifact existence checks:

```ts
case "specify-complete": {
  requirePhase("specify");
  for (const artifact of ["design.md", "tasks.md"]) {
    try {
      await fs.access(path.join(changeDir, artifact));
    } catch {
      throw new Error(
        `Cannot transition 'specify-complete': ${artifact} must exist before leaving specify`,
      );
    }
  }
  apply({ phase: "build" });
  break;
}
```

**Step 4: Grep for `design_doc`** across `packages/sakti/src` and `apps/server/src` — remove all remaining references (state get/set field lists, any docs). The field no longer exists.

**Step 5: Run tests → GREEN.** `vp run '@sakti-code/sakti#test'` + `vp check`.

**Step 6: Commit.**

```bash
git add -A && git commit -m "refactor(sakti): drop design_doc, specify-complete requires design.md+tasks.md"
```

---

### Task 4: Unify open-complete (always→specify, only proposal.md)

This is the core state-machine behavior change: both workflows now go open→specify.

**Files:**

- Modify: `packages/sakti/src/sdd/commands/state.ts:134-152`
- Modify: `packages/sakti/src/sdd/commands/__tests__/state.test.ts:133-164`

**Step 1: Update state.test.ts (RED).** Rewrite the open-complete tests to reflect unified flow:

```ts
it("open-complete advances to specify when proposal.md exists", async () => {
  seed("full", "open");
  await fs.writeFile(path.join(changeDir, "proposal.md"), "# proposal");
  await stateTransition(changeDir, "open-complete", { projectRoot: tmpDir });
  expect(await readField("phase")).toBe("specify");
});

it("open-complete advances to specify for hotfix too (no longer skips)", async () => {
  seed("hotfix", "open");
  await fs.writeFile(path.join(changeDir, "proposal.md"), "# proposal");
  await stateTransition(changeDir, "open-complete", { projectRoot: tmpDir });
  expect(await readField("phase")).toBe("specify");
});

it("open-complete fails when proposal.md is missing", async () => {
  seed("full", "open");
  await expect(
    stateTransition(changeDir, "open-complete", { projectRoot: tmpDir }),
  ).rejects.toThrow(/proposal/i);
});

it("open-complete fails when phase is not open", async () => {
  seed("full", "specify");
  await expect(
    stateTransition(changeDir, "open-complete", { projectRoot: tmpDir }),
  ).rejects.toThrow(/phase/i);
});
```

Run → expected FAIL (old code requires design.md+tasks.md for full, and routes hotfix to build).

**Step 2: Rewrite open-complete in state.ts** (lines 134-152):

```ts
case "open-complete": {
  requirePhase("open");
  // Plan phase produces only proposal.md; specify phase produces the rest.
  try {
    await fs.access(path.join(changeDir, "proposal.md"));
  } catch {
    throw new Error(
      "Cannot transition 'open-complete': proposal.md must exist before leaving open",
    );
  }
  // Both workflows now pass through specify (hotfix in autonomous mode).
  apply({ phase: "specify" });
  break;
}
```

**Step 3: Run tests → GREEN.** `vp run '@sakti-code/sakti#test'`.

**Step 4: Commit.**

```bash
git add -A && git commit -m "refactor(sakti): unify open-complete, both workflows pass through specify"
```

---

### Task 5: Remove Capabilities section from proposal template

**Files:**

- Modify: `packages/sakti/schemas/spec-driven/schema.yaml:9-27` (proposal artifact instruction)

**Step 1: Edit the proposal artifact instruction.** Remove the entire **Capabilities** bullet block (the "New Capabilities"/"Modified Capabilities" guidance + the "IMPORTANT: The Capabilities section is critical..." paragraph). The proposal becomes WHY/WHAT/Impact only. Keep the Why, What Changes, and Impact bullets. Add a one-line note: _"Capability/spec planning happens in the specify phase."_

**Step 2: Verify schema still parses.** Run: `vp run '@sakti-code/sakti#test' -- schema` (or any test that loads the spec-driven schema). The artifact graph must still validate (no dependency breakage — proposal still has `requires: []`).

**Step 3: Commit.**

```bash
git add -A && git commit -m "feat(sakti): drop Capabilities from proposal, move to specify phase"
```

---

## Phase 2 — Server config (apps/server): neutral prompts + routing

### Task 6: Delete SPEC_PROMPT, neutralize PLAN/BUILD/VERIFY prompts

**Files:**

- Modify: `apps/server/src/agent/config/prompts.ts:52-94`
- Modify: `apps/server/src/agent/config/index.ts:11` (re-export removal)

**Step 1: Delete SPEC_PROMPT** (prompts.ts:57-60). Remove the `export const SPEC_PROMPT = ...` block entirely.

**Step 2: Remove SPEC_PROMPT re-export** in index.ts:11.

**Step 3: Neutralize PLAN_PROMPT** (prompts.ts:80-94). Replace the body (keep `withBase`) with neutral role framing + deferral:

```ts
export const PLAN_PROMPT = withBase(`# Your role: Plan agent
You help users plan work before a mission session is created: discuss features/fixes, research feasibility, and shape a rough plan.

Follow the injected sakti-plan skill for your full workflow — including classification, artifact creation, and how to hand off. The skill is the single source of truth for your behavior.`);
```

**Step 4: Neutralize BUILD_PROMPT** (prompts.ts:52-55). This agent serves specify/build/archive phases:

```ts
export const BUILD_PROMPT = withBase(`# Your role: Build agent
You execute work across the specify, build, and archive phases.

Follow the injected phase skill (sakti-specify, sakti-build, or sakti-archive) for your full workflow and handoff. The skill is the single source of truth for your behavior in the current phase.`);
```

**Step 5: Neutralize VERIFY_PROMPT** (prompts.ts:62-70):

```ts
export const VERIFY_PROMPT = withBase(`# Your role: Verify agent
You review completed work for bugs, completeness, and coherence. You are edit-denied: report issues, do not fix them.

Follow the injected sakti-verify skill for your full workflow and handoff. The skill is the single source of truth for your behavior.`);
```

**Step 6: Grep for SPEC_PROMPT usages** across `apps/server/src` — confirm none remain (it was dead code; only the export + index re-export referenced it).

**Step 7: Run check.** `vp check`. Fix any test that snapshot-asserted the old prompt text.

**Step 8: Commit.**

```bash
git add -A && git commit -m "refactor(server): neutral prompts, delete dead SPEC_PROMPT"
```

---

### Task 7: Update phase-skills.ts routing + server-agents.ts

**Files:**

- Modify: `apps/server/src/agent/config/phase-skills.ts:34-44`
- Modify: `apps/server/src/agent/config/server-agents.ts:129`

**Step 1: Update PHASE_TO_SKILL in phase-skills.ts.** Rename keys/values:

```ts
const PHASE_TO_SKILL: Readonly<Record<string, BuiltinSkillName>> = {
  plan: "sakti-plan",
  specify: "sakti-specify",
  specifying: "sakti-specify",
  build: "sakti-build",
  building: "sakti-build",
  verify: "sakti-verify",
  review: "sakti-verify",
  archive: "sakti-archive",
  merged: "sakti-archive",
};
```

Also update `BUILTIN_SKILL_NAMES` (line 10-16): replace `"sakti-design"` with `"sakti-specify"`.

**Step 2: Update server-agents.ts:129** — the plan agent description currently says "Calls ask(kind=session) to hand off". Change to: _"PM-style planning agent for scoping work before implementation. Follows the sakti-plan skill for workflow and handoff."_

**Step 3: Run check.** `vp check` + `vp run '@sakti-code/server#test'`.

**Step 4: Commit.**

```bash
git add -A && git commit -m "refactor(server): route specify phase to sakti-specify skill"
```

---

## Phase 3 — Skills (builtin-skills): the behavior owners

> **Skill discovery note:** Before Task 9, check how `installBuiltinSkills` discovers skills (dir name vs frontmatter `name`). The rename must keep dir name, frontmatter `name`, and phase-skills reference aligned. Grep `installBuiltinSkills` to confirm.

### Task 8: Rewrite sakti-plan/SKILL.md

**Files:**

- Modify: `apps/server/src/agent/config/builtin-skills/sakti-plan/SKILL.md`

**Required content changes (the skill is now the single source of truth):**

1. **Add classification as a first-class step.** After exploration (Step 1), before/within name confirmation (Step 2), add a blocking point where the agent proposes a workflow:
   - Signal: "does this need a spec/behavior change?" yes→`full`, no→`hotfix`
   - Hybrid propose+confirm via `ask` (open question, no kind) presenting the prediction + name; user confirms or overrides.
   - Pass to CLI: `sakti new change "<name>" --workflow <full|hotfix>`.

2. **Strip all artifact creation except proposal.md.** Remove Step 3b/3c (specs/design/tasks creation, the dependency-order artifact loop, the `sakti status` artifact-graph flow). Plan produces ONLY lightweight proposal.md (Why/What Changes/Impact — no Capabilities). Reference: the proposal template no longer has Capabilities (Task 5).

3. **Make graduation an explicit `ask` call.** Replace the entire "Exit & Handoff" section (the "print a handoff block" text template) with:

   > "When the plan is confirmed, call `ask({ kind: "session", body })` where `body` is a self-contained mission brief (what to build, why, key files/constraints discovered, the rough plan, and the chosen workflow). `body` becomes the mission's first prompt. The `proposed-session` card is the handoff UI — do not print a handoff text block. After calling `ask`, your turn ends."

4. **Make every blocking point use `ask` concretely.** Replace the vague "Use the current platform's question or confirmation tool" in Decision Points with: "Call the `ask` tool. For an open choice (name/workflow confirmation, review revisions), omit `kind`. For graduation, use `kind: "session"`. Never end a blocking point with plain text."

5. **Update the open-complete transition note** in any handoff text to reflect: plan → `sakti state transition <name> open-complete` advances to the **specify** phase.

6. **Update the "Common Mistakes" table** — add: "Printing a handoff text block instead of calling `ask({ kind: "session" })`" → "Graduation requires the ask call; text does not set the pending ask or render the card."

**Step 1: Write the new SKILL.md** following the structure above. Keep the existing exploration.md reference.

**Step 2: Verify it loads.** `vp check`. Manually confirm frontmatter `name: sakti-plan` and the file parses.

**Step 3: Commit.**

```bash
git add -A && git commit -m "feat(skills): rewrite sakti-plan — classify, proposal-only, ask graduation"
```

---

### Task 9: Rename sakti-design → sakti-specify (dir + frontmatter)

**Files:**

- Rename: `apps/server/src/agent/config/builtin-skills/sakti-design/` → `sakti-specify/`

**Step 1: Check installBuiltinSkills discovery.** `grep -rn installBuiltinSkills apps/server/src` — confirm whether it scans the builtin-skills dir by folder name or reads frontmatter. This determines if the rename is purely filesystem or needs a registry update.

**Step 2: `git mv` the directory:**

```bash
git mv apps/server/src/agent/config/builtin-skills/sakti-design apps/server/src/agent/config/builtin-skills/sakti-specify
```

**Step 3: Update frontmatter** in `sakti-specify/SKILL.md`: `name: sakti-design` → `name: sakti-specify`.

**Step 4: Grep for `sakti-design`** across the repo (excluding this plan + the design doc) — update all references to `sakti-specify`. (phase-skills.ts already done in Task 7; check tests, other skills, docs.)

**Step 5: Run check.** `vp check`.

**Step 6: Commit.**

```bash
git add -A && git commit -m "refactor(skills): rename sakti-design directory to sakti-specify"
```

---

### Task 10: Rewrite sakti-specify/SKILL.md (two modes + single design.md)

**Files:**

- Modify: `apps/server/src/agent/config/builtin-skills/sakti-specify/SKILL.md`

**Required content changes:**

1. **Entry: branch on workflow.** Step 1 reads the change's `workflow` field (`sakti state get <name> workflow`).
   - `full` → follow `references/brainstorming.md` (brainstorming mode).
   - `hotfix` → follow `references/autonomous.md` (autonomous mode).

2. **Brainstorming mode (full):** interactive — ask user one question at a time, explore codebase, propose approaches, blocking confirm. Produces specs (delta) + design.md + tasks.md.

3. **Autonomous mode (hotfix):** no "how to fix it?" questions — drive the complete solution as far as possible independently. Produces design.md + tasks.md. Writes NO specs file unless a real delta is discovered.

4. **Escalation (hotfix→full):** if autonomous mode discovers a behavior change/new spec is needed:
   - Flip workflow: `sakti state set <name> workflow full`
   - Switch to brainstorming mode (follow references/brainstorming.md)
   - Ask the user how to design the spec change.

5. **Single design.md (drop technical-design.md).** Remove all references to `technical-design.md` and the `design_doc` state field. The specify phase produces ONE `design.md` (Context, Technical Approach/Architecture/Data Flow/Key Decisions, Alternatives, Risks & Mitigations, Testing Strategy, Open Questions). Remove Step 7a (`sakti state set <name> design_doc ...`).

6. **tasks.md is mandatory (both modes).** Always end with a tasks.md. Keep the checkbox format (build phase parses it).

7. **Transition:** `sakti state transition <name> specify-complete` (requires design.md + tasks.md to exist — Task 3). Drop the old `design-complete`.

8. **End-of-specify blocking confirm (both modes):** via `ask` (open question) — present design.md + tasks.md summary; user confirms or requests adjustments before the transition.

9. **Update "Do NOT use when" / prerequisites** — phase is now `specify` (not `design`); drop the "hotfix/tweak skip design phase" note (hotfix now uses autonomous mode within specify).

**Step 1: Rewrite SKILL.md** per above. Update references/brainstorming.md content if it mentions "design phase"/"technical-design.md"/"design_doc" (rename to specify, drop technical-design.md refs).

**Step 2: `vp check`.**

**Step 3: Commit.**

```bash
git add -A && git commit -m "feat(skills): rewrite sakti-specify — two modes, single design.md, escalation"
```

---

### Task 11: Create sakti-specify/references/autonomous.md

**Files:**

- Create: `apps/server/src/agent/config/builtin-skills/sakti-specify/references/autonomous.md`

**Required content:** The autonomous-mode guide. Key points:

- **No brainstorming, no "how should we fix this?" questions to the user.** Drive the complete solution independently.
- Read the proposal.md + existing specs + codebase to understand the problem.
- Produce design.md (the technical solution) + tasks.md (checkbox tasks).
- Write specs ONLY if you discover a real spec delta — and if you do, **escalate** (flip workflow to full, switch to brainstorming mode, ask the user).
- Ground the solution in actual code (read files, don't theorize).
- One blocking point only: the end-of-specify confirm (via `ask`) before `specify-complete`.
- Keep it focused — autonomous mode is for changes where the path is clear (bug fix, small improvement).

**Step 1: Write the file.**

**Step 2: Commit.**

```bash
git add -A && git commit -m "feat(skills): add sakti-specify autonomous mode reference"
```

---

### Task 12: sakti-build/SKILL.md owns the completion handoff

**Files:**

- Modify: `apps/server/src/agent/config/builtin-skills/sakti-build/SKILL.md`

**Step 1: Audit + add the handoff instruction.** The `ask({ kind: "completion" })` instruction moved out of BUILD*PROMPT (Task 6). Ensure sakti-build SKILL.md explicitly owns it: *"When your work is complete and verified, call `ask({ kind: "completion", body })` where `body` summarizes what changed and how it was verified. If blocked or needing a decision, call `ask` without a `kind`. After calling `ask`, your turn ends."\_ Remove any text-block handoff (mirror of the plan bug — audit for it).

**Step 2: Commit.**

```bash
git add -A && git commit -m "feat(skills): sakti-build owns ask(completion) handoff"
```

---

### Task 13: sakti-verify/SKILL.md owns the verify-complete handoff

**Files:**

- Modify: `apps/server/src/agent/config/builtin-skills/sakti-verify/SKILL.md`

**Step 1: Ensure the skill owns `ask({ kind: "verify-complete", body })`** (moved out of VERIFY_PROMPT in Task 6). Add explicit instruction mirroring Task 12. Audit for any text-block handoff bug (same class as plan).

**Step 2: Commit.**

```bash
git add -A && git commit -m "feat(skills): sakti-verify owns ask(verify-complete) handoff"
```

---

### Task 14: Audit/fix sakti-archive/SKILL.md handoff

**Files:**

- Modify: `apps/server/src/agent/config/builtin-skills/sakti-archive/SKILL.md`

**Step 1: Read sakti-archive/SKILL.md.** Check whether it has the same text-block-handoff bug as sakti-plan did (instructing text instead of the proper lifecycle mechanism). The archive phase likely transitions via CLI (`sakti state transition <name> archived`) — confirm; if it uses `ask`, ensure the kind is correct; if text, fix to the proper mechanism.

**Step 2: Apply the single-source-of-truth principle** — ensure the skill owns its full handoff behavior, neutral prompt defers to it.

**Step 3: Commit.**

```bash
git add -A && git commit -m "feat(skills): sakti-archive handoff audit/fix"
```

---

## Phase 4 — Verification

### Task 15: Full suite + check

**Step 1:** `vp run -r test` — all packages pass. Note: 3 pre-existing `packages/sakti` CLI interactive-test failures (inquirer-removal commit `372278c57`) are unrelated baseline failures — confirm they're the same 3, not new.

**Step 2:** `vp check` — 0 errors.

**Step 3:** Grep sanity checks (no stale references):

```bash
grep -rn "tweak" packages/sakti/src apps/server/src --include="*.ts"   # expect: none
grep -rn '"design"' packages/sakti/src --include="*.ts"                # expect: none (design.md refs OK)
grep -rn "design_doc" packages apps --include="*.ts"                   # expect: none
grep -rn "technical-design" apps/server                                # expect: none
grep -rn "sakti-design" apps/server                                    # expect: none (except design doc/plan)
```

**Step 4: Commit any final fixes.**

```bash
git add -A && git commit -m "test: full suite green after plan/specify split"
```

---

## Open Items (verify during implementation, flag if blocking)

- **installBuiltinSkills discovery** (Task 9): confirm dir-name vs frontmatter so the rename doesn't break boot-time skill sync.
- **Migration of existing changes:** any `.sakti/changes/` rows with `phase: design` or `design_doc` set will fail state reads after the rename. Likely a non-issue (early project, no real data) — but if a real change exists, it needs `phase: design→specify` and `design_doc` dropped. Flag if found.
- **`ask` kind `spec`:** now that specify transitions via CLI (not ask), verify whether `kind: "spec"` in ask-kinds.ts is still used anywhere. If dead, note for a follow-up cleanup (do NOT remove spec wiring unless confirmed dead — it may serve mission specifying status).
