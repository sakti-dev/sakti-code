---
name: sakti-build
description: "Build phase. Use when a change has completed specification and tasks need to be implemented. Reads design.md + tasks.md, executes each task with TDD, runs a final review, and hands off to verify via transition(to:verify). Autonomous — does not pause mid-run."
---

# Sakti Build

## Overview

Build-phase skill. Takes `design.md` + `tasks.md` from the specify phase and executes each task. Offers one choice (subagent or direct execution), implements with TDD, runs a final review, and hands off to verify.

**Core principle:** every task gets a failing test first, then minimal implementation, then commit. No task is skipped. A final review catches issues before verify.

## When to Use

- A change has completed specification (`phase: build`) and tasks need implementing
- The user wants to start or continue implementing tasks
- Tasks in `tasks.md` are not yet all checked

**Do NOT use when:**

- Phase is `open` or `specify` — earlier phases must complete first
- Phase is `verify` or `archive` — build is already complete

## Prerequisites

- Active change with `phase: build`
- `design.md` (technical design — approach, risks, testing strategy)
- `tasks.md` with implementation details
- The `sakti` CLI installed and available on PATH

## Output Language

Use the language of the user request that triggered this skill as the default output language. When resuming an existing change with a clear dominant artifact language, preserve that unless the user explicitly asks to switch.

## The Flow

### Step 1 — Entry Check

**1a. Identify the change.** The change name is inferred from the mission session context. If not available, ask the user.

**1b. Verify phase:**

```bash
sakti state get <name> phase
```

If the phase is not `build`, stop and tell the user what phase they're in.

**1c. Read context:**

- `design.md` — technical design (approach, risks, testing strategy)
- `tasks.md` — task list with implementation details
- `proposal.md`, `specs/*/spec.md` — for requirement reference during implementation

**1d. Check progress:**

Parse `tasks.md` checkboxes. Report: "N/M tasks complete."

**1e. Resuming after a verify reject (read the fixing plan):** if you are re-entering build because verify found issues (a verify→build auto-transition), the fixing plan is in the `transition({ to: "build" })` call that brought you here. Read it from the transcript and address **every** issue it lists before re-transitioning to verify. Do **not** skip to a final review just because all tasks are checked — verify rejected the previous completion for concrete reasons that must be fixed first.

### Step 2 — Execute Tasks

**Default to direct execution** (the main session implements each task inline). This phase is autonomous — it does not pause to ask the user how to run. (If a `build_mode` is already recorded in the change state, honor it; otherwise use direct.)

**Read `references/execution-guide.md`** (relative to this skill's directory) and follow its guidance.

The execution guide covers:

- The task loop: pick next unchecked task → implement → test → commit → mark done
- TDD cycle: detect test setup → RED (write failing test) → GREEN (minimal code) → REFACTOR
- Direct mode: main session executes each task inline
- Subagent mode: dispatch fresh implementer per task with full task text + context
- Commit per task: message reflects the task goal

**Debug gate:** if any test, build, or runtime failure occurs during execution, **read `references/debugging-guide.md`** and follow the systematic debugging protocol before attempting fixes. No guessing.

**Resume:** if resuming after interruption, find the first unchecked task (`grep -n '\- \[ \]' tasks.md | head -1`) and continue from there. Already-committed tasks must not be re-implemented.

### Step 3 — Mark Tasks Complete

For each completed task, change `- [ ]` to `- [x]` in `tasks.md` and commit the progress:

```bash
git add tasks.md
git commit -m "chore: mark task N complete"
```

### Step 4 — Sanity Check

After all tasks are checked:

**4a. Confirm all tasks are marked complete:**

```bash
grep -c '\- \[ \]' tasks.md
```

Must return 0 (no unchecked tasks). If any remain, return to Step 2.

**4b. Run test suite:**

```bash
vp run -r test
```

If any tests fail, return to Step 2 and fix the failures. Do not proceed until all tests pass.

### Step 5 — Hand Off to Verify

**Call `transition({ to: "verify", body })`** where `body` summarizes what changed and how it was verified (tests run, results). This is an **auto** transition — verify starts immediately on a forced-observed (compacted) context (bias reduction). There is no confirmation card; do not print a handoff text block. After calling `transition`, your turn ends and the verify agent runs automatically.

Build is an **autonomous** phase: do not pause mid-run to ask questions. If you hit a genuine blocker, that is a stall — explain the blocker in your output and stop (a runtime reminder may re-prompt you). Anything that's merely a judgment call is batched into the verify summary and surfaced once at the verify→archive gate.

## Exit & Handoff

The handoff IS the `transition({ to: "verify", body })` call in Step 5 — there is no separate handoff text block. The build↔verify loop runs automatically: if verify finds issues it transitions back to build (you read the fixing plan and fix); when verify is clean it gates at archive.

## Common Mistakes

| Mistake                                                                   | Fix                                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Skipping to final review when all tasks are checked after a verify reject | Read the fixing plan from the transition call and fix every issue first (Step 1e)  |
| Skipping TDD when test setup exists                                       | Execution guide detects test setup — follow RED-GREEN-REFACTOR                     |
| Implementing multiple tasks before committing                             | One commit per task — keeps history traceable                                      |
| Guessing at fixes when tests fail                                         | Read `references/debugging-guide.md` — systematic debugging first                  |
| Transitioning to verify with failing tests                                | Step 4b runs the test suite — all must pass before transition                      |
| Re-implementing already-committed tasks on resume                         | Find the first unchecked task and continue from there                              |
| Pausing mid-build to ask the user a question                              | Build is autonomous — batch judgments into the verify summary; only transition out |
