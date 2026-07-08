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

**If test setup detected:** follow TDD for all code tasks. **Read `references/tdd-guide.md`** (relative to the skill's directory) for the full RED-GREEN-REFACTOR cycle, good/bad test patterns, and common rationalizations to avoid. Skip TDD only for non-code tasks (config, docs, styles).

**If no test setup detected:** ask the user "No test setup detected. Do you want to follow TDD for this change?" If yes, help set up minimal testing first. If no, implement directly.

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
     - Relevant context from design.md
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

Technical design context: <relevant excerpt from design.md>

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
