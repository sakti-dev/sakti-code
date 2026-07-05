---
name: sakti-verify-change
description: Verify implementation matches change artifacts. Use when the user wants to validate that implementation is complete, correct, and coherent before archiving.
license: MIT
compatibility: Requires sakti CLI.
metadata:
  author: sakti
  version: "1.0"
---

Verify that an implementation matches the change artifacts (specs, tasks, design).

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

## Steps

### 1. If no change name provided, prompt for selection

Run `sakti list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select.

Show changes that have implementation tasks (tasks artifact exists).
Mark changes with incomplete tasks as "(In Progress)".

**IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

### 2. Check status and load artifacts
```bash
sakti status --change "<name>" --json
```
Parse the JSON to get:
- `changeRoot`: absolute path to the change directory
- `artifactPaths`: absolute paths for each artifact file

Read all available artifacts from `changeRoot`:
- `<changeRoot>/proposal.md`
- `<changeRoot>/specs/*/spec.md`
- `<changeRoot>/design.md` (if exists)
- `<changeRoot>/tasks.md`

### 3. Initialize verification report structure

Create a report with three dimensions:
- **Completeness**: Track tasks and spec coverage
- **Correctness**: Track requirement implementation and scenario coverage
- **Coherence**: Track design adherence and pattern consistency

Each dimension can have CRITICAL, WARNING, or SUGGESTION issues.

### 4. Verify Completeness

**Task Completion**:
- Read `tasks.md` and parse checkboxes: `- [ ]` (incomplete) vs `- [x]` (complete)
- Count complete vs total tasks
- If incomplete tasks exist:
  - Add CRITICAL issue for each incomplete task
  - Recommendation: "Complete task: <description>" or "Mark as done if already implemented"

**Spec Coverage**:
- Extract all requirements from delta specs (lines matching `### Requirement:`)
- For each requirement:
  - Search codebase for keywords related to the requirement
  - Assess if implementation likely exists
- If requirements appear unimplemented:
  - Add CRITICAL issue: "Requirement not found: <requirement name>"

### 5. Verify Correctness

**Requirement Implementation Mapping**:
- For each requirement from delta specs:
  - Search codebase for implementation evidence
  - If found, note file paths and line ranges
  - Assess if implementation matches requirement intent
  - If divergence detected:
    - Add WARNING: "Implementation may diverge from spec: <details>"

**Scenario Coverage**:
- For each scenario in delta specs (lines matching `#### Scenario:`):
  - Check if conditions are handled in code
  - Check if tests exist covering the scenario
  - If scenario appears uncovered:
    - Add WARNING: "Scenario not covered: <scenario name>"

### 6. Verify Coherence

**Design Adherence**:
- If `design.md` exists:
  - Extract key decisions (look for sections like "Decision:", "Approach:", "Architecture:")
  - Verify implementation follows those decisions
  - If contradiction detected:
    - Add WARNING: "Design decision not followed: <decision>"
- If no design.md: Skip, note "No design.md to verify against"

**Code Pattern Consistency**:
- Review new code for consistency with project patterns
- Check file naming, directory structure, coding style
- If significant deviations found:
  - Add SUGGESTION: "Code pattern deviation: <details>"

### 7. Generate Verification Report

**Summary Scorecard**:
```
## Verification Report: <change-name>

### Summary
| Dimension    | Status           |
|--------------|------------------|
| Completeness | X/Y tasks, N reqs|
| Correctness  | M/N reqs covered |
| Coherence    | Followed/Issues  |
```

**Issues by Priority**:

1. **CRITICAL** (Must fix before archive):
   - Incomplete tasks
   - Missing requirement implementations

2. **WARNING** (Should fix):
   - Spec/design divergences
   - Missing scenario coverage

3. **SUGGESTION** (Nice to fix):
   - Pattern inconsistencies

**Final Assessment**:
- If CRITICAL issues: "X critical issue(s) found. Fix before archiving."
- If only warnings: "No critical issues. Y warning(s) to consider. Ready for archive (with noted improvements)."
- If all clear: "All checks passed. Ready for archive."

## Verification Heuristics

- **Completeness**: Focus on objective checklist items (checkboxes, requirements list)
- **Correctness**: Use keyword search, file path analysis, reasonable inference — don't require perfect certainty
- **Coherence**: Look for glaring inconsistencies, don't nitpick style
- **False Positives**: When uncertain, prefer SUGGESTION over WARNING, WARNING over CRITICAL
- **Actionability**: Every issue must have a specific recommendation with file/line references

## Graceful Degradation

- If only tasks.md exists: verify task completion only, skip spec/design checks
- If tasks + specs exist: verify completeness and correctness, skip design
- If full artifacts: verify all three dimensions
- Always note which checks were skipped and why

## Guardrails

- Use `sakti status --json` to get `changeRoot` and `artifactPaths`
- Read all available artifacts from the change directory
- Don't require perfect certainty — reasonable inference is fine
- Code references in format: `file.ts:123`
- Specific, actionable recommendations — no vague suggestions
