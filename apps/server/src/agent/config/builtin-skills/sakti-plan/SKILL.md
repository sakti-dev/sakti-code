---
name: sakti-plan
description: "Use when starting a new change — planning requirements, defining scope, and classifying the change type before any detailed specification begins. Produces only a lightweight proposal.md and graduates to a mission session via the transition tool."
---

# Sakti Plan

## Overview

Planning skill. Explores requirements, classifies the change (`full` vs `hotfix`), confirms scope, creates the change + a lightweight `proposal.md`, and graduates to a mission session. Produces **only** the proposal — detailed specification (specs, design.md, tasks.md) happens in the specify phase, not here.

**Core principle:** requirements must be clarified and the change classified/confirmed by the user before any artifact is created. Two blocking points enforce this: classification+name confirmation and final review.

## Guardrails

Plan **never** investigates how to fix, build, or debug. Do not read source files to trace a bug, map architecture, find integration points, or propose approaches — that is specify's job, and specify will redo all of it from scratch regardless of what plan discovers. If you catch yourself reasoning about an implementation path, stop: you are in the wrong phase. Plan's only decisions are (1) what the user wants and why, (2) feature vs hotfix, and (3) whether a dependency spec already exists.

**Allowed reads — plan may read only:**

- `.sakti/specs/**` — to check whether a relevant spec already exists (dependency check)
- `sakti list --json` — active-change context (collisions, related work)
- the user's own message

Everything else is off-limits: source under `packages/`, `apps/`, `electron/`, configs, scripts, etc. If a question genuinely needs source to answer, it belongs in specify, not plan.

## When to Use

- Starting a new change from scratch
- User describes a feature, fix, or refactor to plan out

**Do NOT use when:**

- An active change already exists with artifacts in progress (resume it instead)
- The work is a trivial fix that doesn't need structured planning
- You are already past planning (specify/build/verify/archive)

## Prerequisites

- No active change, or the user explicitly wants a new one
- The `sakti` CLI installed and available on PATH

## Output Language

Use the language of the user request that triggered this skill as the default output language. When resuming an existing change with a clear dominant artifact language, preserve it unless the user explicitly asks to switch.

## The Flow

### Step 1 — Triage

**Read `references/triage.md`** (relative to this skill's directory) — **mandatory** — and follow its guidance. Triage only: capture intent, classify, and check dependencies. **Never investigate how to implement or fix** — see [Guardrails](#guardrails).

Do not treat one Q&A turn as sufficient — keep asking until you can produce a **clarification summary** with four parts:

- **Goals:** the problem the user wants to solve and the expected outcome
- **Non-goals:** what is explicitly out of scope
- **Scope boundaries:** included/excluded modules, users, platforms, or data
- **Key unknowns:** unresolved _requirements_ unknowns (what should happen) — never _implementation_ unknowns (how to build it). Risks or dependencies at the requirements level only.

### Step 2 — Classify + Confirm Name (Blocking Point)

**2a. Classify the change type.** Based on the clarification summary, predict the workflow:

- **`full`** — the change needs a spec/behavior change (new capability, modified behavior, cross-cutting work). It will go through the specify phase's brainstorming mode.
- **`hotfix`** — no spec change needed: a bug fix (spec is correct, implementation is wrong) or a small improvement (cosmetic, refactor, polish). It will go through the specify phase's autonomous mode.

This is a **prediction** that self-corrects: if the specify phase later discovers a spec change is actually needed, it escalates to brainstorming. So when unsure, lean `hotfix` only if you're confident no spec changes; otherwise `full`.

**2b. Present classification + name and wait for explicit confirmation.** Present (as plain text, then end your turn — the user replies in their next message):

- The clarification summary (brief)
- Your proposed workflow (`full` or `hotfix`) with a one-line rationale
- **2-3 kebab-case English name suggestions**, each with a one-line scope description
- An explicit **"Enter a custom name"** option
- A note: non-kebab-case text (e.g. Chinese) will be converted to compliant kebab-case English and shown back for confirmation

Names must be lowercase letters, digits, and hyphens only (e.g. `add-google-oauth-login`).

**Pause and wait for the user's explicit choice.** Do not auto-generate, infer, or run `sakti new change` before confirmation. If the chosen name collides with an existing change, report it and ask for another. (Plan is an interactive phase — ending your turn with a question is correct; the user replies via chat.)

### Step 3 — Create Change + Proposal

**3a. Create the change** with the confirmed workflow:

```bash
sakti new change "<name>" --workflow <full|hotfix>
```

This creates `.sakti/changes/<name>/` with `.sakti.yaml`.

**3b. Write proposal.md only.** Draft a lightweight proposal using the confirmed clarification summary:

- **proposal.md** — WHY + WHAT: problem background (Why), what changes (What Changes), and impact (Impact). No Capabilities section — spec planning happens in the specify phase.

Keep it concise (1-2 pages). Focus on the "why" and the rough "what", not the "how".

**Expected artifact after Step 3:**

```
.sakti/changes/<name>/
├── .sakti.yaml          # change metadata + schema reference + workflow
└── proposal.md          # Why + What: problem, goals, scope, impact
```

Do NOT create specs/, design.md, or tasks.md here — those belong to the specify phase.

### Step 4 — Review (Blocking Point)

**4a. Content check.** Confirm the proposal is substantive (not a stub): problem background, goals, scope, impact.

**4b. User review (blocking point).** Present (as plain text, then end your turn) a brief summary of the proposal and offer:

- **"Confirm, planning complete"** — graduate to a mission session
- **"Needs adjustment"** — revise the proposal, then re-request confirmation

**Pause and wait for the user's explicit choice.**

### Step 5 — Graduate (Blocking Point)

When the user confirms planning is complete, **call `transition({ to: "mission", body })`** where `body` is a self-contained mission brief that a fresh agent can act on with no prior context. Include:

- What to build and why (from the proposal)
- Dependency specs found during triage (from `.sakti/specs/`) and any requirements-level constraints
- The chosen workflow (`full`/`hotfix`) and its rationale
- Any non-goals or open questions

`body` becomes the mission's first prompt — make it count. This is a **gate** transition: it renders a confirmation card. Do not print a separate handoff text block — the card is the handoff UI. After calling `transition`, your turn ends. The user approves (spawns the mission + runs plan→resource memory graduation) or rejects (you revise).

## Decision Points

Steps 2b, 4b, and 5 are **blocking points**. Follow these rules at each:

- **Lifecycle handoffs use the `transition` tool.** Graduation (Step 5) is `transition({ to: "mission", body })` — it is a gate that renders a card. Open choices (Steps 2b, 4b) are plain-text questions: present the options, then end your turn; the user replies in their next message.
- **Never end a lifecycle handoff with plain text.** Graduation REQUIRES the `transition` call; text alone does not render the card, set the pending transition, or trigger graduation — the user typing "approved" as a message does nothing.
- Pause and wait for an explicit user choice before continuing.
- Never substitute recommendation rules, defaults, or "the user would probably agree" for explicit confirmation.

## Exit & Handoff

Graduation is the `transition({ to: "mission", body })` call in Step 5 — there is no separate handoff text block. The card's approval spawns the mission session (born in `specifying`, linked to this change) and runs plan→resource memory graduation.

After the user acts on the card, you may note the next phase:

```
Planning complete. Change: <name> (workflow: <full|hotfix>)
The specify phase picks up from here: specs/design.md/tasks.md are produced there.
```

## Common Mistakes

| Mistake                                                                          | Fix                                                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Investigating how to fix, implement, or debug during plan                        | Specify's job, not plan's — plan only triages. See Guardrails (allowed reads)                        |
| Printing a handoff text block instead of calling `transition({ to: "mission" })` | Graduation REQUIRES the transition call; text does not set the pending transition or render the card |
| Creating specs/design.md/tasks.md during planning                                | Those belong to the specify phase; plan produces only proposal.md                                    |
| Skipping the classification step                                                 | Step 2 classifies full vs hotfix — it drives the specify phase mode                                  |
| Creating the change before the user confirms classification + name               | Step 2b is a blocking point — wait for explicit confirmation                                         |
| Inferring or auto-generating the change name                                     | Names must be kebab-case English, explicitly chosen by the user                                      |
| Ending a graduation with plain text instead of the `transition` tool             | Graduation uses `transition`; open questions use plain text — don't mix them up                      |
