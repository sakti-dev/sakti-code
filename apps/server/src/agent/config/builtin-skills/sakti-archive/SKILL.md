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
| Trying to sync specs manually                 | The CLI handles sync programmatically — don't edit main specs         |
| Archiving with unverified changes             | Step 1c checks `verify_result: pass` — must pass before archive       |
| Ignoring CLI errors                           | If `sakti archive` errors, report and stop — do not force the archive |
