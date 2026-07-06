# sakti-build Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the `sakti-build` phase-3 skill (task execution) and clean up the state machine by dropping `tdd_mode` and simplifying `build_mode`.

**Architecture:** Two parts: (1) state machine cleanup — remove `tdd_mode` field and simplify `build_mode` enum to `subagent | direct`; (2) create `sakti-build` skill with SKILL.md + two reference files (execution-guide.md, debugging-guide.md). The skill assumes the server pre-configures the worktree/branch. It offers one blocking point (execution mode: subagent or direct), executes enriched tasks.md, runs a final review, and transitions.

**Tech Stack:** TypeScript (state machine), Zod (schema), Vitest (tests), Markdown (skill).

---

## Task 1: Drop `tdd_mode` and simplify `build_mode` enum (TDD)

Remove `tdd_mode` from the schema entirely and simplify `build_mode` from `["subagent-driven-development", "executing-plans", "direct"]` to `["subagent", "direct"]`.

**Files:**

- Modify: `packages/sakti/src/sdd/core/change-metadata/schema.ts:66-72`
- Modify: `packages/sakti/src/sdd/core/change-metadata/workflow-defaults.ts:22-33`
- Modify: `packages/sakti/src/sdd/commands/state.ts:13-33` (STATE_FIELDS)
- Test: `packages/sakti/src/sdd/core/change-metadata/__tests__/schema-state.test.ts`
- Test: `packages/sakti/src/sdd/core/change-metadata/__tests__/workflow-defaults.test.ts`
- Test: `packages/sakti/src/sdd/commands/__tests__/state.test.ts`
- Test: `packages/sakti/src/sdd/utils/__tests__/change-utils-state.test.ts`

### Step 1: Update schema-state.test.ts — remove tdd_mode expectations

**File:** `packages/sakti/src/sdd/core/change-metadata/__tests__/schema-state.test.ts`

Replace line 18 (`expect(result.data.tdd_mode).toBeNull();`) — remove it entirely:

```typescript
expect(result.data.build_mode).toBeNull();
expect(result.data.isolation).toBeNull();
```

Replace the build_mode valid-values test (lines 52-59):

```typescript
it("accepts all valid build_mode values", () => {
  for (const mode of ["subagent", "direct"] as const) {
    const result = ChangeMetadataSchema.safeParse({
      schema: "spec-driven",
      build_mode: mode,
    });
    expect(result.success).toBe(true);
  }
});
```

Replace the nullable-fields test (lines 62-69) — remove `tdd_mode`:

```typescript
it("accepts null for nullable fields", () => {
  const result = ChangeMetadataSchema.safeParse({
    schema: "spec-driven",
    build_mode: null,
    design_doc: null,
  });
  expect(result.success).toBe(true);
});
```

### Step 2: Update workflow-defaults.test.ts — remove tdd_mode expectations

**File:** `packages/sakti/src/sdd/core/change-metadata/__tests__/workflow-defaults.test.ts`

Remove line 10 (`expect(defaults.tdd_mode).toBeNull();`).
Remove line 21 (`expect(defaults.tdd_mode).toBe("direct");`).
Remove line 31 (`expect(defaults.tdd_mode).toBe("direct");`).

### Step 3: Update state.test.ts — remove tdd_mode from build_mode test

**File:** `packages/sakti/src/sdd/commands/__tests__/state.test.ts`

No `tdd_mode` references in this file. No changes needed.

### Step 4: Update change-utils-state.test.ts — remove tdd_mode expectation

**File:** `packages/sakti/src/sdd/utils/__tests__/change-utils-state.test.ts`

Remove line 52 (`expect(parsed.tdd_mode).toBe("direct");`).

### Step 5: Run tests to verify RED

Run: `vp run '@sakti-code/sakti#test'`

Expected: Tests fail because schema still has `tdd_mode` and old `build_mode` enum values. The schema-state test for build_mode values will fail because `"subagent-driven-development"` and `"executing-plans"` are no longer in the expected list (actually the test already expects them — we changed it to `["subagent", "direct"]` but the schema still accepts the old values and rejects... wait, no. The schema still has old enum. The test now checks `["subagent", "direct"]` which will FAIL because the schema rejects `"subagent"` as invalid. That's our RED.)

### Step 6: Update schema.ts — remove tdd_mode, simplify build_mode

**File:** `packages/sakti/src/sdd/core/change-metadata/schema.ts`

Replace lines 66-72:

```typescript
  // State machine — build decisions (null until user chooses)
  build_mode: z.enum(["subagent", "direct"]).nullable().default(null),
  build_pause: z.enum(["plan-ready"]).nullable().default(null),
  subagent_dispatch: z.enum(["confirmed"]).nullable().default(null),
  review_mode: z.enum(["off", "standard", "thorough"]).nullable().default(null),
```

(Removed `tdd_mode` line and simplified `build_mode` enum.)

### Step 7: Update workflow-defaults.ts — remove tdd_mode

**File:** `packages/sakti/src/sdd/core/change-metadata/workflow-defaults.ts`

In the `full` case, remove `tdd_mode: null,`.
In the `hotfix`/`tweak` case, remove `tdd_mode: "direct",`.

### Step 8: Update state.ts — remove tdd_mode from STATE_FIELDS

**File:** `packages/sakti/src/sdd/commands/state.ts`

Remove `"tdd_mode",` from the STATE_FIELDS array (line 20).

### Step 9: Run tests to verify GREEN

Run: `vp run '@sakti-code/sakti#test'`

Expected: All tests pass.

### Step 10: Run check

Run: `vp check --fix`

Expected: 0 warnings, 0 errors.

### Step 11: Commit

```bash
git add packages/sakti/src/sdd/
git commit -m "refactor(sakti): drop tdd_mode, simplify build_mode to subagent|direct

tdd_mode is an execution-time concern handled by sakti-build's
execution guide, not persisted state. build_mode simplified from
three comet-inherited values to two: subagent or direct."
```

---

## Task 2: Create sakti-build SKILL.md

Create the phase-3 execution skill.

**Files:**

- Create: `packages/sakti/src/sdd/skills/sakti-build/SKILL.md`

### Step 1: Create the skill directory

```bash
mkdir -p packages/sakti/src/sdd/skills/sakti-build/references
```

### Step 2: Write the SKILL.md

**File:** `packages/sakti/src/sdd/skills/sakti-build/SKILL.md`

````markdown
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

**1a. Verify phase:**

```bash
sakti state get <name> phase
```

If the phase is not `build`, stop and tell the user what phase they're in.

**1b. Read context:**

- `technical-design.md` — deep technical design (approach, risks, testing strategy)
- `tasks.md` — enriched task list with implementation details
- `proposal.md`, `specs/*/spec.md` — for requirement reference during implementation

**1c. Check progress:**

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

### Step 5 — Final Review

After all tasks are checked:

**5a. Run full test suite:**

```bash
vp run -r test
```

If any tests fail, return to Step 3 and fix the failures. Do not proceed until all tests pass.

**5b. Review the full diff:**

```bash
git log --oneline <base_ref>..HEAD
git diff <base_ref>..HEAD --stat
```

Check for:

- **Critical issues:** security vulnerabilities, data loss risk, broken builds — must be fixed before transition
- **Important issues:** missing edge cases, incomplete error handling — should be fixed or explicitly accepted with rationale
- **Minor issues:** naming, style — note for later

Fix all critical issues. For accepted important issues, record the acceptance rationale in the commit body.

**5c. Run lint and typecheck:**

```bash
vp check
```

Must pass with 0 errors.

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
Review: critical issues resolved

Next steps:
  Run `sakti status --change <name>` anytime to check state
  Run `sakti state transition <name> verify-pass` when verification passes
```

## Common Mistakes

| Mistake                                           | Fix                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| Skipping TDD when test setup exists               | Execution guide detects test setup — follow RED-GREEN-REFACTOR    |
| Implementing multiple tasks before committing     | One commit per task — keeps history traceable                     |
| Guessing at fixes when tests fail                 | Read `references/debugging-guide.md` — systematic debugging first |
| Proceeding to verify with failing tests           | Step 5a runs the full suite — all must pass before transition     |
| Skipping the final review                         | Step 5 reviews the full diff — critical issues must be resolved   |
| Re-implementing already-committed tasks on resume | Find the first unchecked task and continue from there             |
| Not recording accepted important issues           | Record acceptance rationale in commit body                        |
````

### Step 3: Verify and commit

Run: `vp check --fix`

```bash
git add packages/sakti/src/sdd/skills/sakti-build/SKILL.md
git commit -m "feat(sakti): add sakti-build phase-3 implementation skill"
```

---

## Task 3: Create execution-guide.md

Distill the essential patterns from `executing-plans`, `subagent-driven-development`, `test-driven-development`, and `verification-before-completion` into a single lean reference.

**Files:**

- Create: `packages/sakti/src/sdd/skills/sakti-build/references/execution-guide.md`

### Step 1: Write the reference

**File:** `packages/sakti/src/sdd/skills/sakti-build/references/execution-guide.md`

````markdown
# Execution Guide

How to work through the enriched tasks.md. Covers both direct and subagent modes, the TDD cycle, and commit patterns.

**IMPORTANT: This is implementation time.** You ARE writing code here — but only for the current task, following the plan. No scope creep, no "while I'm here" refactoring.

---

## The Task Loop

Regardless of execution mode, the loop is the same:

```
1. Pick the next unchecked task from tasks.md
2. Read its enriched details (goal, dependencies, files, approach, risks, testing)
3. Implement following TDD (see below)
4. Run tests — all must pass
5. Commit with a message reflecting the task goal
6. Mark the task checked in tasks.md (- [ ] → - [x])
7. Commit the task progress update
8. Move to the next unchecked task
```

**Stop and ask the user when:**

- A task is blocked by an unclear requirement or missing dependency
- Implementation reveals a design issue that needs the user's input
- A test/build failure you can't resolve after systematic debugging
- The user interrupts

**Do NOT stop between tasks otherwise.** Keep going until all tasks are done or blocked.

---

## TDD: Detect and Follow

### Step 0: Detect Test Setup

Check for testing infrastructure in the project:

- **Node/TS:** `vitest`, `jest`, `mocha` in package.json devDependencies, or a `test` script
- **Rust:** `Cargo.toml` exists (cargo test is built-in)
- **Python:** `pytest`, `unittest` in pyproject.toml or requirements.txt
- **Go:** `go.mod` exists (go test is built-in)
- **Test files:** any `*.test.ts`, `*.spec.ts`, `*_test.go`, `test_*.py` files exist

**If test setup detected:** follow TDD for all code tasks. Skip TDD only for non-code tasks (config, docs, styles).

**If no test setup detected:** ask the user "No test setup detected. Do you want to follow TDD for this change?" If yes, help set up minimal testing first. If no, implement directly.

### The TDD Cycle (per task)

```
RED:     Write one minimal failing test for the task's behavior
         Run it — MUST fail (not error) for the right reason
GREEN:   Write the simplest code that makes the test pass
         Run it — MUST pass, and all other tests still pass
REFACTOR: Clean up — extract helpers, improve names, remove duplication
          Tests must stay green
COMMIT:  One commit per task
```

**Iron law: no production code without a failing test first.** If you wrote code before the test, delete it. Start from the test.

**Skip TDD for non-code tasks:** config files, documentation, CSS-only changes. Use judgment.

---

## Direct Mode

Main session executes each task inline:

```
For each unchecked task:
  1. Read the task's enriched details from tasks.md
  2. Read the relevant source files (listed in task's "Files" field)
  3. Follow TDD cycle: write failing test → implement → verify
  4. Run the task's test command (from "Testing" field)
  5. Commit: git commit -m "<type>(<scope>): <task goal>"
  6. Mark task: - [ ] → - [x] in tasks.md
  7. Commit progress: git commit -m "chore: mark task N complete"
  8. Next task
```

---

## Subagent Mode

Main session is **coordinator only.** Dispatch a fresh subagent per task. The subagent gets the full task text and context, implements, tests, and commits.

### Per-task dispatch

```
For each unchecked task:
  1. Extract the full task text and enriched details from tasks.md
  2. Dispatch a fresh subagent with:
     - The full task text (goal, dependencies, files, approach, risks, testing)
     - Relevant context from technical-design.md
     - The instruction to follow TDD (if test setup exists)
     - The commit requirement
  3. Wait for the subagent to return
  4. Verify: check that the commit exists and tests pass
  5. If the subagent reports issues or tests fail:
     - Read references/debugging-guide.md
     - Either dispatch a fix subagent or fix inline (depending on severity)
  6. Mark task: - [ ] → - [x] in tasks.md
  7. Commit progress
  8. Next task
```

### Subagent prompt template

```
You are implementing one task from an implementation plan.

Task: <full task text from tasks.md>
Goal: <task goal>
Dependencies: <task dependencies>
Files: <key files to touch>
Approach: <implementation notes from task>
Risks: <what could go wrong>
Testing: <how to verify>

Technical design context: <relevant excerpt from technical-design.md>

Instructions:
1. Follow TDD: write a failing test first, watch it fail, implement minimal code, watch it pass
2. Keep changes minimal — only what this task requires
3. Run the test command to verify
4. Commit with message: "<type>(<scope>): <task goal>"
5. Return: what you implemented, test results, commit hash, any concerns
```

### After all tasks

After the last task, dispatch one final subagent to review the full diff:

```
Review all changes since <base_ref>:
git diff <base_ref>..HEAD

Check for:
- Critical: security vulnerabilities, data loss, broken builds
- Important: missing edge cases, incomplete error handling
- Minor: naming, style

Return: list of issues by severity, or "approved" if clean.
```

Fix critical issues. Record accepted important issues with rationale.

---

## Commit Patterns

**One commit per task.** Message format:

```
<type>(<scope>): <task goal>

<optional body explaining why, if non-obvious>
```

Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `style`

After marking a task complete in tasks.md, commit that separately:

```
chore: mark task N complete
```

This separates implementation commits from progress-tracking commits.

---

## Verification Before Claims

**Never claim a task is complete without running the verification command.**

| Claim            | Required evidence                                     |
| ---------------- | ----------------------------------------------------- |
| "Tests pass"     | Test command output: 0 failures                       |
| "Build succeeds" | Build command: exit 0                                 |
| "Task done"      | Test passes + commit exists + task marked in tasks.md |

If you haven't run the command in this message, you cannot claim it passes.

---

## Resuming After Interruption

1. Find the first unchecked task: `grep -n '\- \[ \]' tasks.md | head -1`
2. Check `git log --oneline` for recent commits — verify no work was lost
3. If there are uncommitted changes, attribute them to a task before continuing
4. Continue from the first unchecked task

Already-committed tasks must not be re-implemented.
````

### Step 2: Verify and commit

Run: `vp check --fix`

```bash
git add packages/sakti/src/sdd/skills/sakti-build/references/execution-guide.md
git commit -m "feat(sakti): add execution guide reference for sakti-build"
```

---

## Task 4: Create debugging-guide.md

Distill the essential pattern from `systematic-debugging`.

**Files:**

- Create: `packages/sakti/src/sdd/skills/sakti-build/references/debugging-guide.md`

### Step 1: Write the reference

**File:** `packages/sakti/src/sdd/skills/sakti-build/references/debugging-guide.md`

```markdown
# Debugging Guide

Use when a test, build, or runtime failure occurs during implementation. Enter this protocol BEFORE proposing any fix.

**Iron law: no fixes without root cause investigation first.** Random fixes waste time and create new bugs.

---

## When to Enter This Protocol

- A test fails unexpectedly
- The build crashes or errors
- Runtime behavior doesn't match expectations
- A previously-passing test breaks after your changes

**Especially when:** you're under time pressure, the fix "seems obvious," or you've already tried multiple fixes. Those are exactly the moments to slow down and follow the process.

---

## The Four Phases

### Phase 1: Root Cause Investigation

**BEFORE attempting any fix:**

1. **Read the error completely** — don't skim. Stack traces, line numbers, error codes. They usually contain the answer.

2. **Reproduce consistently** — can you trigger it reliably? What are the exact steps? If not reproducible, gather more data.

3. **Check recent changes** — what did you just change? `git diff` shows exactly what's different. The bug is almost always in what you just touched.

4. **Trace data flow** — where does the bad value originate? What passed it here? Keep tracing backward until you find the source. Fix at the source, not at the symptom.

### Phase 2: Pattern Analysis

1. **Find working examples** — is there similar code in the same codebase that works? What's different?
2. **Compare** — list every difference between working and broken, however small.
3. **Understand dependencies** — what does this code rely on? Config? Environment? Other modules?

### Phase 3: Hypothesis and Testing

1. **Form a single hypothesis** — "I think X is the root cause because Y." Be specific.
2. **Test minimally** — make the smallest possible change to test the hypothesis. One variable at a time.
3. **Verify** — did it work? Yes → Phase 4. No → form a NEW hypothesis. Don't stack fixes on top of each other.

### Phase 4: Implementation

1. **Write a failing test** that reproduces the bug (follow TDD cycle from execution guide).
2. **Fix the root cause** — one change, no "while I'm here" improvements.
3. **Verify** — the failing test now passes, and no other tests broke.
4. **If 3+ fixes failed:** stop. Question the architecture. Discuss with the user before attempting more fixes.

---

## Red Flags — STOP and Return to Phase 1

| Thought                                    | Reality                                                    |
| ------------------------------------------ | ---------------------------------------------------------- |
| "Quick fix for now, investigate later"     | First fix sets the pattern — do it right                   |
| "Just try changing X and see"              | Guessing wastes time — investigate first                   |
| "Add multiple changes, run tests"          | Can't isolate what worked — one change at a time           |
| "It's probably X, let me fix that"         | Seeing symptoms ≠ understanding root cause                 |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem — question the pattern |

---

## Keep It in the Current Change

The bug fix, test, and task checkoff stay in the current change. Don't start a separate "write test cases" change. The verification loop is part of the build phase.
```

### Step 2: Verify and commit

Run: `vp check --fix`

```bash
git add packages/sakti/src/sdd/skills/sakti-build/references/debugging-guide.md
git commit -m "feat(sakti): add debugging guide reference for sakti-build"
```

---

## Verification

After all tasks complete:

1. **Run full test suite:** `vp run '@sakti-code/sakti#test'` — all tests pass
2. **Run build:** `vp run '@sakti-code/sakti#build'` — builds successfully
3. **Run check:** `vp check` — 0 warnings, 0 errors
4. **Verify skill structure:** `sakti-build/SKILL.md` + `references/execution-guide.md` + `references/debugging-guide.md` all exist
