---
name: sakti-build
description: "Phase 3 implementation. Use when a change has completed design and tasks need to be implemented. Reads enriched tasks.md, executes each task with TDD, runs a final review, and transitions to verify."
---

# Sakti Build

## Overview

Phase-3 implementation skill. Takes the enriched `tasks.md` from phase 2 and executes each task. Offers one choice (subagent or direct execution), implements with TDD, runs a final review, and transitions to verify.

**Core principle:** every task gets a failing test first, then minimal implementation, then commit. No task is skipped. A final review catches issues before verify.

## When to Use

- A change has completed phase 2 (design) and `phase` is `build`
- The user wants to start or continue implementing tasks
- Tasks in `tasks.md` are not yet all checked

**Do NOT use when:**

- Phase is `open` or `design` — earlier phases must complete first
- Phase is `verify` or `archive` — build is already complete
- The change uses `hotfix` or `tweak` workflow (these skip design and go straight to build with `build_mode: direct`)

## Prerequisites

- Active change with `phase: build`
- Enriched `tasks.md` (from phase 2 design) with per-task details: goal, dependencies, files, approach, risks, testing
- `technical-design.md` exists (from phase 2 design)
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

- `technical-design.md` — deep technical design (approach, risks, testing strategy)
- `tasks.md` — enriched task list with implementation details
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

### Step 6 — Transition

```bash
sakti state transition <name> build-complete
```

This advances the phase to `verify`.

## Decision Points

Step 2 is a **blocking point.** Follow these rules:

- Pause and wait for an explicit user choice before continuing
- Use the current platform's question or confirmation tool
- Never substitute recommendation rules or defaults for current confirmation
- Do not execute tasks before the user explicitly chooses

## Exit & Handoff

After the transition succeeds, print a short handoff block:

```
Build complete. Change: <name>
Phase: build → verify

Tasks: N/N complete
Tests: all passing

Next steps:
  Run `sakti status --change <name>` anytime to check state
```

## Common Mistakes

| Mistake                                           | Fix                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| Skipping TDD when test setup exists               | Execution guide detects test setup — follow RED-GREEN-REFACTOR    |
| Implementing multiple tasks before committing     | One commit per task — keeps history traceable                     |
| Guessing at fixes when tests fail                 | Read `references/debugging-guide.md` — systematic debugging first |
| Transitioning to verify with failing tests        | Step 5b runs the test suite — all must pass before transition     |
| Re-implementing already-committed tasks on resume | Find the first unchecked task and continue from there             |
