---
name: sakti-design
description: "Phase 2 deep technical design. Use when a change has completed phase 1 (planning) and needs deep technical design before implementation. Runs brainstorming, produces technical-design.md, enriches tasks.md with implementation details, and writes spec patches if gaps are discovered."
---

# Sakti Design

## Overview

Phase-2 deep design skill. Takes the phase-1 artifacts (proposal, specs, design, tasks) and runs a full brainstorming session to produce a deep technical design. Enriches tasks.md with implementation details and writes spec patches if acceptance scenario gaps are discovered.

**Core principle:** brainstorming cannot be skipped. The user must explicitly confirm the design proposal before artifacts are created.

## When to Use

- A change has completed phase 1 (planning) and `phase` is `design`
- The user explicitly asks for deep technical design on a change
- The user wants to explore implementation approaches, risks, and testing strategy before building

**Do NOT use when:**

- Phase is `open` — use sakti-plan first
- Phase is `build` or later — the design phase is already complete
- The change uses `hotfix` or `tweak` workflow (these skip the design phase)

## Prerequisites

- Active change with `phase: design` (set by `open-complete` transition for `workflow: full`)
- Phase-1 artifacts exist: proposal.md, specs/\*/spec.md, design.md, tasks.md
- The `sakti` CLI installed and available on PATH

## Output Language

Use the language of the user request that triggered this skill as the default output language. When resuming an existing change with a clear dominant artifact language, preserve that unless the user explicitly asks to switch.

## The Flow

### Step 1 — Entry Check

**1a. Verify phase.** Confirm the change is in the design phase:

```bash
sakti state get <name> phase
```

If the phase is not `design`, stop and tell the user what phase they're in and what skill to use instead.

**1b. Read phase-1 artifacts.** Load all artifacts from the change directory as context for brainstorming:

- `proposal.md` — goals, scope, non-goals
- `specs/*/spec.md` — requirements and acceptance scenarios
- `design.md` — high-level architecture decisions (from sakti-plan)
- `tasks.md` — basic task checklist

These are the input. Do not modify them during brainstorming — only after user confirmation (Step 5).

### Step 2 — Brainstorm

**Read `references/brainstorming.md`** (relative to this skill's directory) and follow its guidance to run a deep technical design brainstorming session.

The brainstorming guide covers: orienting on phase-1 artifacts, asking clarifying questions one at a time, exploring the codebase, proposing 2-3 approaches, and producing a design proposal. Do not treat one Q&A turn as sufficient — keep asking until you can produce a complete proposal with all six parts:

- **Technical approach:** chosen architecture, data flow, key decisions and rationale
- **Alternatives considered:** 2-3 alternatives with trade-offs, why rejected
- **Risks and mitigations:** table of risks, impact, and mitigation strategies
- **Testing strategy:** unit/integration/e2e approach, key test scenarios
- **Task enrichment plan:** how tasks.md will be enriched (sequencing, per-task details)
- **Spec patches:** list of acceptance scenario gaps to write back (or "None")

**Do NOT create any artifacts, write code, or modify files during brainstorming.** The brainstorming guide has a HARD-GATE: no artifacts until the user confirms the proposal (Step 3).

### Step 3 — Confirm Design Proposal (Blocking Point)

Present the design proposal summary:

- Technical approach adopted
- Key trade-offs and risks
- Testing strategy
- Spec patches to be written back (if any)
- How tasks will be enriched

Offer a single-select choice:

- **"Confirm, proceed to create artifacts"** — design proposal is accepted
- **"Needs adjustment"** — continue brainstorming iteration until confirmed

**Pause and wait for the user's explicit choice.** Do not create artifacts, set state fields, or transition before confirmation.

### Step 4 — Create technical-design.md

After the user confirms, create the technical design doc inside the change directory:

**File:** `.sakti/changes/<name>/technical-design.md`

Template:

```markdown
---
change: <change-name>
role: technical-design
---

# Technical Design: <topic>

## Context

Brief reference to proposal goals and high-level design decisions from phase 1.

## Technical Approach

Chosen approach — architecture, data flow, key technology choices and rationale.

### Architecture

[diagram or description of the technical architecture]

### Data Flow

[how data moves through the system]

### Key Decisions

- Decision 1: rationale
- Decision 2: rationale

## Alternatives Considered

2-3 alternatives with trade-offs, why rejected.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| ...  | ...    | ...        |

## Testing Strategy

Unit/integration/e2e approach, key test scenarios.

## Spec Patches

List of spec changes written back in Step 6, or "None".

## Open Questions

Unresolved items, if any.
```

### Step 5 — Enrich tasks.md

Transform the basic task checklist from phase 1 into a detailed implementation plan. For each task, add:

- **Goal:** what this task achieves
- **Dependencies:** which tasks must be done first (or "none")
- **Files:** key files to touch
- **Approach:** brief implementation notes
- **Risks:** what could go wrong
- **Testing:** how to verify this task

Enriched tasks.md format:

```markdown
# Tasks

## Task 1: <description>

**Goal:** what this task achieves
**Dependencies:** which tasks first (or "none")
**Files:** key files to touch
**Approach:** brief implementation notes
**Risks:** what could go wrong
**Testing:** how to verify

### Subtasks

- [ ] Step 1
- [ ] Step 2

---

## Task 2: <description>

...
```

Preserve the original task descriptions and ordering. Add detail, don't remove or reorder tasks unless the design revealed a better sequence (note any reordering in the technical-design.md).

### Step 6 — Write Spec Patches (if any)

If brainstorming discovered missing acceptance scenarios or ambiguous requirements:

1. Edit the relevant `specs/<capability>/spec.md` files directly
2. Add the missing acceptance scenarios or clarify ambiguous descriptions
3. List all patches in the technical-design.md "Spec Patches" section

Spec patches are limited to:

- Supplementing acceptance scenarios
- Correcting ambiguous descriptions
- Adding boundary conditions

Do NOT substantially rewrite the delta spec's structure or scope. If major changes are needed, flag them as design findings in the technical-design.md and recommend returning to sakti-plan.

### Step 7 — Transition

**7a. Record the design_doc path:**

```bash
sakti state set <name> design_doc technical-design.md
```

**7b. Run the design-complete transition:**

```bash
sakti state transition <name> design-complete
```

This verifies that `technical-design.md` exists on disk and advances the phase to `build`.

## Decision Points

Step 3 is a **blocking point**. Follow these rules:

- Pause and wait for an explicit user choice before continuing
- Use the current platform's question or confirmation tool
- If no structured tool exists, ask clear options in the conversation and stop until the user replies
- Never substitute recommendation rules, defaults, or "the user would probably agree" for current confirmation
- Do not create artifacts, set state fields, or transition before the user explicitly chooses

## Exit & Handoff

After the transition succeeds, print a short handoff block:

```
Design complete. Change: <name>
Phase: design → build

Artifacts produced:
  - technical-design.md (deep technical design)
  - tasks.md (enriched with implementation details)
  - specs/ (spec patches, if any)

Next steps:
  Load the implementation skill (e.g. sakti-apply) to start building
  Run `sakti status --change <name>` anytime to check state
```

The change is now ready for the build phase.

## Common Mistakes

| Mistake                                        | Fix                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Skipping brainstorming                         | Step 2 requires reading `references/brainstorming.md` — no exceptions                            |
| Creating artifacts before user confirmation    | Step 3 is a blocking point — wait for explicit confirmation                                      |
| Rewriting proposal/specs during brainstorming  | Brainstorming produces proposals only; artifacts are modified after confirmation                 |
| Substantially rewriting delta specs in Step 6  | Spec patches supplement acceptance scenarios only; major changes require returning to sakti-plan |
| Not reading the codebase during brainstorming  | Ground the design in actual code — don't theorize                                                |
| Forgetting to set design_doc before transition | Step 7a sets design_doc; the transition verifies the file exists                                 |
