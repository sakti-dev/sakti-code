---
name: sakti-build
description: "Build phase. Use when a change has completed specification and tasks need to be implemented. Reads design.md + tasks.md, executes each task with TDD, runs a final review, and hands off to verify via ask(kind:completion)."
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

If all tasks are already checked, skip to Step 5 (final review).

### Step 2 — Choose Execution Mode (Blocking Point)

Ask the user to choose how tasks will be executed:

- **"Direct"** — main session implements each task, tests, and commits. Simpler, full visibility.
- **"Subagent"** — fresh subagent dispatched per task. Prevents context pollution on long implementations.

**Pause and wait for the user's explicit choice.** Do not auto-select or default.

Record the choice:

```bash
sakti state set <name> build_mode <direct|subagent>
```

### Step 3 — Execute Tasks

**Read `references/execution-guide.md`** (relative to this skill's directory) and follow its guidance for the chosen mode.

The execution guide covers:

- The task loop: pick next unchecked task → implement → test → commit → mark done
- TDD cycle: detect test setup → RED (write failing test) → GREEN (minimal code) → REFACTOR
- Direct mode: main session executes each task inline
- Subagent mode: dispatch fresh implementer per task with full task text + context
- Commit per task: message reflects the task goal

**Debug gate:** if any test, build, or runtime failure occurs during execution, **read `references/debugging-guide.md`** and follow the systematic debugging protocol before attempting fixes. No guessing.

**Resume:** if resuming after interruption, find the first unchecked task (`grep -n '\- \[ \]' tasks.md | head -1`) and continue from there. Already-committed tasks must not be re-implemented.

### Step 4 — Mark Tasks Complete

For each completed task, change `- [ ]` to `- [x]` in `tasks.md` and commit the progress:

```bash
git add tasks.md
git commit -m "chore: mark task N complete"
```

### Step 5 — Sanity Check

After all tasks are checked:

**5a. Confirm all tasks are marked complete:**

```bash
grep -c '\- \[ \]' tasks.md
```

Must return 0 (no unchecked tasks). If any remain, return to Step 3.

**5b. Run test suite:**

```bash
vp run -r test
```

If any tests fail, return to Step 3 and fix the failures. Do not proceed until all tests pass.

### Step 6 — Hand Off to Verify

**Call `ask({ kind: "completion", body })`** where `body` summarizes what changed and how it was verified (tests run, results). This renders the completion card with wired approve/revise actions; approve triggers a forced context observe (bias reduction for the verify agent) and advances to the verify phase. Do not print a handoff text block — the card is the handoff UI. After calling `ask`, your turn ends.

If you are blocked or need a decision before completing, call `ask` without a `kind` to ask an open question.

## Decision Points

Step 2 and Step 6 are **blocking points.** Follow these rules:

- **Call the `ask` tool.** For the execution-mode choice (Step 2), omit `kind`. For the completion handoff (Step 6), use `kind: "completion"`.
- **Never end a blocking point with plain text.** Free text does not set the pending ask, render a card, or trigger the transition — the user typing "approved" as a message does nothing.
- Pause and wait for an explicit user choice before continuing.
- Never substitute recommendation rules or defaults for current confirmation.

## Exit & Handoff

The handoff IS the `ask({ kind: "completion", body })` call in Step 6 — there is no separate handoff text block. After the user acts on the card, the mission advances to the verify phase (with a forced context observe for bias reduction).

## Common Mistakes

| Mistake                                           | Fix                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| Skipping TDD when test setup exists               | Execution guide detects test setup — follow RED-GREEN-REFACTOR    |
| Implementing multiple tasks before committing     | One commit per task — keeps history traceable                     |
| Guessing at fixes when tests fail                 | Read `references/debugging-guide.md` — systematic debugging first |
| Transitioning to verify with failing tests        | Step 5b runs the test suite — all must pass before transition     |
| Re-implementing already-committed tasks on resume | Find the first unchecked task and continue from there             |
