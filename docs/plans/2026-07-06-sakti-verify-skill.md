# sakti-verify Skill + sakti-build Step 5 Simplification

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move comprehensive verification from sakti-build to sakti-verify. Build does a basic sanity check; verify does the thorough work (completeness, correctness, coherence, code review, branch handling).

**Architecture:** Two parts: (1) simplify sakti-build Step 5 from "final review" to "basic sanity check" (tasks checked + tests pass); (2) create sakti-verify with 3-dimension verification, prioritized report, branch handling, and state transition.

**Tech Stack:** TypeScript (state machine), Markdown (skill).

---

## Task 1: Simplify sakti-build Step 5

Replace the comprehensive "Final Review" with a basic sanity check. Remove diff review, critical/important/minor triage, and lint/typecheck — those move to sakti-verify.

**Files:**

- Modify: `packages/sakti/src/sdd/skills/sakti-build/SKILL.md:103-136`

### Step 1: Replace Step 5

Replace the entire `### Step 5 — Final Review` section (lines 103-136) with:

````markdown
### Step 5 — Sanity Check

After all tasks are checked:

**5a. Confirm all tasks are marked complete:**

```bash
grep -c '\- \[ \]' tasks.md
```
````

Must return 0 (no unchecked tasks). If any remain, return to Step 3.

**5b. Run test suite:**

```bash
vp run -r test
```

If any tests fail, return to Step 3 and fix the failures. Do not proceed until all tests pass.

````

### Step 2: Update Common Mistakes table

Remove the row about skipping the final review and the row about recording accepted important issues:

Replace:

```markdown
| Skipping the final review                               | Step 5 reviews the full diff — critical issues must be resolved            |
| Re-implementing already-committed tasks on resume       | Find the first unchecked task and continue from there                     |
| Not recording accepted important issues                  | Record acceptance rationale in commit body                                 |
````

With:

```markdown
| Transitioning to verify with failing tests | Step 5b runs the test suite — all must pass before transition |
| Re-implementing already-committed tasks on resume | Find the first unchecked task and continue from there |
```

### Step 3: Update Exit & Handoff block

Replace the handoff block to remove review mention:

```markdown
After the transition succeeds, print a short handoff block:
```

Build complete. Change: <name>
Phase: build → verify

Tasks: N/N complete
Tests: all passing

Next steps:
Run `sakti status --change <name>` anytime to check state

```

```

### Step 4: Verify and commit

Run: `vp check --fix`

```bash
git add packages/sakti/src/sdd/skills/sakti-build/SKILL.md
git commit -m "refactor(sakti): simplify sakti-build Step 5 to sanity check

Move comprehensive verification (diff review, spec compliance, code
review, lint/typecheck) to sakti-verify. Build now only confirms
tasks are checked and tests pass before transitioning."
```

---

## Task 2: Create sakti-verify SKILL.md

Create the phase-4 verification skill.

**Files:**

- Create: `packages/sakti/src/sdd/skills/sakti-verify/SKILL.md`

### Step 1: Create the skill directory

```bash
mkdir -p packages/sakti/src/sdd/skills/sakti-verify/references
```

### Step 2: Write the SKILL.md

**File:** `packages/sakti/src/sdd/skills/sakti-verify/SKILL.md`

````markdown
---
name: sakti-verify
description: "Phase 4 verification. Use when build is complete. Verifies implementation against specs and design, runs comprehensive checks, produces a prioritized report, and handles branch merging."
---

# Sakti Verify

## Overview

Phase-4 verification skill. Confirms the implementation is correct, complete, and coherent against the phase-1/2 artifacts. Produces a prioritized report. Then handles the branch (merge/PR/keep/discard).

**Core principle:** evidence before claims. Run the commands, read the output, then report.

## When to Use

- A change has completed build and `phase` is `verify`
- The user wants to verify implementation before merging

**Do NOT use when:**

- Phase is `build` or earlier — implementation isn't complete
- Phase is `archive` — verification already passed

## Prerequisites

- Active change with `phase: verify`
- `technical-design.md`, `tasks.md`, `specs/*/spec.md`, `proposal.md` exist
- The `sakti` CLI installed and available on PATH

## Output Language

Use the language of the user request that triggered this skill as the default output language.

## The Flow

### Step 1 — Entry Check

**1a. Identify the change.** The change name is inferred from the mission session context. If not available, ask the user.

**1b. Verify phase:**

```bash
sakti state get <name> phase
```

If the phase is not `verify`, stop and tell the user what phase they're in.

**1c. Read context:**

- `tasks.md` — task checklist
- `technical-design.md` — deep technical design
- `specs/*/spec.md` — requirements and acceptance scenarios
- `proposal.md` — goals and scope

**1d. Get base_ref for diff:**

```bash
sakti state get <name> base_ref
```

This is the commit hash before implementation started — used to scope the review.

### Step 2 — Run Verification

**Read `references/verification-checklist.md`** (relative to this skill's directory) and follow its guidance to run the three verification dimensions:

1. **Completeness:** all tasks checked, all spec requirements implemented
2. **Correctness:** tests pass, build passes, lint clean, spec scenarios covered
3. **Coherence:** implementation follows technical-design.md decisions, follows existing code patterns

The checklist covers exactly what to check, how to check it, and the report format.

### Step 3 — Produce Verification Report

Write a prioritized report:

```markdown
## Verification Report: <change-name>

### Summary

| Dimension    | Status   |
| ------------ | -------- |
| Completeness | X/Y      |
| Correctness  | X/Y      |
| Coherence    | Followed |

### Issues

#### CRITICAL

(must fix before merge — missing implementation, broken tests, security issues)

#### WARNING

(should fix — spec divergence, missing edge case tests, design deviation)

#### SUGGESTION

(nice to fix — pattern inconsistency, naming, minor improvements)
```

If no issues found:

```
All checks passed. Ready for merge.
```

### Step 4 — Handle Issues (Blocking Point)

**If CRITICAL issues exist:** present them and ask the user:

- **"Fix critical issues"** — run `sakti state transition <name> verify-fail` to roll back to build. The user fixes in build, then re-transitions to verify.
- **"Accept all deviations"** — record acceptance rationale for each CRITICAL issue in the verification report. Only allow this after explicit user confirmation.

**If only WARNING/SUGGESTION:** report them. The user can choose to fix or accept. Record accepted warnings in the verification report.

**Pause and wait for the user's explicit choice.** Do not auto-fix, auto-accept, or auto-transition.

### Step 5 — Branch Handling (Blocking Point)

After verification passes (or deviations are accepted), present branch options:

```
Implementation verified. What would you like to do?

1. Merge back to main
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work
```

**Pause and wait for the user's explicit choice.**

**Option 1: Merge locally**

```bash
git checkout main
git merge <branch-name>
# Run tests on merged result
<test command>
# If tests pass, clean up
git branch -d <branch-name>
```

**Option 2: Push and create PR**

```bash
git push -u origin <branch-name>
gh pr create --title "<title>" --body "<description>"
```

**Option 3: Keep as-is**

Report: "Keeping branch `<name>`. Worktree preserved."

**Option 4: Discard**

Confirm first — this permanently deletes all work. Wait for explicit "discard" confirmation.

```bash
git checkout main
git branch -D <branch-name>
```

After the chosen option completes, record the branch status:

```bash
sakti state set <name> branch_status handled
```

### Step 6 — Record Verification Report

Write the verification report to disk and record it:

```bash
sakti state set <name> verification_report <report-path>
```

The report can be saved inside the change directory (e.g., `.sakti/changes/<name>/verification-report.md`) or at a project-level reports path.

### Step 7 — Transition

```bash
sakti state transition <name> verify-pass
```

This verifies that `verification_report` is set and `branch_status` is `handled`, then advances the phase to `archive`.

## Decision Points

Steps 4 and 5 are **blocking points.** Follow these rules at each:

- Pause and wait for an explicit user choice before continuing
- Use the current platform's question or confirmation tool
- Never substitute recommendation rules or defaults for current confirmation
- Do not transition, merge, or discard before the user explicitly chooses

## Exit & Handoff

After the transition succeeds, print a short handoff block:

```
Verification complete. Change: <name>
Phase: verify → archive

Verification: passed (or: passed with N accepted warnings)
Branch: merged / PR created / kept / discarded

Next steps:
  Run `sakti status --change <name>` anytime to check state
  Run `sakti state transition <name> archived` to archive the change
```

## Common Mistakes

| Mistake                                            | Fix                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Claiming verification passed without running tests | Read `references/verification-checklist.md` — every claim needs evidence |
| Auto-accepting CRITICAL issues                     | Step 4 is a blocking point — user must explicitly accept                 |
| Merging without user confirmation                  | Step 5 is a blocking point — user must explicitly choose                 |
| Skipping spec compliance checks                    | Correctness dimension checks spec scenarios, not just tests              |
| Not recording accepted warnings                    | Record acceptance rationale in the verification report                   |
| Discarding work without confirmation               | Option 4 requires typed "discard" confirmation                           |
````

### Step 3: Verify and commit

Run: `vp check --fix`

```bash
git add packages/sakti/src/sdd/skills/sakti-verify/SKILL.md
git commit -m "feat(sakti): add sakti-verify phase-4 verification skill"
```

---

## Task 3: Create verification-checklist.md

Distill the verification patterns from OpenSpec's verify spec, comet-verify, and `verification-before-completion`.

**Files:**

- Create: `packages/sakti/src/sdd/skills/sakti-verify/references/verification-checklist.md`

### Step 1: Write the reference

**File:** `packages/sakti/src/sdd/skills/sakti-verify/references/verification-checklist.md`

````markdown
# Verification Checklist

Three dimensions of verification, each with specific checks. Run every check, collect evidence, then produce the report.

**Iron law: no completion claims without fresh verification evidence.** If you haven't run the command in this message, you cannot claim it passes.

---

## Dimension 1: Completeness

"Is all the required work done?"

### Check 1.1: Task completion

```bash
grep -c '\- \[ \]' tasks.md
```

Must return 0. If any tasks are unchecked (`- [ ]`), report as CRITICAL.

### Check 1.2: Spec requirement coverage

For each requirement in `specs/*/spec.md`:

1. Extract the requirement name and acceptance scenarios
2. Search the codebase for implementation (grep for relevant function/class names, file paths mentioned in the spec)
3. Assess: is this requirement implemented?

If a requirement has no implementation found → report as CRITICAL.
If implementation exists but appears partial → report as WARNING.

### Check 1.3: Proposal goals satisfied

Read `proposal.md` goals. For each goal:

1. Identify what artifacts/code address this goal
2. Assess: is the goal met?

If a goal has no corresponding implementation → report as WARNING.

---

## Dimension 2: Correctness

"Does the implementation work and match the specs?"

### Check 2.1: Test suite passes

```bash
vp run -r test
```

Must pass with 0 failures. If any fail → CRITICAL.

### Check 2.2: Build passes

```bash
vp run -r build
```

Must succeed (exit 0). If build fails → CRITICAL.

### Check 2.3: Lint and typecheck clean

```bash
vp check
```

Must pass with 0 errors. Warnings are acceptable but report as SUGGESTION.

### Check 2.4: Spec scenario coverage

For each acceptance scenario in `specs/*/spec.md`:

1. Identify the scenario's conditions and expected behavior
2. Check if tests exist that cover this scenario
3. Check if the code handles the scenario's conditions

If a scenario has no test coverage → report as WARNING.
If a scenario's conditions aren't handled in code → report as CRITICAL.

### Check 2.5: Security scan

Review the diff for obvious security issues:

```bash
git diff <base_ref>..HEAD
```

Check for:

- Hardcoded secrets, API keys, passwords
- New unsafe operations (eval, exec with user input, SQL injection vectors)
- Missing input validation on new endpoints/functions

If found → CRITICAL.

---

## Dimension 3: Coherence

"Does the implementation follow the design and project patterns?"

### Check 3.1: Technical design adherence

Read `technical-design.md`. For each key decision:

1. Identify what the decision states
2. Check if the implementation follows it
3. If the implementation deviates, is the deviation documented?

If implementation contradicts a key decision without documentation → WARNING.
If implementation follows all decisions → confirmed.

### Check 3.2: Code pattern consistency

Check if new code follows existing project patterns:

- Naming conventions (consistent with surrounding code)
- File organization (where new files are placed)
- Error handling patterns
- Import/export style

Significant deviations → SUGGESTION.

### Check 3.3: Diff review

```bash
git log --oneline <base_ref>..HEAD
git diff <base_ref>..HEAD --stat
```

Review the full diff for:

- Leftover debug code (console.log, debugger, etc.)
- Commented-out code blocks
- TODO/FIXME without context
- Files that shouldn't have been changed

Leftover debug code → WARNING. Others → SUGGESTION.

---

## Report Format

After all checks, produce a structured report:

```markdown
## Verification Report: <change-name>

### Summary

| Dimension    | Status   | Details            |
| ------------ | -------- | ------------------ |
| Completeness | X/Y      | tasks, specs       |
| Correctness  | X/Y      | tests, build, lint |
| Coherence    | Followed | design, patterns   |

### Issues

#### CRITICAL

(must fix before merge)

- [C1] <description> — <evidence: file:line, test output, etc.>

#### WARNING

(should fix or explicitly accept)

- [W1] <description> — <recommendation>

#### SUGGESTION

(nice to fix)

- [S1] <description>
```

### Issue severity guidelines

| Severity   | Examples                                                            |
| ---------- | ------------------------------------------------------------------- |
| CRITICAL   | Missing implementation, broken tests, build failure, security issue |
| WARNING    | Spec divergence, missing test coverage, design deviation            |
| SUGGESTION | Pattern inconsistency, naming, minor improvements                   |

When severity is unclear, downgrade. Only use CRITICAL for build failures, test failures, and security issues.

---

## Verification Before Claims

**Never claim a check passed without running it in this session.**

| Claim                | Required evidence                        |
| -------------------- | ---------------------------------------- |
| "Tests pass"         | Test command output: 0 failures          |
| "Build succeeds"     | Build command: exit 0                    |
| "Lint clean"         | Lint command: 0 errors                   |
| "Spec covered"       | Requirement → implementation mapping     |
| "No security issues" | Diff reviewed: no secrets, no unsafe ops |

If you haven't run the command, you cannot claim it passes. "Should work" is not evidence.
````

### Step 2: Verify and commit

Run: `vp check --fix`

```bash
git add packages/sakti/src/sdd/skills/sakti-verify/references/verification-checklist.md
git commit -m "feat(sakti): add verification checklist reference for sakti-verify"
```

---

## Verification

After all tasks complete:

1. **Run full test suite:** `vp run '@sakti-code/sakti#test'` — all tests pass
2. **Run check:** `vp check` — 0 warnings, 0 errors
3. **Verify skill structure:** `sakti-verify/SKILL.md` + `references/verification-checklist.md` exist
4. **Verify sakti-build Step 5** is simplified to sanity check only
