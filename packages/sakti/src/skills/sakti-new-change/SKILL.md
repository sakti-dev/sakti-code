---
name: sakti-new-change
description: Start a new Sakti change using the artifact workflow. Use when the user wants to create a new feature, fix, or modification with a structured step-by-step approach.
license: MIT
compatibility: Requires sakti CLI.
metadata:
  author: sakti
  version: "1.0"
---

Start a new change using the artifact-driven approach.

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
This creates a scaffolded change at `.sakti/changes/<name>/` with `.sakti.yaml` using the default spec-driven schema.

### 3. Show the artifact status
```bash
sakti status --change "<name>"
```
This shows which artifacts need to be created and which are ready (dependencies satisfied).

The default spec-driven schema produces artifacts in this order:
1. **proposal** (no dependencies) — ready immediately
2. **specs** (requires proposal)
3. **design** (requires proposal)
4. **tasks** (requires specs + design)

### 4. Show the first artifact guide

The first artifact is `proposal`. Present its template and guidance so the user knows what to create:

**proposal.md** establishes WHY this change is needed:

```markdown
## Why
<!-- 1-2 sentences on the problem or opportunity -->

## What Changes
<!-- Bullet list of changes. Mark breaking changes with **BREAKING** -->

## Capabilities

### New Capabilities
- `<name>`: <brief description>  <!-- kebab-case, each creates specs/<name>/spec.md -->

### Modified Capabilities
- `<existing-name>`: <what requirement is changing>  <!-- only if spec-level behavior changes -->

## Impact
<!-- Affected code, APIs, dependencies, systems -->
```

### 5. STOP and wait for user direction

## Output

After completing the steps, summarize:
- Change name and location
- Schema/workflow being used and its artifact sequence
- Current status (0/N artifacts complete)
- The template for the first artifact (proposal)
- Prompt: "Ready to create the first artifact? Just describe what this change is about and I'll draft it, or ask me to continue."

## Guardrails

- Do NOT create any artifacts yet — just show the first artifact template
- Do NOT advance beyond showing the first artifact template
- If the name is invalid (not kebab-case), ask for a valid name
- If a change with that name already exists, suggest continuing that change instead
