# Plan/Specify Phase Split + Workflow Classification

**Date:** 2026-07-08
**Status:** Design approved — pending implementation plan

## Problem

Two connected issues with the current planning workflow:

1. **sakti-plan does too much.** It creates all four artifacts (proposal.md, specs/, design.md, tasks.md) in the plan phase. The user wants plan to produce only a rough plan; the detailed specification work belongs in the next phase.

2. **LLM never graduates plan sessions.** Root-caused in session `37af2966` (fumadocs-solid-foundation): the sakti-plan skill's "Exit & Handoff" instructs the agent to _print a text handoff block_ ("Planning complete..."), which directly contradicts `PLAN_PROMPT`'s instruction to call `ask({ kind: "session" })`. The skill (more specific, injected later) wins, so `ask` is never called (0 calls across 25 turns), `pending_ask_kind` stays null, no `proposed-session` card renders, and graduation never fires. The user typing "approved" as free text does nothing.

Both issues share a root cause: **two sources of truth (system prompt + skill) that drift.**

## Guiding Principle: Skill Is Single Source of Truth

Builtin phase skills are **force-injected per phase** (phase-skills.ts → runner.ts), so the skill is guaranteed present for every session. Therefore the skill can and should be the single source of truth for phase behavior. System prompts reduce to neutral role framing + deferral. This eliminates the drift class of bugs entirely.

## Decisions

### 1. Workflow model — collapse to 2

| Workflow | Meaning                                                                       | Specify-phase mode          |
| -------- | ----------------------------------------------------------------------------- | --------------------------- |
| `full`   | Predicted to need a spec/behavior change                                      | Brainstorming (interactive) |
| `hotfix` | Predicted no spec change — bug fix or small improvement (absorbs old `tweak`) | Autonomous                  |

`tweak` is removed from the `Workflow` type. The hotfix/tweak distinction was purely semantic — both had identical state-machine defaults (direct/branch/light). The one decidable axis that drives different behavior is "does this change touch specs?" — that becomes the classification signal.

### 2. Phase → artifact ownership (the core fix)

Current bug: sakti-plan creates all 4 artifacts. New ownership:

- **Plan** (sakti-plan): produces **only `proposal.md`** — lightweight, WHY/WHAT/scope. The Capabilities section is removed from the proposal template (spec planning moves into the specify phase).
- **Specify** (sakti-specify, formerly sakti-design): produces **specs/ (only if delta) + design.md + tasks.md**. Both modes always end with design.md + tasks.md.
- **Build/Verify/Archive**: unchanged.

### 3. Design phase → "specify" rename

The DB `status` was already `"specifying"` for this phase; the phase enum value `"design"` was a misnamed alias. Renaming aligns them and frees "design" for a future frontend design skill (naming collision avoidance).

- `PhaseSchema`: `"design"` → `"specify"` (change-metadata/schema.ts)
- transition `"design-complete"` → `"specify-complete"` (schema.ts, state.ts)
- skill `sakti-design` → `sakti-specify` (dir + name + phase-skills.ts)
- `state.ts`: `nextPhase = ... ? "design" : "build"` → `"specify"`
- **KEEP `design.md`** as the artifact filename — it's a file in the change dir (not a skill), zero collision risk, and descriptive of content.
- The `design_doc` state field + its validation block (state.ts:158-165) is **deleted** (see decision 6), not renamed.

No change to DB `status` (already `"specifying"`).

### 4. Classification (new plan-phase blocking point)

After exploration, alongside name confirmation, the agent proposes a workflow:

- **Signal:** "does this look like it needs a spec/behavior change?" yes → `full`, no → `hotfix`
- **Hybrid propose+confirm** — agent proposes, user confirms or overrides. Matches the skill's existing blocking-point pattern.
- Passed via `sakti new change "<name>" --workflow <full|hotfix>`
- **Classification is a prediction that self-corrects** via escalation (decision 5).

### 5. Specify phase — one skill, two modes

`sakti-specify` branches on the change's `workflow`:

- **`full` → brainstorming mode**: reads existing `references/brainstorming.md`. Interactive: ask user, explore approaches, blocking confirm. Produces specs (delta) + design.md + tasks.md.
- **`hotfix` → autonomous mode**: reads **new `references/autonomous.md`**. No "how to fix it?" questions — drives the complete solution as far as possible on its own. Produces design.md + tasks.md. Writes **no** specs file unless a real delta is found.

Same skill, no re-wiring — escalation just switches which reference is followed.

### 6. Escalation: hotfix → full

When autonomous mode discovers the change actually needs a behavior change or new spec:

1. **Flip `workflow` `hotfix`→`full`** on the change (honest records — the prediction was wrong)
2. Switch to brainstorming mode (follow `references/brainstorming.md`)
3. Ask the user how they want to design the spec change
4. Proceed to produce specs (delta) + design.md + tasks.md

### 7. Mandatory artifacts + collapsed design doc

- **`tasks.md` is always required** (both modes) — foundation for the future subagent work-package model (N tasks → N subagents, each given task + design.md). Dispatch is NOT implemented now; this only guarantees tasks.md exists.
- **Single `design.md`** — collapse the old `design.md` (phase-1 high-level) + `technical-design.md` (phase-2 deep) into one. Drop `technical-design.md` and the `design_doc` state field + its transition validation.
- **specs written only when there's a real delta** — full usually writes some; hotfix writes none unless escalated.
- **End-of-specify blocking confirm (both modes)** — review design.md + tasks.md before build.

### 8. Single source of truth — neutral prompts

System prompts reduced to neutral role framing + deferral. All phase-specific behavior (workflow, handoff, ask calls) lives in the skill.

| Agent                 | System prompt                   | Phase skill(s) injected                     | Handoff owned by skill                                                                |
| --------------------- | ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `plan`                | neutral PLAN_PROMPT             | sakti-plan                                  | `ask({ kind: "session" })`                                                            |
| `build`               | neutral BUILD_PROMPT            | sakti-specify / sakti-build / sakti-archive | specify→`specify-complete` CLI; build→`ask({ kind: "completion" })`; archive→(verify) |
| `verify`              | neutral VERIFY_PROMPT           | sakti-verify                                | `ask({ kind: "verify-complete" })`                                                    |
| `explore` / `general` | unchanged (subagents, no phase) | —                                           | —                                                                                     |

The `build` agent serves three phases (specify/build/archive) via skill injection — the neutral prompt + correct skill = correct behavior, no drift. (Archive riding on the build agent is the existing pattern, consistent with specify.)

### 9. The ask/graduation fix

- **sakti-plan Exit & Handoff**: replace the "print handoff block" text template with a single instruction — "call `ask({ kind: "session", body })` where `body` is the self-contained mission brief." The `proposed-session` card _is_ the handoff UI; no text block.
- **All blocking points use `ask` explicitly** — name/scope confirmation, final review, graduation. Never the vague "current platform's question tool" and never free text masquerading as a gate.
- The lifecycle ask-kinds are unchanged: `session` (plan→mission), `spec`, `completion` (build→verify), `verify-complete` (verify→merged). Note: the specify phase transitions via `sakti state transition ... specify-complete` (CLI), not via an ask kind.

### 10. Delete dead code

- `SPEC_PROMPT` (prompts.ts:57) — defined but never wired to any agent. Delete.

### 11. Loosen transition gate

`open-complete` currently gates on artifacts that plan no longer produces. Since plan now produces only proposal.md, `open-complete`'s gate loosens to **only require proposal.md**.

## Files Touched (scoping, not exhaustive)

**packages/sakti (schema + state machine):**

- `change-metadata/schema.ts` — PhaseSchema `design`→`specify`; transitions `design-complete`→`specify-complete`; drop `design_doc` field
- `change-metadata/workflow-defaults.ts` — remove `tweak` case
- `commands/state.ts` — rename transition + phase checks; delete `design_doc` validation block; loosen `open-complete` gate
- `schemas/spec-driven/schema.yaml` — proposal template: drop Capabilities section
- Workflow type definition (wherever `Workflow = "full"|"hotfix"|"tweak"` lives) — drop `tweak`

**apps/server/src/agent/config:**

- `prompts.ts` — neutralize PLAN_PROMPT/BUILD_PROMPT/VERIFY_PROMPT; delete SPEC_PROMPT
- `phase-skills.ts` — `design`→`specify`, `sakti-design`→`sakti-specify`
- `server-agents.ts` — plan agent description update (s/ask(kind=session)/via skill/)
- `ask-kinds.ts` — minor reference updates if any
- `skill-injection.ts` — no change (mechanism is name-driven)

**builtin skills:**

- `sakti-plan/SKILL.md` — rewrite: add classification blocking point; pass `--workflow`; produce ONLY proposal.md; graduation via `ask({kind:"session"})`; concrete ask-based blocking points
- `sakti-design/` → `sakti-specify/` — rename dir + SKILL.md name; rewrite: branch on workflow (brainstorming vs autonomous); single design.md; escalation procedure; end-of-specify confirm
- `sakti-specify/references/autonomous.md` — NEW (autonomous-mode guide)
- `sakti-build/SKILL.md` — own the `ask({kind:"completion"})` handoff (was in BUILD_PROMPT)
- `sakti-verify/SKILL.md` — own the `ask({kind:"verify-complete"})` handoff (was in VERIFY_PROMPT)
- `sakti-archive/SKILL.md` — own its handoff (verify any text-vs-ask issue, mirror of the plan bug)

## Open Questions for Implementation

- Does `sakti-archive` have the same latent text-vs-ask handoff bug as sakti-plan did? Audit during implementation.
- The `ask` kind `spec` (specifying mission spec approval) — is it still used anywhere now that specify-phase transitions via CLI? Verify; may be dead.
