# sakti-design Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the `sakti-design` phase-2 skill that runs deep technical design brainstorming and produces a technical design doc, enriched tasks, and spec patches.

**Architecture:** A new skill at `packages/sakti/src/sdd/skills/sakti-design/SKILL.md` that loads the brainstorming skill, uses phase-1 artifacts as context, and produces `technical-design.md` + enriched `tasks.md` + spec patches inside the change directory. The `design-complete` state transition is enhanced to verify the design doc file exists on disk.

**Tech Stack:** TypeScript (state machine), Markdown (SKILL.md), Vitest (tests), Zod (schema), `sakti` CLI commands.

---

## Task 1: Enhance `design-complete` transition to verify file exists (TDD)

The current `design-complete` transition checks that `design_doc` is truthy but doesn't verify the file exists on disk. The error message already says "must point to an existing Design Doc" — the code should match that contract, consistent with `open-complete` which checks artifact files via `fs.access`.

**Files:**

- Modify: `packages/sakti/src/sdd/commands/state.ts:155-162` (design-complete case)
- Test: `packages/sakti/src/sdd/commands/__tests__/state.test.ts:166-177` (update existing tests + add new)

### Step 1: Update the "design-complete requires design_doc" test

The existing test at line 166 seeds `phase: design` with no `design_doc` and expects failure. This test stays valid — no design_doc means no file to check.

No change needed to this test.

### Step 2: Add failing test — design_doc file must exist

Add a new test after the existing "design-complete advances to build" test:

**File:** `packages/sakti/src/sdd/commands/__tests__/state.test.ts`

Add after line 177 (after the "advances to build" test):

```typescript
it("design-complete fails when design_doc file does not exist", async () => {
  seed("full", "design", { design_doc: "technical-design.md" });
  await expect(
    stateTransition(changeDir, "design-complete", { projectRoot: tmpDir }),
  ).rejects.toThrow(/design_doc.*exist|exist.*design_doc/i);
});
```

### Step 3: Update existing "advances to build" test to create the file

The existing test seeds `design_doc: "docs/design.md"` but never creates the file. After adding the file existence check, it would fail. Update it:

**File:** `packages/sakti/src/sdd/commands/__tests__/state.test.ts:173-177`

Replace:

```typescript
it("design-complete advances to build when design_doc is set", async () => {
  seed("full", "design", { design_doc: "docs/design.md" });
  await stateTransition(changeDir, "design-complete", { projectRoot: tmpDir });
  expect(await readField("phase")).toBe("build");
});
```

With:

```typescript
it("design-complete advances to build when design_doc is set and file exists", async () => {
  seed("full", "design", { design_doc: "technical-design.md" });
  await fs.writeFile(path.join(changeDir, "technical-design.md"), "# Technical Design");
  await stateTransition(changeDir, "design-complete", { projectRoot: tmpDir });
  expect(await readField("phase")).toBe("build");
});
```

### Step 4: Run tests to verify they fail

Run: `vp run '@sakti-code/sakti#test'`

Expected:

- New test "fails when design_doc file does not exist" should PASS (current code doesn't check file existence, so transition succeeds — wait, actually the current code would NOT throw, so the `rejects.toThrow` would fail). Actually — the current code would advance to build without error, so the test expecting a throw will FAIL. Good — that's our RED.
- Updated test "advances to build when design_doc is set and file exists" should PASS (file exists, current code doesn't check it but doesn't fail either).

So the RED signal is: the new "fails when file does not exist" test fails because the transition currently succeeds without the file.

### Step 5: Implement the file existence check

**File:** `packages/sakti/src/sdd/commands/state.ts:155-162`

Replace the `design-complete` case:

```typescript
    case "design-complete": {
      requirePhase("design");
      if (!metadata.design_doc) {
        throw new Error(
          "Cannot transition 'design-complete': design_doc must point to an existing Design Doc before leaving design",
        );
      }
      try {
        await fs.access(path.join(changeDir, metadata.design_doc));
      } catch {
        throw new Error(
          `Cannot transition 'design-complete': design_doc file '${metadata.design_doc}' does not exist`,
        );
      }
      apply({ phase: "build" });
      break;
    }
```

### Step 6: Run tests to verify they pass

Run: `vp run '@sakti-code/sakti#test'`

Expected: All tests pass, including the new file-existence test and the updated existing test.

### Step 7: Run lint and typecheck

Run: `vp check`

Expected: 0 warnings, 0 errors.

### Step 8: Commit

```bash
git add packages/sakti/src/sdd/commands/state.ts packages/sakti/src/sdd/commands/__tests__/state.test.ts
git commit -m "feat(sakti): design-complete transition verifies design_doc file exists"
```

---

## Task 2: Create `sakti-design` SKILL.md

Create the phase-2 deep design skill. This skill loads the brainstorming skill, uses phase-1 artifacts as context, and produces `technical-design.md`, enriched `tasks.md`, and optional spec patches.

**Files:**

- Create: `packages/sakti/src/sdd/skills/sakti-design/SKILL.md`

### Step 1: Create the skill directory

```bash
mkdir -p packages/sakti/src/sdd/skills/sakti-design
```

### Step 2: Write the SKILL.md

**File:** `packages/sakti/src/sdd/skills/sakti-design/SKILL.md`

````markdown
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

**2a. Load the brainstorming skill.** Use the Skill tool to load `brainstorming`. Skipping this step is prohibited.

When loading, the brainstorming context must include:

```
Change: <change-name>
Phase-1 artifacts: read from .sakti/changes/<name>/

Focus: deep technical design based on the phase-1 artifacts. Explore:
- Implementation approach: architecture, data flow, key technology choices
- Technical risks and mitigations
- Testing strategy (unit, integration, e2e)
- Task sequencing and dependencies
- Spec gaps: missing acceptance scenarios, ambiguous requirements

Do NOT rewrite proposal or specs during brainstorming. If spec gaps are found, flag them as Spec Patch candidates for Step 5.
```

**2b. Explore the codebase.** During brainstorming, read the actual codebase to ground the design in reality:

- Map existing architecture relevant to the change
- Find integration points and patterns already in use
- Identify hidden complexity and dependencies
- Surface risks that aren't visible from the artifacts alone

**2c. Produce a design proposal.** Through the brainstorming dialogue, produce:

- **Technical approach:** chosen architecture, data flow, key decisions and rationale
- **Alternatives considered:** 2-3 alternatives with trade-offs, why rejected
- **Risks and mitigations:** table of risks, impact, and mitigation strategies
- **Testing strategy:** unit/integration/e2e approach, key test scenarios
- **Task enrichment plan:** how tasks.md will be enriched (sequencing, per-task details)
- **Spec patches:** list of acceptance scenario gaps to write back (or "None")

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
| Skipping brainstorming                         | Step 2 requires loading the brainstorming skill — no exceptions                                  |
| Creating artifacts before user confirmation    | Step 3 is a blocking point — wait for explicit confirmation                                      |
| Rewriting proposal/specs during brainstorming  | Brainstorming produces proposals only; artifacts are modified after confirmation                 |
| Substantially rewriting delta specs in Step 6  | Spec patches supplement acceptance scenarios only; major changes require returning to sakti-plan |
| Not reading the codebase during brainstorming  | Ground the design in actual code — don't theorize                                                |
| Forgetting to set design_doc before transition | Step 7a sets design_doc; the transition verifies the file exists                                 |
````

### Step 3: Verify no lint/typecheck issues

Run: `vp check`

Expected: 0 warnings, 0 errors (SKILL.md is a markdown file, shouldn't trigger lint issues).

### Step 4: Commit

```bash
git add packages/sakti/src/sdd/skills/sakti-design/SKILL.md
git commit -m "feat(sakti): add sakti-design phase-2 deep design skill"
```

---

## Verification

After both tasks are complete:

1. **Run full test suite:** `vp run '@sakti-code/sakti#test'` — all tests pass
2. **Run build:** `vp run '@sakti-code/sakti#build'` — builds successfully
3. **Run check:** `vp check` — 0 warnings, 0 errors
4. **Manual check:** The `sakti-design/SKILL.md` exists and follows the same frontmatter pattern as other skills
