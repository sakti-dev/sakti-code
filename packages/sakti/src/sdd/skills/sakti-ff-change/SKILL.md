---
name: sakti-ff-change
description: Fast-forward through Sakti artifact creation. Use when the user wants to quickly create all artifacts needed for implementation without stepping through each one individually.
license: MIT
compatibility: Requires sakti CLI.
metadata:
  author: sakti
  version: "1.0"
---

Fast-forward through artifact creation — generate everything needed to start implementation in one go.

**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build.

## Steps

### 1. If no clear input provided, ask what they want to build

Use the **AskUserQuestion tool** (open-ended, no preset options) to ask:

> "What change do you want to work on? Describe what you want to build or fix."

From their description, derive a kebab-case name (e.g., "add user authentication" → `add-user-auth`).

**IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

### 2. Create the change directory

```bash
sakti new change "<name>"
```

This creates a scaffolded change at `.sakti/changes/<name>/`.

### 3. Get the artifact build order

```bash
sakti status --change "<name>" --json
```

Parse the JSON to get:

- `applyRequires`: array of artifact IDs needed before implementation (e.g., `["tasks"]`)
- `artifacts`: list of all artifacts with their status and dependencies
- `changeRoot`: absolute path to the change directory
- `artifactPaths`: absolute paths for each artifact's output file

### 4. Create artifacts in sequence until apply-ready

Use the **TodoWrite tool** to track progress through the artifacts.

Loop through artifacts in dependency order (artifacts with no pending dependencies first):

a. **For each artifact that is `ready` (dependencies satisfied)**:

- Read any completed dependency files for context
- Follow the artifact guide below to create the file
- Write to the path from `artifactPaths[<artifact-id>].resolvedOutputPath`
- Show brief progress: "✓ Created `<artifact-id>`"

b. **Continue until all `applyRequires` artifacts are complete**

- After creating each artifact, re-run `sakti status --change "<name>" --json`
- Check if every artifact ID in `applyRequires` has `status: "done"`
- Stop when all `applyRequires` artifacts are done

c. **If an artifact requires user input** (unclear context):

- Use **AskUserQuestion tool** to clarify
- Then continue with creation

### 5. Show final status

```bash
sakti status --change "<name>"
```

## Artifact Guide

The default spec-driven schema dependency chain: `proposal` → `specs` + `design` → `tasks`.

### proposal.md — Why this change is needed

```markdown
## Why

<!-- 1-2 sentences on the problem or opportunity -->

## What Changes

<!-- Bullet list of changes. Mark breaking changes with **BREAKING** -->

## Capabilities

### New Capabilities

- `<name>`: <brief description> <!-- kebab-case, each creates specs/<name>/spec.md -->

### Modified Capabilities

- `<existing-name>`: <what requirement is changing>

## Impact

<!-- Affected code, APIs, dependencies, systems -->
```

The Capabilities section is critical — it creates the contract between proposal and specs phases.

---

### specs/<capability>/spec.md — What the system should do

Create one spec file per capability listed in the proposal's Capabilities section.

```markdown
## ADDED Requirements

### Requirement: <name>

<!-- requirement text -->

#### Scenario: <name>

- **WHEN** <condition>
- **THEN** <expected outcome>
```

**Delta operations**: `## ADDED Requirements`, `## MODIFIED Requirements` (full content), `## REMOVED Requirements` (with Reason + Migration), `## RENAMED Requirements` (FROM:/TO:).

**CRITICAL**: Scenarios MUST use exactly 4 hashtags (`####`). Every requirement MUST have at least one scenario.

---

### design.md — How to implement (optional)

Skip if not applicable. Include for cross-cutting changes, new dependencies, or complexity.

```markdown
## Context

<!-- Background, current state -->

## Goals / Non-Goals

**Goals:**

<!-- What this design achieves -->

**Non-Goals:**

<!-- What's out of scope -->

## Decisions

<!-- Key technical choices with rationale -->

## Risks / Trade-offs

<!-- Format: [Risk] → Mitigation -->
```

---

### tasks.md — Implementation checklist

```markdown
## 1. <Task Group Name>

- [ ] 1.1 <Task description>
- [ ] 1.2 <Task description>

## 2. <Task Group Name>

- [ ] 2.1 <Task description>
```

Each task MUST be: `- [ ] X.Y Task description`. Tasks should be small and ordered by dependency.

## Output

After completing all artifacts, summarize:

- Change name and location
- List of artifacts created with brief descriptions
- "All artifacts created! Ready for implementation."
- Prompt: "Run `/sakti:apply` to start implementing."

## Guardrails

- Create ALL artifacts needed for implementation (as defined by `sakti status`)
- Always read dependency artifacts before creating a new one
- If context is critically unclear, ask the user — but prefer making reasonable decisions to keep momentum
- If a change with that name already exists, suggest continuing that change instead
- Verify each artifact file exists after writing before proceeding to next
- Read `.sakti/config.yaml` if it exists — it may contain `context` and `rules` that constrain what you write.
