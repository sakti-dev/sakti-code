---
name: sakti-propose
description: Propose a new change with all artifacts generated in one step. Use when the user wants to quickly describe what they want to build and get a complete proposal with design, specs, and tasks ready for implementation.
license: MIT
compatibility: Requires sakti CLI.
metadata:
  author: sakti
  version: "1.0"
---

Propose a new change — create the change and generate all artifacts in one step.

I'll create a change with artifacts:
- `proposal.md` (what & why)
- `specs/**/*.md` (what the system should do)
- `design.md` (how — optional)
- `tasks.md` (implementation steps)

When ready to implement, run `/sakti:apply`

---

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
This creates a scaffolded change at `.sakti/changes/<name>/` with `.sakti.yaml`.

### 3. Get the artifact build order
```bash
sakti status --change "<name>" --json
```
Parse the JSON to get:
- `applyRequires`: array of artifact IDs needed before implementation (e.g., `["tasks"]`)
- `artifacts`: list of all artifacts with their status and dependencies
- `changeRoot`: absolute path to the change directory
- `artifactPaths`: absolute paths for each artifact's output file

### 4. Create artifacts in dependency order

The default spec-driven schema dependency chain: `proposal` → `specs` + `design` → `tasks`.

Use **TodoWrite** to track progress through the artifacts.

For each artifact that is `ready` (dependencies satisfied):
1. Read any completed dependency files for context
2. Follow the artifact guide below to create the file
3. Write to the path from `artifactPaths[<artifact-id>].resolvedOutputPath`
4. Show brief progress: "Created `<artifact-id>`"

After each artifact, re-run `sakti status --change "<name>" --json` to confirm. Stop when all `applyRequires` artifacts are done.

If an artifact requires user input (unclear context), use **AskUserQuestion tool** to clarify.

---

## Artifact Guide

### proposal.md — Why this change is needed

Write to: `<changeRoot>/proposal.md`

Create the proposal document that establishes **WHY** this change is needed.

**Template structure:**
```markdown
## Why
<!-- 1-2 sentences on the problem or opportunity. What problem does this solve? Why now? -->

## What Changes
<!-- Bullet list of changes. Be specific about new capabilities, modifications, or removals. Mark breaking changes with **BREAKING**. -->

## Capabilities

### New Capabilities
<!-- Capabilities being introduced. Each becomes a new specs/<name>/spec.md. Use kebab-case. -->
- `<name>`: <brief description>

### Modified Capabilities
<!-- Existing capabilities whose REQUIREMENTS are changing. Only include if spec-level behavior changes. Check .sakti/specs/ for existing names. Leave empty if no requirement changes. -->
- `<existing-name>`: <what requirement is changing>

## Impact
<!-- Affected code, APIs, dependencies, or systems. -->
```

**Guidance:**
- The Capabilities section is critical — it creates the contract between proposal and specs phases. Research existing specs in `.sakti/specs/` before filling this in.
- Keep it concise (1-2 pages). Focus on the "why" not the "how".

---

### specs/**/*.md — What the system should do

Write to: `<changeRoot>/specs/<capability>/spec.md` (one per capability from proposal)

Create specification files that define **WHAT** the system should do.

Create one spec file per capability listed in the proposal's Capabilities section:
- New capabilities: use the exact kebab-case name from the proposal
- Modified capabilities: use the existing spec folder name from `.sakti/specs/<capability>/`

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
- Each requirement: `### Requirement: <name>` followed by description
- Use SHALL/MUST for normative requirements (avoid should/may)
- Each scenario: `#### Scenario: <name>` with WHEN/THEN format
- **CRITICAL**: Scenarios MUST use exactly 4 hashtags (`####`). Using 3 or fewer will fail silently.
- Every requirement MUST have at least one scenario.

**MODIFIED requirements workflow:**
1. Locate the existing requirement in `.sakti/specs/<capability>/spec.md`
2. Copy the ENTIRE requirement block (from `### Requirement:` through all scenarios)
3. Paste under `## MODIFIED Requirements` and edit to reflect new behavior
4. Ensure header text matches exactly (whitespace-insensitive)

Common pitfall: Using MODIFIED with partial content loses detail at archive time. If adding new concerns without changing existing behavior, use ADDED instead.

Specs should be testable — each scenario is a potential test case.

---

### design.md — How to implement the change

Write to: `<changeRoot>/design.md`

Create the design document that explains **HOW** to implement the change.

**Skip if not applicable** (small, straightforward changes). Include when:
- Cross-cutting change (multiple services/modules) or new architectural pattern
- New external dependency or significant data model changes
- Security, performance, or migration complexity
- Ambiguity that benefits from technical decisions before coding

**Template structure:**
```markdown
## Context
<!-- Background, current state, constraints, stakeholders -->

## Goals / Non-Goals

**Goals:**
<!-- What this design aims to achieve -->

**Non-Goals:**
<!-- What is explicitly out of scope -->

## Decisions
<!-- Key technical choices with rationale (why X over Y?). Include alternatives considered. -->

## Risks / Trade-offs
<!-- Known limitations, things that could go wrong. Format: [Risk] → Mitigation -->

## Migration Plan
<!-- Steps to deploy, rollback strategy (if applicable) -->

## Open Questions
<!-- Outstanding decisions or unknowns to resolve -->
```

Focus on architecture and approach, not line-by-line implementation. Reference the proposal for motivation and specs for requirements.

---

### tasks.md — Implementation checklist

Write to: `<changeRoot>/tasks.md`

Create the task list that breaks down the implementation work.

**IMPORTANT: Follow this format exactly.** The apply phase parses checkbox format to track progress.

**Template structure:**
```markdown
## 1. <Task Group Name>

- [ ] 1.1 <Task description>
- [ ] 1.2 <Task description>

## 2. <Task Group Name>

- [ ] 2.1 <Task description>
- [ ] 2.2 <Task description>
```

**Guidelines:**
- Group related tasks under `##` numbered headings
- Each task MUST be a checkbox: `- [ ] X.Y Task description`
- Tasks should be small enough to complete in one session
- Order tasks by dependency (what must be done first?)
- Reference specs for what needs to be built, design for how to build it
- Each task should be verifiable — you know when it's done

---

### 5. Show final status
```bash
sakti status --change "<name>"
```

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
- If a change with that name already exists, ask if user wants to continue it or create a new one
- Verify each artifact file exists after writing before proceeding to next
- Read `.sakti/config.yaml` if it exists — it may contain `context` and `rules` that constrain what you write. These are constraints for YOU, not content for the file.
