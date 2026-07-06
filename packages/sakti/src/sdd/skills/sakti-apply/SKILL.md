---
name: sakti-apply
description: Implement tasks from a Sakti change. Use when the user wants to start implementing, continue implementation, or work through tasks.
license: MIT
compatibility: Requires sakti CLI.
metadata:
  author: sakti
  version: "1.0"
---

Implement tasks from a Sakti change.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

## Steps

### 1. Select the change

If a name is provided, use it. Otherwise:

- Infer from conversation context if the user mentioned a change
- Auto-select if only one active change exists
- If ambiguous, run `sakti list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

Always announce: "Using change: `<name>`" and how to override (e.g., `/sakti:apply <other>`).

### 2. Check status to understand the schema

```bash
sakti status --change "<name>" --json
```

Parse the JSON to understand:

- `schemaName`: The workflow being used (e.g., "spec-driven")
- `artifacts`: List of artifacts with their status
- `changeRoot`: Absolute path to the change directory
- `artifactPaths`: Absolute paths for each artifact file
- `isComplete`: Whether all artifacts are done

**Handle states:**

- If artifacts are not done (status shows `ready` or `blocked`): show message, suggest using `/sakti:continue`
- If `isComplete: true`: congratulate, suggest archive
- Otherwise: proceed to implementation

### 3. Read context files

Read the following files from `changeRoot` (paths available in `artifactPaths`):

- **proposal.md** — the "why"
- **specs/**/\*.md\*\* — the requirements and scenarios
- **design.md** — the technical approach (if it exists)
- **tasks.md** — the implementation checklist

### 4. Show current progress

Parse `tasks.md` checkboxes: `- [ ]` (incomplete) vs `- [x]` (complete).

Display:

- Schema being used
- Progress: "N/M tasks complete"
- Remaining tasks overview

### 5. Implement tasks (loop until done or blocked)

For each pending task:

- Show which task is being worked on
- Make the code changes required
- Keep changes minimal and focused
- Mark task complete in the tasks file: `- [ ]` → `- [x]`
- Continue to next task

**Pause if:**

- Task is unclear → ask for clarification
- Implementation reveals a design issue → suggest updating artifacts
- Error or blocker encountered → report and wait for guidance
- User interrupts

### 6. On completion or pause, show status

Display:

- Tasks completed this session
- Overall progress: "N/M tasks complete"
- If all done: suggest archive
- If paused: explain why and wait for guidance

## Output During Implementation

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

## Output On Completion

```
## Implementation Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2
...

All tasks complete! Ready to archive this change.
```

## Output On Pause (Issue Encountered)

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

## Guardrails

- Keep going through tasks until done or blocked
- Always read context files (proposal, specs, design, tasks) before starting
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements — don't guess

## Fluid Workflow Integration

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts — not phase-locked, work fluidly
