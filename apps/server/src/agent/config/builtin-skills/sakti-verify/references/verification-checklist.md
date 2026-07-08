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

Read `design.md`. For each key decision:

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
