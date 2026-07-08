# Phase Transition System

**Date:** 2026-07-08
**Status:** Design approved — pending implementation plan
**Builds on:** `2026-07-08-plan-specify-phase-split.md` (the phase/skill split shipped just before this)

## Problem

Two connected issues with today's `ask`-based lifecycle:

1. **Gating policy lives in skill prose, where it drifts.** The plan-graduation bug (session `37af2966`) happened because the sakti-plan skill told the agent to _print a handoff block_ while `PLAN_PROMPT` said to _call `ask({kind:"session"})`_. Two sources drifted; the skill won; graduation never fired. The same drift risk exists across build/verify.

2. **No auto-run, and the loop doesn't actually close.** Every transition today requires the user to type a WS message — the confirm route only flips status. And the build↔verify loop is broken on resume: after a verify-reject, build's skill sees all tasks checked and skips straight to "final review" → re-completes without fixing → infinite loop. Plus verify→build→verify re-reads files because the forced observe pruned build's prior reads.

## Guiding Principles

- **Single source of truth for gating policy.** A server-side table declares each phase edge as gate or auto — not skill prose, not the agent. (Same structural move we just made for prompts.)
- **The agent's only job is deciding the destination**, not remembering gating rules. The destination encodes the decision.
- **Interactive vs autonomous phases.** Some phases legitimately pause for user Q&A; others must run to completion. The runtime treats them differently.
- **Sakti as a library, not just a CLI.** The runtime imports SDD helpers (`task-progress`, change metadata) to become SDD-aware, so it can produce progress-aware nudges instead of blind reminders.

## The Tool

`transition` replaces `ask` for all lifecycle transitions. **The `ask` tool is removed entirely.**

```
transition({ to: "specify" | "build" | "verify" | "archive" | "mission", body: string })
```

- Single param `to` (destination phase) + a `body` (context: a mission brief, a fixing plan, a verification summary).
- Returns `terminate: true` (ends the turn cleanly, like `ask` did). The tool **result** is an `<instruction>` block (see "System Prompt & Mode Instructions" below) that orients the next run to its new phase.
- The agent decides the **destination** based on its judgment (e.g. verify clean → `to: archive`; verify found issues → `to: build`). It does **not** decide gate-vs-auto. The `body` (fixing plan / brief / summary) travels in the tool _call args_ (already in the transcript); the `<instruction>` is the _result_.

**Open questions become free-text conversation.** Until a dedicated `question` tool is built (deferred, separate work), an agent that needs to ask the user something mid-phase simply ends its turn with a text question and the user replies via WS. This is fine because the _autonomous_ phases (where the guardrail fires) are not allowed to pause for questions anyway — refinements are batched into the verify summary.

## System Prompt & Mode Instructions (cache-safe)

**The cache problem today.** The system prompt is `BASE_PROMPT + role section`, and the build↔verify loop **swaps agents every transition** (build agent → verify agent). Each swap changes the system prompt → **cache miss from the system prompt onward** → the whole prefix re-processes, every loop iteration — expensive exactly where the loop runs hottest.

**The fix.** The system prompt becomes **stable**: just `BASE_PROMPT`, identical across every phase and every agent swap. The per-role prompt sections (`BUILD_PROMPT` / `VERIFY_PROMPT` / `PLAN_PROMPT`) **dissolve** — they were already minimal/neutral, and now vanish. Phase-specific guidance is delivered via **`<instruction>` blocks** that live in the transcript (appended), never in the system prompt:

- **Between-phase transitions:** the `transition` tool _result_ carries the `<instruction>`.
- **Mission start (no preceding transition):** the `<instruction>` is embedded in the **handoff user message** (the mission brief), since the first run has no prior transition call to produce a result.

Both use the same XML wrapper so the agent reads them identically:

```xml
<!-- transition tool result (between phases) -->
<instruction>
You are now in build mode. Read the fixing plan from the transition call above; address every issue, then call transition({to:"verify"}) when done and tests pass. Follow the sakti-build skill.
</instruction>

<!-- handoff user message (mission start) -->
<the mission brief>

<instruction>
You are now in specify mode. Read proposal.md and produce design.md + tasks.md. Follow the sakti-specify skill.
</instruction>
```

**Why handoff-message for mission start (not a synthetic injection):** the skill-injection-at-mission-start path isn't yet proven end-to-end (plan graduation is currently blocked by the bug this redesign fixes). Embedding the marker in the handoff user message avoids stacking more unproven synthetic-injection machinery — it's just a user prompt. (The skill _content_ is still force-injected by the runner via `getBuiltinSkillForPhase`; only the _mode marker_ rides the handoff message.)

**Agents remain, but share the prompt.** The `build` / `verify` / `plan` agent entries are kept — they now differ only in **permission ruleset + activeToolNames** (verify stays edit-denied), all sharing `BASE_PROMPT`. Agent selection still routes by phase; the system prompt no longer changes on a swap, so the cache survives the whole loop.

## The Transition Table (gating policy — single source of truth)

| edge             | mode | side-effect                                                                  | `<instruction>` to next phase                                                               |
| ---------------- | ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| plan → mission   | gate | graduate child plan transcript into project resource-scope OM; spawn mission | (embedded in mission's handoff user message) "You are now in specify mode…"                 |
| specify → build  | gate | —                                                                            | "You are now in build mode. Read design.md + tasks.md; implement with TDD…"                 |
| build → verify   | auto | forced OM observe (bias reduction)                                           | "You are now in verify mode. Review completeness/correctness/coherence; edit-denied…"       |
| verify → build   | auto | — (verify already wrote the fixing plan as `body`)                           | "You are now in build mode. Read the fixing plan from the call above; address every issue…" |
| verify → archive | gate | —                                                                            | (none — archive is terminal; archive skill guides)                                          |

Verify's two cases fall out for free from the destination the agent picks: clean → `to: archive` (gate); issues → `to: build` (auto). No special "verify decides" logic — the destination IS the decision.

## The Auto-Chain Engine

The runner handles one WS message but **chains across auto-edges**, stopping only at gates:

```
build calls transition({to:verify})
  → auto-edge → flip status + forced observe → immediately start verify run
verify calls transition({to:build})        (issues found)
  → auto-edge → start build run
build calls transition({to:verify})
  → auto-edge → forced observe → start verify run
verify calls transition({to:archive})      (clean)
  → gate-edge → render card, PAUSE chain
```

So a single user message drives build→verify→build→verify→… until a gate. Gates are the only pause points.

## Gate UX (yes/no)

- Agent calls `transition` on a gate-edge → server sets `pendingTransition`, renders card, agent turn ends, chain pauses.
- **YES** → execute transition (status flip + side-effects) → **auto-start the destination agent** (chain resumes).
- **NO** → clear `pendingTransition`, **no status change, no WS action** → user keeps the floor and types what to refine → the _current_ phase's agent re-runs with the feedback.

NO is deliberately not a "reject and route backward" — it dismisses the card and returns control to the chat so the user can explain disagreement. This preserves the user's refinement authority.

## Interaction Modes: interactive vs autonomous

| phase(s)                                          | mode        | guardrail      | questions                                              |
| ------------------------------------------------- | ----------- | -------------- | ------------------------------------------------------ |
| plan (open), specify-brainstorming                | interactive | does not fire  | free-text Q&A allowed                                  |
| build (building), verify (review), specify-hotfix | autonomous  | fires on stall | none mid-run — refinements batched into verify summary |

**The "better default":** once specify is approved (the specify→build gate), the agent never stops to ask. Anything that comes up mid-run is batched into the verify summary, surfaced at the verify→archive gate ("things adjusted mid-run: … — is this OK?"). The user decides once, at the gate, not mid-loop.

## Runtime Guardrail (oh-my-pi style `<reminder>` injection)

In **autonomous phases**, when the agent ends a turn **without a `transition` call**, the runtime injects a phase-aware reminder and re-runs:

```xml
<reminder phase="build">
Build phase isn't complete — 2 of 5 tasks still unchecked. Continue: pick the next unchecked task in tasks.md, write its failing test (RED), implement minimally (GREEN), commit. Only call transition({to:"verify"}) once every task is checked AND the project's full test suite passes.
</reminder>
```

```xml
<reminder phase="verify">
Verify phase isn't complete. Finish checking completeness, correctness, and coherence against design.md + specs + tasks.md. If you found issues, write the fixing plan and call transition({to:"build"}). Only call transition({to:"archive"}) if the work is genuinely clean.
</reminder>
```

Mechanics:

- Fires only in autonomous phases (build, verify, specify-hotfix) — where stopping is always a stall.
- Injected as a user-role message (agent treats as input), XML-tagged, **phase-aware**.
- **Build is progress-aware** (see next section). Verify is phase-aware (no checkbox artifact to parse).
- **Capped** — after ~2 stalls without progress, the reminder changes tone ("You've stalled twice. Explain the blocker or finish."), then surfaces to the user instead of looping forever.
- Does **not** fire in interactive phases, where pausing for Q&A is legitimate.

## Progress-Aware Reminders (build)

Build reminders carry real progress, not blind nudges:

- The runtime reads `tasks.md` for the session's change and counts checkboxes via the existing `getTaskProgressForChange(changesDir, changeName, projectRoot)` helper (already schema-aware: parses the tracked-tasks artifact glob, handles nested tasks.md, never throws). Result: "2 of 5 tasks still unchecked" + the actual unchecked task labels.
- Verify has no checkbox artifact, so it stays phase-aware (not progress-aware) for now.

This requires three things that also make the system coherent:

### 1. Export SDD helpers from `@sakti-code/sakti` (sakti-as-library)

Today `src/index.ts` re-exports only `sdd/core` (global-config, planning-home, sakti-root), and the server uses sakti purely as a CLI subprocess (`require.resolve("@sakti-code/sakti/package.json")`). Add a `sdd/utils` barrel and re-export:

- `getTaskProgressForChange`, `formatTaskStatus`, `countTasksFromContent`, `type TaskProgress` (task-progress.ts)
- the change-metadata readers needed to resolve a change's state

The server then consumes these as a **library**, making the runtime SDD-aware.

### 2. Link sessions to changes — `changeName` column on `sessions`

**This is the one DB migration in the redesign.** Today there is no session→change linkage anywhere (grepping finds nothing), so the runtime cannot know which change a mission is working on. Add:

- `sessions.changeName` (nullable text; set when a mission is created from plan graduation — the plan session knows the change name).
- Resolver: given a session, return its change dir via the project's sakti root + `changeName`.

### 3. Runtime progress computation

On a build-phase stall: resolve project root (from `project.cwd`) → resolve sakti root (exported) → read `tasks.md` for `session.changeName` → `getTaskProgressForChange` → inject counts into the reminder.

## Scope

**In this redesign:**

1. `transition({ to, body })` tool + server-side gate/auto transition table (with per-edge `<instruction>` templates).
2. **Stable system prompt** — `BASE_PROMPT` only; `BUILD_PROMPT`/`VERIFY_PROMPT`/`PLAN_PROMPT` role sections dissolve. Phase guidance delivered via `<instruction>` blocks (transition tool result between phases; handoff user message at mission start). Cache survives the build↔verify loop.
3. Auto-chain engine (runner chains across auto-edges, stops at gates).
4. Gate UX: YES = execute + resume chain; NO = dismiss + return control to current agent.
5. Runtime guardrail: phase-aware `<reminder>` injection in autonomous phases; **progress-aware for build**.
6. Export SDD utils from `@sakti-code/sakti`; server consumes sakti as a library.
7. `sessions.changeName` column + linkage (DB migration; set at mission creation).
8. Remove the `ask` tool entirely; migrate all current `ask`-kind usages → `transition` edges.
9. Fold the Gap 1 build-resume bug (build skill rewritten for the auto-chain — no more "skip to final review" when tasks checked + verify rejected).
10. Dead `kind: "spec"` cleanup (pre-existing orphan, removed with the ask-kinds table).

**Deferred (separate future work):**

- Standalone `question`/ask tool (the "better ask" the user has planned). Until then, open questions are free-text.
- Runtime guardrail for interactive phases (those legitimately pause — no reliable stall signal until the question tool exists).
- Verify progress-awareness (needs a structured issue-count artifact to parse).
- Context-builder rehydration on rollback (the "dumb re-read" after compaction) — the auto-chain makes this less painful since the loop no longer strands, but the re-read cost remains; addressed separately.

## Files / Areas Touched (scoping)

**`packages/tools/src/`** — delete `ask/`; new `transition/` tool. Remove ask from agents' activeToolNames; add `transition`.

**`apps/server/src/agent/config/`**

- new `transition-table.ts` (the gate/auto table + per-edge `<instruction>` templates — replaces `ask-kinds.ts`)
- `force-reset.ts` — wired to the build→verify auto-edge (kept)
- `graduation.ts` — wired to the plan→mission gate-edge (kept); also embeds the specify-mode `<instruction>` into the mission's handoff user message
- `server-agents.ts` — swap ask→transition in activeToolNames
- `prompts.ts` — **dissolve the role sections** (`BUILD_PROMPT`/`VERIFY_PROMPT`/`PLAN_PROMPT` collapse to `BASE_PROMPT`); agents share the stable prompt, differ only in permission ruleset

**`apps/server/src/routes/sessions/`** — `confirm.ts` rewritten to the gate YES/NO semantics (NO = dismiss, no action); auto-edges don't hit this route.

**`apps/server/src/agent/`** — runner: auto-chain engine (continue across auto-edges, stop at gates) + the `<reminder>` guardrail injection (phase-aware, progress-aware for build). New `reminder.ts`.

**`packages/sakti/src/`** — `sdd/utils/index.ts` barrel + re-exports from `src/index.ts`.

**`packages/db/src/schema.ts`** — add `changeName` column to `sessions`; migration in `init.ts`.

**builtin skills** — rewrite the handoff instructions: `transition({to:...})` replaces `ask({kind:...})` in sakti-plan (→mission), sakti-specify (→build), sakti-build (→verify), sakti-verify (→build on issues / →archive on clean). The verify skill gets the "batch refinements into the summary" guidance.

## Open Questions for Implementation

- **Reminder cap & tone:** exact stall count before surfacing to user, and the escalation-tone wording. Decide during implementation.
- **Gate card rendering:** the desktop needs a yes/no card component bound to the transition (replacing the proposed-session/proposed-completion cards). The NO path must not send a WS message.
- **Mission auto-start after plan→mission YES:** does the spawned mission auto-run specify, or wait for the user? (Leaning: the mission's first prompt is the brief; specify auto-starts.)
