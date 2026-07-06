---
name: sakti-plan
description: "Use when starting a new change — planning requirements, defining scope, or creating the proposal/specs/design/tasks artifacts before any implementation begins."
---

# Sakti Plan

## Overview

Phase-1 planning skill. Explores requirements, confirms scope, creates the change and its artifacts (proposal/specs/design/tasks) via the sakti CLI, and verifies completion. Stops once artifacts are complete — no implementation, no auto-advance to build.

**Core principle:** requirements must be clarified and confirmed by the user before any artifact is created. Two blocking points enforce this: name/scope confirmation and final review.

## When to Use

- Starting a new change from scratch
- User describes a feature, fix, or refactor to plan out
- Need to produce proposal/specs/design/tasks before implementation

**Do NOT use when:**

- An active change already exists with artifacts in progress (resume it instead)
- The work is a trivial fix that doesn't need structured planning
- You are already past planning (implementation/verify/archive)

## Prerequisites

- No active change, or the user explicitly wants a new one
- The `sakti` CLI installed and available on PATH

## Output Language

Use the language of the user request that triggered this skill as the default output language. When resuming an existing change with a clear dominant artifact language, preserve it unless the user explicitly asks to switch.

## The Flow

### Step 1 — Explore

**Read `references/exploration.md`** (relative to this skill's directory) and follow its guidance to explore the problem space. Do not treat one Q&A turn as sufficient — keep asking until you can produce a **clarification summary** with all five parts:

- **Goals:** the problem the user wants to solve and the expected outcome
- **Non-goals:** what is explicitly out of scope
- **Scope boundaries:** included/excluded modules, users, platforms, or data
- **Key unknowns:** unresolved assumptions, risks, or dependencies
- **Draft acceptance scenarios:** at least the core success scenario and important boundary scenarios

### Step 2 — Confirm Name + Scope (Blocking Point)

Present the clarification summary, then propose a change name:

- **2-3 kebab-case English name suggestions** derived from the summary, each with a one-line scope description
- An explicit **"Enter a custom name"** option
- A note: if the user enters non-kebab-case text (e.g. Chinese), it will be converted to compliant kebab-case English and shown back for confirmation

Names must be lowercase letters, digits, and hyphens only (e.g. `add-google-oauth-login`).

**Pause and wait for the user's explicit choice.** Do not auto-generate, infer, or run `sakti new change` before confirmation. If the chosen name collides with an existing change, report it and ask for another.

### Step 3 — Create Change + Artifacts

**3a. Create the change.** Scaffold the change directory:

```bash
sakti new change "<name>"
```

This creates `.sakti/changes/<name>/` with `.sakti.yaml` using the default spec-driven schema. Optionally pass `--description "<text>"` or `--goal "<text>"` to record context.

**3b. Check artifact status.** See which artifacts are ready and their dependency order:

```bash
sakti status --change "<name>"
```

The default schema produces artifacts in this dependency order:

1. **proposal** (no dependencies) — ready immediately
2. **specs** (requires proposal)
3. **design** (requires proposal)
4. **tasks** (requires specs + design)

**3c. Create artifacts in dependency order.** For each artifact the schema reports as ready, draft it using the confirmed clarification summary from Step 1/2:

- **proposal.md** — WHY: problem background, goals, scope, non-goals
- **specs/\*\***`<capability>`/spec.md\*\* — WHAT: requirements and scenarios per capability
- **design.md** — HOW (high-level): architecture decisions, approach selection, data flow
- **tasks.md** — task checklist with clear descriptions

After writing each artifact, re-run `sakti status --change "<name>"` to confirm the artifact-graph recognizes it and unlocks the next dependent artifact.

**Failure handling:** if `sakti status` reports a parse or schema error, stop immediately and report it. Do not fall back to hard-coded prose that bypasses the schema — fix the root cause first.

**Idempotency:** all steps are safe to re-run. If the change directory already exists and some artifacts are complete, skip them and continue from the first incomplete artifact.

**Expected artifacts after Step 3:**

```
.sakti/changes/<name>/
├── .sakti.yaml          # change metadata + schema reference
├── proposal.md          # Why + What: problem, goals, scope
├── specs/
│   └── <capability>/spec.md   # Requirements + scenarios
├── design.md            # How (high-level): architecture decisions
└── tasks.md             # Task checklist
```

### Step 4 — Review (Blocking Point)

**4a. Content completeness check.** Run the artifact status and confirm all artifacts are done:

```bash
sakti status --change "<name>"
```

Look for `All artifacts complete!` (or equivalent). If any artifact shows as incomplete or blocked, return to Step 3c — do not present the review until the artifact-graph reports completion.

Also confirm manually that the content is substantive (not just stubs):

- **proposal.md:** problem background, goals, scope, non-goals
- **specs:** requirements and scenarios per capability
- **design.md:** high-level architecture decisions, approach selection, data flow
- **tasks.md:** task list with clear descriptions

**4b. User review (blocking point).** Present a summary:

- **proposal.md:** problem background, goals, scope
- **specs:** capabilities and key requirements
- **design.md:** high-level architecture decisions, approach selection
- **tasks.md:** task count and key task descriptions

Offer a single-select choice:

- **"Confirm, planning complete"** — artifacts meet expectations
- **"Needs adjustment"** — include adjustment notes, modify the files, then re-request confirmation

**Pause and wait for the user's explicit choice.** Do not announce completion before confirmation.

## Decision Points

Steps 2 and 4b are **blocking points**. Follow these rules at each:

- Pause and wait for an explicit user choice before continuing
- Use the current platform's question or confirmation tool
- If no structured tool exists, ask clear options in the conversation and stop until the user replies
- Never substitute recommendation rules, defaults, or "the user would probably agree" for current confirmation
- Do not create artifacts or announce completion before the user explicitly chooses

## Exit & Handoff

After the user confirms planning is complete, **stop**. Print a short handoff block:

```
Planning complete. Change: <name>
Artifacts: proposal, specs, design, tasks — all done.

Next steps:
  Run `sakti status --change <name>` anytime to check artifact state
  Run `sakti state transition <name> open-complete` to advance to the next phase
```

The change is now ready for whoever picks it up next.

## Common Mistakes

| Mistake                                                             | Fix                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Creating artifacts before the user confirms scope                   | Step 2 is a blocking point — wait for explicit name/scope confirmation              |
| Announcing completion before user review                            | Step 4b is a blocking point — wait for the review confirmation                      |
| Creating artifacts in the wrong order                               | Follow the dependency order from `sakti status` (proposal → specs → design → tasks) |
| Inferring or auto-generating the change name                        | Names must be kebab-case English, explicitly chosen by the user                     |
| Falling back to hard-coded prose when `sakti status` reports errors | Stop and fix the schema/parse error; do not bypass the artifact-graph               |
| Auto-advancing to implementation after review                       | This skill stops after planning; handoff is manual                                  |
