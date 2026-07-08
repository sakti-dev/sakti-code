---
name: sakti-verify
description: "Phase 4 verification. Use when build is complete. Verifies implementation against specs and design, runs comprehensive checks, produces a prioritized report, and handles branch merging."
---

# Sakti Verify

## Overview

Phase-4 verification skill. Confirms the implementation is correct, complete, and coherent against the specification artifacts (proposal, specs, design.md, tasks.md). Produces a prioritized report. Then handles the branch (merge/PR/keep/discard).

**Core principle:** evidence before claims. Run the commands, read the output, then report.

## When to Use

- A change has completed build and `phase` is `verify`
- The user wants to verify implementation before merging

**Do NOT use when:**

- Phase is `build` or earlier — implementation isn't complete
- Phase is `archive` — verification already passed

## Prerequisites

- Active change with `phase: verify`
- `design.md`, `tasks.md`, `specs/*/spec.md`, `proposal.md` exist
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
- `design.md` — technical design
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
3. **Coherence:** implementation follows design.md decisions, follows existing code patterns

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

### Step 4 — Handle Issues

**If CRITICAL issues exist:** write a concrete **fixing plan** (each issue + where + what to fix), then **call `transition({ to: "build", body: <fixing plan> })`**. This is an **auto** transition — build re-runs immediately, reads your fixing plan, and addresses every issue. Do not pause to ask the user; do not auto-fix (you are edit-denied). Do not print a handoff text block.

**If only WARNING/SUGGESTION:** record them in the verification report. These are surfaced to the user in the verify summary at the archive gate (below). Do not block on them.

Verify is an **autonomous** phase: do not pause mid-run to ask questions. Batch every judgment call, accepted warning, and "things adjusted mid-run" note into the verify summary — the user reviews them once at the verify→archive gate.

### Step 5 — Branch Handling

Report the current branch state (name, ahead/behind main, uncommitted files). Do **not** block on a merge/PR/keep/discard choice here — that decision belongs to the user at the verify→archive gate (or the archive phase). Just record the branch status so the summary is complete:

```bash
sakti state set <name> branch_status pending-review
```

### Step 6 — Record Verification Report

Write the verification report to disk and record it:

```bash
sakti state set <name> verification_report <report-path>
```

The report can be saved inside the change directory (e.g., `.sakti/changes/<name>/verification-report.md`) or at a project-level reports path.

### Step 7 — Hand Off (Gate or Auto)

**If verification is clean** → **call `transition({ to: "archive", body })`** where `body` is the verify summary: the verification report, the branch state, **and a "things adjusted mid-run" list** (every judgment call, accepted warning, or deviation — the user reviews these here). This is a **gate** transition: it renders a confirmation card. Do not print a separate handoff text block. Approve advances to archive; reject (NO) dismisses the card and returns control so the user can explain disagreement (you re-run verify with the feedback).

**If CRITICAL issues were found** (handled in Step 4) → you already called `transition({ to: "build" })`; this step does not apply.

## Decision Points

Step 7 is the only gate. Follow these rules:

- **Lifecycle handoffs use the `transition` tool.** Clean → `transition({ to: "archive", body })` (gate); issues → `transition({ to: "build", body: <fixing plan> })` (auto).
- **Never end a clean-verify handoff with plain text.** The `transition` call renders the card; text alone does nothing.
- Verify is autonomous — do not pause mid-run for questions. Batch refinements into the verify summary.
- Do not merge, discard, or transition before you have actually run the verification (evidence before claims).

## Exit & Handoff

The clean-verify handoff IS the `transition({ to: "archive", body })` call in Step 7 — there is no separate handoff text block. The user approves at the gate (→ archive) or rejects (→ you re-run with feedback). The branch merge/PR decision is the user's at the gate or in the archive phase.

## Common Mistakes

| Mistake                                            | Fix                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Claiming verification passed without running tests | Read `references/verification-checklist.md` — every claim needs evidence |
| Pausing mid-verify to ask the user a question      | Verify is autonomous — batch judgments into the verify summary           |
| Auto-fixing issues (you are edit-denied)           | Write a fixing plan and `transition({ to: "build" })`                    |
| Skipping spec compliance checks                    | Correctness dimension checks spec scenarios, not just tests              |
| Not recording accepted warnings                    | Record acceptance rationale in the verify summary                        |
| Ending a clean handoff with plain text             | Call `transition({ to: "archive" })`; the card is the handoff            |
