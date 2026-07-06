# sakti-archive Skill + Old Skills Cleanup

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the `sakti-archive` phase-5 skill (final phase) and delete all 8 old OpenSpec-derived skills that are now superseded by the 5 phase skills.

**Architecture:** sakti-archive is the simplest skill — orchestration around the existing `sakti archive` CLI which handles spec sync (delta to main) and directory move. One blocking point (final confirmation). Then delete 8 old skills.

**Tech Stack:** Markdown (skill), `sakti` CLI.

---

## Task 1: Create sakti-archive SKILL.md

**Files:**

- Create: `packages/sakti/src/sdd/skills/sakti-archive/SKILL.md`

### Step 1: Create the skill directory

```bash
mkdir -p packages/sakti/src/sdd/skills/sakti-archive
```

### Step 2: Write the SKILL.md

**File:** `packages/sakti/src/sdd/skills/sakti-archive/SKILL.md`

````markdown
---
name: sakti-archive
description: "Phase 5 archive. Use when verification passed. Syncs delta specs into main specs, moves the change to archive, and marks it complete."
---

# Sakti Archive

## Overview

Phase-5 archive skill. Finalizes a change by syncing delta specs into main specs and moving the change directory to archive. The `sakti archive` CLI handles spec merging programmatically (RENAMED → REMOVED → MODIFIED → ADDED) — the skill is orchestration and final confirmation.

**Core principle:** archive is irreversible. The user must explicitly confirm before it happens.

## When to Use

- A change has passed verification and `phase` is `archive`
- The user wants to finalize and archive a completed change

**Do NOT use when:**

- Phase is `verify` or earlier — verification must pass first
- The change is already archived (`archived: true`)

## Prerequisites

- Active change with `phase: archive`
- `verify_result: pass` (enforced by state transition)
- The `sakti` CLI installed and available on PATH

## Output Language

Use the language of the user request that triggered this skill as the default output language.

## The Flow

### Step 1 — Entry Check

**1a. Identify the change.** The change name is inferred from the mission session context. If not available, ask the user.

**1b. Verify phase:**

```bash
sakti state get <name> phase
```

If the phase is not `archive`, stop and tell the user what phase they're in.

**1c. Confirm verification passed:**

```bash
sakti state get <name> verify_result
```

Must be `pass`. If not, stop — the change is not ready for archive.

### Step 2 — Preview Archive

Show the user what will happen:

**2a. Check for delta specs:**

```bash
ls .sakti/changes/<name>/specs/*/spec.md 2>/dev/null
```

If delta specs exist, report: "Delta specs will be synced to main specs during archive."

**2b. Show summary:**

```
Archive Summary for: <name>

Specs to sync: <list of capabilities, or "none">
Archive target: .sakti/changes/archive/YYYY-MM-DD-<name>/

This will:
  1. Sync delta specs into main specs (programmatically, atomic)
  2. Move the change directory to archive
  3. Mark the change as archived

This is irreversible.
```

### Step 3 — Final Confirmation (Blocking Point)

Present a single-select choice:

- **"Confirm archive"** — proceed with archive
- **"Needs adjustment"** — run `sakti state transition <name> archive-reopen` to return to verify phase
- **"Not yet"** — keep the current state, wait for later

**Pause and wait for the user's explicit choice.** Do not archive before confirmation.

### Step 4 — Execute Archive

**4a. Set archived state (before the move):**

```bash
sakti state transition <name> archived
```

This sets `archived: true` in `.sakti.yaml`. Must happen before the directory move.

**4b. Run archive (syncs specs + moves directory):**

```bash
sakti archive <name> --yes
```

The CLI handles:

1. Validate delta specs
2. Sync delta specs into main specs (atomic: prepare all → validate → write)
3. Move change to `.sakti/changes/archive/YYYY-MM-DD-<name>/`

If the CLI returns an error, report it and stop. Do not attempt manual fixes.

### Step 5 — Complete

Report the archive result:

```
Archive complete. Change: <name>
Phase: archive (complete)

Specs synced: <N capabilities updated, or "none">
Archived to: .sakti/changes/archive/YYYY-MM-DD-<name>/

The change lifecycle is complete.
```

## Decision Points

Step 3 is a **blocking point.** Follow these rules:

- Pause and wait for an explicit user choice before continuing
- Use the current platform's question or confirmation tool
- Never auto-archive based on "it looks ready"
- Do not run `sakti archive` before the user explicitly confirms

## Common Mistakes

| Mistake                                       | Fix                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Archiving without user confirmation           | Step 3 is a blocking point — wait for explicit confirmation           |
| Running archive before setting archived state | Step 4a sets `archived: true` before the CLI moves the directory      |
| Trying to sync specs manually                 | The CLI handles sync programmatically — don't edit main specs by hand |
| Archiving with unverified changes             | Step 1c checks `verify_result: pass` — must pass before archive       |
| Ignoring CLI errors                           | If `sakti archive` errors, report and stop — do not force the archive |
````

### Step 3: Verify and commit

Run: `vp check --fix`

```bash
git add packages/sakti/src/sdd/skills/sakti-archive/SKILL.md
git commit -m "feat(sakti): add sakti-archive phase-5 archive skill"
```

---

## Task 2: Delete 8 old OpenSpec-derived skills

Delete all old skills superseded by the 5 phase skills. No `.ts` code references them.

**Files to delete:**

- `packages/sakti/src/sdd/skills/sakti-archive-change/SKILL.md`
- `packages/sakti/src/sdd/skills/sakti-sync-specs/SKILL.md`
- `packages/sakti/src/sdd/skills/sakti-bulk-archive-change/SKILL.md`
- `packages/sakti/src/sdd/skills/sakti-propose/SKILL.md`
- `packages/sakti/src/sdd/skills/sakti-continue-change/SKILL.md`
- `packages/sakti/src/sdd/skills/sakti-ff-change/SKILL.md`
- `packages/sakti/src/sdd/skills/sakti-new-change/SKILL.md`
- `packages/sakti/src/sdd/skills/sakti-onboard/SKILL.md`

### Step 1: Delete all old skill directories

```bash
rm -rf packages/sakti/src/sdd/skills/sakti-archive-change
rm -rf packages/sakti/src/sdd/skills/sakti-sync-specs
rm -rf packages/sakti/src/sdd/skills/sakti-bulk-archive-change
rm -rf packages/sakti/src/sdd/skills/sakti-propose
rm -rf packages/sakti/src/sdd/skills/sakti-continue-change
rm -rf packages/sakti/src/sdd/skills/sakti-ff-change
rm -rf packages/sakti/src/sdd/skills/sakti-new-change
rm -rf packages/sakti/src/sdd/skills/sakti-onboard
```

### Step 2: Verify remaining skills

```bash
ls packages/sakti/src/sdd/skills/
```

Expected output — exactly 5 phase skills:

```
sakti-archive
sakti-build
sakti-design
sakti-plan
sakti-verify
```

### Step 3: Verify and commit

Run: `vp check`

```bash
git add -A
git commit -m "refactor(sakti): delete 8 old OpenSpec-derived skills

All functionality is now covered by the 5 phase skills:
sakti-plan, sakti-design, sakti-build, sakti-verify, sakti-archive.

Deleted: sakti-archive-change, sakti-sync-specs,
sakti-bulk-archive-change, sakti-propose, sakti-continue-change,
sakti-ff-change, sakti-new-change, sakti-onboard."
```

---

## Verification

After all tasks complete:

1. **Run full test suite:** `vp run '@sakti-code/sakti#test'` — all tests pass
2. **Run check:** `vp check` — 0 warnings, 0 errors
3. **Verify skill structure:** exactly 5 skills remain:
   - `sakti-plan/` (phase 1)
   - `sakti-design/` (phase 2)
   - `sakti-build/` (phase 3)
   - `sakti-verify/` (phase 4)
   - `sakti-archive/` (phase 5)
4. **No old skill references remain:** `rg "sakti-archive-change|sakti-sync-specs|sakti-bulk|sakti-propose|sakti-continue|sakti-ff-change|sakti-new-change|sakti-onboard" packages/sakti/src/` returns nothing
