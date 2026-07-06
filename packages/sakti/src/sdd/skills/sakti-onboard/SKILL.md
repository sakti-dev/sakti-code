---
name: sakti-onboard
description: Guided onboarding for Sakti - walk through a complete workflow cycle with narration and real codebase work.
license: MIT
compatibility: Requires sakti CLI.
metadata:
  author: sakti
  version: "1.0"
---

Guide the user through their first complete Sakti workflow cycle. This is a teaching experience — you'll do real work in their codebase while explaining each step.

---

## Preflight

Before starting, check if the Sakti CLI is installed:

```bash
sakti --version 2>&1 || echo "CLI_NOT_INSTALLED"
```

**If CLI not installed:**

> Sakti CLI is not installed. Install it first, then come back to `/sakti:onboard`.

Stop here if not installed.

---

## Phase 1: Welcome

Display:

```
## Welcome to Sakti!

I'll walk you through a complete change cycle — from idea to implementation — using a real task in your codebase. Along the way, you'll learn the workflow by doing it.

**What we'll do:**
1. Pick a small, real task in your codebase
2. Explore the problem briefly
3. Create a change (the container for our work)
4. Build the artifacts: proposal → specs → design → tasks
5. Implement the tasks
6. Archive the completed change

**Time:** ~15-20 minutes

Let's start by finding something to work on.
```

---

## Phase 2: Task Selection

### Codebase Analysis

Scan the codebase for small improvement opportunities. Look for:

1. **TODO/FIXME comments** — Search for `TODO`, `FIXME`, `HACK`, `XXX` in code files
2. **Missing error handling** — `catch` blocks that swallow errors, risky operations without try-catch
3. **Functions without tests** — Cross-reference `src/` with test directories
4. **Type issues** — `any` types in TypeScript files (`: any`, `as any`)
5. **Debug artifacts** — `console.log`, `console.debug`, `debugger` statements in non-debug code
6. **Missing validation** — User input handlers without validation

Also check recent git activity:

```bash
git log --oneline -10 2>/dev/null || echo "No git history"
```

### Present Suggestions

From your analysis, present 3-4 specific suggestions:

```
## Task Suggestions

Based on scanning your codebase, here are some good starter tasks:

**1. [Most promising task]**
   Location: `src/path/to/file.ts:42`
   Scope: ~1-2 files, ~20-30 lines
   Why it's good: [brief reason]

**2. [Second task]**
   Location: `src/another/file.ts`
   Scope: ~1 file, ~15 lines

**3. [Third task]**
   Location: [location]
   Scope: [estimate]

**4. Something else?**
   Tell me what you'd like to work on.

Which task interests you?
```

### Scope Guardrail

If the user picks something too large:

```
That's a valuable task, but it's probably larger than ideal for your first Sakti run-through.

For learning the workflow, smaller is better.

**Options:**
1. **Slice it smaller** — What's the smallest useful piece?
2. **Pick something else** — One of the other suggestions
3. **Do it anyway** — If you really want to tackle this

What would you prefer?
```

---

## Phase 3: Explore Demo

Once a task is selected, briefly demonstrate explore mode:

```
Before we create a change, let me quickly show you **explore mode** — it's how you think through problems before committing to a direction.
```

Spend 1-2 minutes investigating the relevant code:

- Read the file(s) involved
- Draw a quick ASCII diagram if it helps
- Note any considerations

```
Explore mode (`/sakti:explore`) is for this kind of thinking — investigating before implementing. You can use it anytime.

Now let's create a change to hold our work.
```

**PAUSE** — Wait for user acknowledgment.

---

## Phase 4: Create the Change

**EXPLAIN:**

```
## Creating a Change

A "change" in Sakti is a container for all the thinking and planning around a piece of work. It lives in `.sakti/changes/<name>/` and holds your artifacts — proposal, specs, design, tasks.
```

**DO:**

```bash
sakti new change "<derived-name>"
```

**SHOW:**

```
Created: `.sakti/changes/<name>/`

The folder structure:
.sakti/changes/<name>/
├── proposal.md    ← Why we're doing this (empty)
├── design.md      ← How we'll build it (empty)
├── specs/         ← Detailed requirements (empty)
└── tasks.md       ← Implementation checklist (empty)
```

---

## Phase 5: Proposal

**EXPLAIN:**

```
## The Proposal

The proposal captures **why** we're making this change and **what** it involves at a high level.
```

**DO:** Draft the proposal content (don't save yet):

```
## Why
[1-2 sentences explaining the problem/opportunity]

## What Changes
[Bullet points of what will be different]

## Capabilities

### New Capabilities
- `<capability-name>`: [brief description]

## Impact
- `src/path/to/file.ts`: [what changes]
```

**PAUSE** — Wait for user approval.

After approval, save to `.sakti/changes/<name>/proposal.md`.

---

## Phase 6: Specs

**EXPLAIN:**

```
## Specs

Specs define **what** we're building in precise, testable terms. They use a requirement/scenario format that makes expected behavior crystal clear.
```

**DO:** Create the spec file:

```bash
mkdir -p .sakti/changes/<name>/specs/<capability-name>
```

Draft the spec:

```
## ADDED Requirements

### Requirement: <Name>

<Description>

#### Scenario: <Scenario name>

- **WHEN** <trigger condition>
- **THEN** <expected outcome>
```

Save to `.sakti/changes/<name>/specs/<capability>/spec.md`.

---

## Phase 7: Design

**EXPLAIN:**

```
## Design

The design captures **how** we'll build it — technical decisions, tradeoffs, approach.

For small changes, this might be brief.
```

**DO:** Draft design.md:

```
## Context
[Brief context]

## Goals / Non-Goals

**Goals:**
- [What we're trying to achieve]

## Decisions

### Decision 1: [Key decision]
[Explanation]
```

Save to `.sakti/changes/<name>/design.md`.

---

## Phase 8: Tasks

**EXPLAIN:**

```
## Tasks

Finally, we break the work into implementation tasks — checkboxes that drive the apply phase.
```

**DO:** Generate tasks:

```
## 1. [Category]

- [ ] 1.1 [Specific task]
- [ ] 1.2 [Specific task]

## 2. Verify

- [ ] 2.1 [Verification step]
```

**PAUSE** — Wait for user to confirm they're ready to implement.

Save to `.sakti/changes/<name>/tasks.md`.

---

## Phase 9: Apply (Implementation)

**EXPLAIN:**

```
## Implementation

Now we implement each task, checking them off as we go.
```

**DO:** For each task:

1. Announce: "Working on task N: [description]"
2. Implement the change
3. Reference specs/design naturally: "The spec says X, so I'm doing Y"
4. Mark complete in tasks.md: `- [ ]` → `- [x]`
5. Brief status: "✓ Task N complete"

After all tasks:

```
## Implementation Complete

All tasks done. The change is implemented! One more step — let's archive it.
```

---

## Phase 10: Archive

**EXPLAIN:**

```
## Archiving

When a change is complete, we archive it. This moves it from `.sakti/changes/` to `.sakti/changes/archive/YYYY-MM-DD-<name>/`.

Archived changes become your project's decision history.
```

**DO:**

```bash
sakti archive "<name>"
```

---

## Phase 11: Recap & Next Steps

```
## Congratulations!

You just completed a full Sakti cycle:

1. **Explore** — Thought through the problem
2. **New** — Created a change container
3. **Proposal** — Captured WHY
4. **Specs** — Defined WHAT in detail
5. **Design** — Decided HOW
6. **Tasks** — Broke it into steps
7. **Apply** — Implemented the work
8. **Archive** — Preserved the record

## Command Reference

**Core workflow:**

 | Command              | What it does                               |
 |----------------------|--------------------------------------------|
 | `/sakti:propose`     | Create a change and generate all artifacts |
 | `/sakti:explore`     | Think through problems before/during work  |
 | `/sakti:apply`       | Implement tasks from a change              |
 | `/sakti:archive`     | Archive a completed change                 |

**Additional commands:**

 | Command                | What it does                        |
 |------------------------|-------------------------------------|
 | `/sakti:new-change`    | Start a new change, step by step    |
 | `/sakti:continue`      | Continue an existing change         |
 | `/sakti:ff-change`     | Fast-forward: all artifacts at once |
 | `/sakti:verify-change` | Verify implementation               |

Try `/sakti:propose` on something you actually want to build!
```

---

## Graceful Exit Handling

### User wants to stop mid-way

```
No problem! Your change is saved at `.sakti/changes/<name>/`.

To pick up where we left off later:
- `/sakti:continue <name>` — Resume artifact creation
- `/sakti:apply <name>` — Jump to implementation

The work won't be lost. Come back whenever you're ready.
```

## Guardrails

- **Follow the EXPLAIN → DO → SHOW → PAUSE pattern** at key transitions
- **Keep narration light** during implementation — teach without lecturing
- **Don't skip phases** even if the change is small — the goal is teaching the workflow
- **Pause for acknowledgment** at marked points, but don't over-pause
- **Handle exits gracefully** — never pressure the user to continue
- **Use real codebase tasks** — don't simulate or use fake examples
- **Adjust scope gently** — guide toward smaller tasks but respect user choice
