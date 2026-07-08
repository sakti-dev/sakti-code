---
name: sakti-specify
description: "Specify phase. Use when a change has completed planning and needs detailed specification before implementation. Branches on workflow: full → brainstorming (interactive), hotfix → autonomous. Produces design.md + tasks.md, writes spec deltas only when behavior changes."
---

# Sakti Specify

## Overview

Specify-phase skill. Takes the plan-phase proposal and produces the detailed specification: `design.md` + `tasks.md` (always), and spec deltas (only when the change modifies behavior). Branches on the change's `workflow`:

- **`full`** → brainstorming mode (interactive): read `references/brainstorming.md`
- **`hotfix`** → autonomous mode (no brainstorming): read `references/autonomous.md`

**Core principle:** `tasks.md` is always produced — the build phase (and future per-task subagents) depend on it. Spec files are written only when there's a real behavior delta.

## When to Use

- A change has completed planning (`phase: specify`, set by `open-complete`) and needs detailed specification.

**Do NOT use when:**

- Phase is `open` — complete planning first (sakti-plan)
- Phase is `build` or later — specification is already complete

## Prerequisites

- Active change with `phase: specify`
- `proposal.md` exists (produced by the plan phase)
- The `sakti` CLI installed and available on PATH

## Output Language

Use the language of the user request that triggered this skill as the default output language. When resuming an existing change with a clear dominant artifact language, preserve it unless the user explicitly asks to switch.

## The Flow

### Step 1 — Entry: Read Workflow + Branch

**1a. Read the workflow.**

```bash
sakti state get <name> workflow
```

**1b. Branch on workflow:**

- `full` → **brainstorming mode**: read `references/brainstorming.md` and follow it.
- `hotfix` → **autonomous mode**: read `references/autonomous.md` and follow it.

**1c. Read the proposal.** Load `proposal.md` as the input for either mode.

### Step 2 — Run the Mode

**Brainstorming mode (full):** Interactive — ask clarifying questions one at a time, explore the codebase, propose 2-3 approaches, present a design proposal, and wait for user confirmation (blocking). Then produce:

- spec deltas (requirements + acceptance scenarios per capability) — because `full` changes modify behavior
- `design.md` (the technical design — single doc)
- `tasks.md` (checkbox tasks)

**Autonomous mode (hotfix):** No brainstorming. Drive the complete solution independently, grounded in the actual code. Produce `design.md` + `tasks.md`. Write **no** spec file unless escalation triggers (below).

### Step 3 — Escalation (hotfix → full, only if triggered)

If autonomous mode discovers the change actually needs a behavior change or new spec:

1. Flip the workflow: `sakti state set <name> workflow full`
2. Switch to brainstorming mode — read `references/brainstorming.md` and follow it
3. Ask the user how they want to design the spec change
4. Produce spec deltas + design.md + tasks.md via the brainstorming flow

This keeps records honest: a misclassified hotfix self-corrects rather than producing a shallow result.

### Step 4 — Artifacts

**Single design.md** (drop the old technical-design.md — there is one design doc per change):

```markdown
# Design: <topic>

## Context

Brief reference to proposal goals.

## Technical Approach

Architecture, data flow, key decisions and rationale.

### Key Decisions

- Decision 1: rationale

## Alternatives Considered

2-3 alternatives with trade-offs, why rejected.

## Risks & Mitigations

| Risk | Impact | Mitigation |

## Testing Strategy

Unit/integration/e2e approach, key test scenarios.

## Open Questions

Unresolved items, if any.
```

**tasks.md** — checkbox format (the build phase parses `- [ ] N.Y`):

```markdown
## 1. <area>

- [ ] 1.1 <task>
- [ ] 1.2 <task>
```

**Specs** — written **only** when there's a real behavior delta. Full changes usually produce some; hotfix usually produces none (unless escalated). Follow the spec-driven schema's delta operations (ADDED/MODIFIED/REMOVED/RENAMED).

### Step 5 — Hand Off to Build (Gate)

When the specification is ready, **call `transition({ to: "build", body })`** where `body` summarizes `design.md` + `tasks.md` (and any spec deltas). This is a **gate** transition: it renders a confirmation card — the card IS the end-of-specify review. Do not print a separate handoff text block.

- **Approve** → the phase advances to `build` (status flips to `building`).
- **Reject (NO)** → the card is dismissed; you re-run with the user's feedback and revise the spec, then call `transition({ to: "build" })` again.

In **brainstorming mode (full)**, you may hold an interactive design review (plain-text Q&A) before calling `transition`. In **autonomous mode (hotfix)**, drive straight to the transition once the artifacts are complete — do not pause for questions.

## Decision Points

Steps 5 (and the brainstorming-mode confirmation inside `references/brainstorming.md`) are **blocking points**:

- **Lifecycle handoffs use the `transition` tool.** Specify→build is `transition({ to: "build", body })` — a gate that renders the review card. Open design questions (brainstorming mode) are plain-text Q&A: ask, then end your turn; the user replies.
- **Never end the specify→build handoff with plain text.** The `transition` call renders the card and advances the phase on approval — text alone does nothing.
- Pause and wait for an explicit user choice before continuing.

## Exit & Handoff

After the specify→build gate is approved:

```
Specification complete. Change: <name>
Phase: specify → build

Artifacts produced:
  - design.md (technical design)
  - tasks.md (implementation checklist)
  - specs/ (deltas, if any behavior change)

Next steps:
  Run `sakti status --change <name>` anytime to check state
```

The change is now ready for the build phase.

## Common Mistakes

| Mistake                                                             | Fix                                                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Creating technical-design.md instead of design.md                   | There is ONE design doc: `design.md`. technical-design.md no longer exists                |
| Skipping the specify→build gate                                     | Step 5 calls `transition({ to: "build" })` — the card is the review; wait for approval    |
| Writing spec deltas in hotfix/autonomous mode                       | Any behavior change triggers escalation to `full` + brainstorming, not silent spec writes |
| Running brainstorming for a hotfix                                  | hotfix uses autonomous mode (references/autonomous.md); brainstorming is for `full`       |
| Forgetting tasks.md                                                 | tasks.md is mandatory for every change (build + future subagents depend on it)            |
| Ending the handoff with plain text instead of the `transition` tool | The specify→build handoff uses `transition`; open design questions use plain text         |
