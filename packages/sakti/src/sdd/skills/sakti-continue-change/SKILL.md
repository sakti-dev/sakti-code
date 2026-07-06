---
name: sakti-continue-change
description: Continue working on a Sakti change by creating the next artifact. Use when the user wants to progress their change, create the next artifact, or continue their workflow.
license: MIT
compatibility: Requires sakti CLI.
metadata:
  author: sakti
  version: "1.0"
---

Continue working on a change by creating the next artifact.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

## Steps

### 1. If no change name provided, prompt for selection

Run `sakti list --json` to get available changes sorted by most recently modified. Then use the **AskUserQuestion tool** to let the user select which change to work on.

Present the top 3-4 most recently modified changes as options, showing:

- Change name
- Schema (from `schema` field if present, otherwise "spec-driven")
- Status (e.g., "0/5 tasks", "complete", "no tasks")
- How recently it was modified (from `lastModified` field)

Mark the most recently modified change as "(Recommended)".

**IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

### 2. Check current status

```bash
sakti status --change "<name>" --json
```

Parse the JSON to understand current state:

- `schemaName`: The workflow schema being used (e.g., "spec-driven")
- `artifacts`: Array of artifacts with their status ("done", "ready", "blocked")
- `changeRoot`: Absolute path to the change directory
- `artifactPaths`: Absolute paths for each artifact file
- `isComplete`: Boolean indicating if all artifacts are complete

### 3. Act based on status

---

**If all artifacts are complete (`isComplete: true`)**:

- Congratulate the user
- Show final status including the schema used
- Suggest: "All artifacts created! You can now implement this change or archive it."
- STOP

---

**If artifacts are ready to create** (status shows artifacts with `status: "ready"`):

- Pick the FIRST artifact with `status: "ready"`
- Read any completed dependency files for context
- Follow the artifact guide below to create the file
- Write to the path from `artifactPaths[<artifact-id>].resolvedOutputPath`
- Show what was created and what's now unlocked
- STOP after creating ONE artifact

---

**If no artifacts are ready (all blocked)**:

- This shouldn't happen with a valid schema
- Show status and suggest checking for issues

### 4. After creating an artifact, show progress

```bash
sakti status --change "<name>"
```

## Artifact Guide

The spec-driven schema has four artifacts. Use the matching guide for the one you're creating.

### proposal.md — Why this change is needed

**Template structure:**

```markdown
## Why

<!-- 1-2 sentences on the problem or opportunity -->

## What Changes

<!-- Bullet list of changes. Mark breaking changes with **BREAKING** -->

## Capabilities

### New Capabilities

- `<name>`: <brief description> <!-- kebab-case, each creates specs/<name>/spec.md -->

### Modified Capabilities

- `<existing-name>`: <what requirement is changing> <!-- only if spec-level behavior changes -->

## Impact

<!-- Affected code, APIs, dependencies, systems -->
```

The Capabilities section is critical — it creates the contract between proposal and specs phases. Research existing specs in `.sakti/specs/` before filling this in.

---

### specs/<capability>/spec.md — What the system should do

Create one spec file per capability listed in the proposal's Capabilities section.

**Template structure:**

```markdown
## ADDED Requirements

### Requirement: <name>

<!-- requirement text -->

#### Scenario: <name>

- **WHEN** <condition>
- **THEN** <expected outcome>
```

**Delta operations** (use `##` headers):

- **ADDED Requirements**: New capabilities
- **MODIFIED Requirements**: Changed behavior — MUST include full updated content
- **REMOVED Requirements**: Deprecated features — MUST include **Reason** and **Migration**
- **RENAMED Requirements**: Name changes only — use FROM:/TO: format

**Format rules:**

- Use SHALL/MUST for normative requirements (avoid should/may)
- **CRITICAL**: Scenarios MUST use exactly 4 hashtags (`####`)
- Every requirement MUST have at least one scenario

---

### design.md — How to implement the change

**Skip if not applicable** (small, straightforward changes). Include when the change is cross-cutting, has new dependencies, or has security/performance/migration complexity.

**Template structure:**

```markdown
## Context

<!-- Background, current state, constraints -->

## Goals / Non-Goals

**Goals:**

<!-- What this design aims to achieve -->

**Non-Goals:**

<!-- What is explicitly out of scope -->

## Decisions

<!-- Key technical choices with rationale -->

## Risks / Trade-offs

<!-- Known limitations. Format: [Risk] → Mitigation -->
```

---

### tasks.md — Implementation checklist

**Template structure:**

```markdown
## 1. <Task Group Name>

- [ ] 1.1 <Task description>
- [ ] 1.2 <Task description>

## 2. <Task Group Name>

- [ ] 2.1 <Task description>
```

Each task MUST be a checkbox: `- [ ] X.Y Task description`. The apply phase parses checkbox format to track progress.

## Output

After each invocation, show:

- Which artifact was created
- Schema workflow being used
- Current progress (N/M complete)
- What artifacts are now unlocked
- Prompt: "Want to continue? Just ask me to continue or tell me what to do next."

## Guardrails

- Create ONE artifact per invocation
- Always read dependency artifacts before creating a new one
- Never skip artifacts or create out of order
- If context is unclear, ask the user before creating
- Verify the artifact file exists after writing
- Read `.sakti/config.yaml` if it exists — it may contain `context` and `rules` that constrain what you write. These are constraints for YOU, not content for the file.
