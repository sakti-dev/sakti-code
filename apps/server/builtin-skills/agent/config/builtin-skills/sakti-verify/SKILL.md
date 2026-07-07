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
