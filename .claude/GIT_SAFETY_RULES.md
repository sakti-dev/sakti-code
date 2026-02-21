# CRITICAL: Git Safety Rules for AI Assistants

## The Mistake That Must Never Happen Again

**Date: 2026-02-22**

### What Happened

When investigating a bug in `model-selector.tsx`, the AI assistant ran these commands:

```bash
git stash && npm run test  # To check if test failures were pre-existing
git stash pop              # Restored changes
```

After `git stash pop`, there were many staged new files (user's uncommitted work):
- `src/components/settings-dialog/*.tsx` (13 new files)
- `src/components/ui/dialog-sidebar.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/switch.tsx`
- `tests/unit/components/dialog-sidebar.test.tsx`
- `tests/unit/components/settings-dialog.test.tsx`
- `docs/plans/2026-02-21-dialog-sidebar-implementation.md`

The AI then ran:
```bash
git reset HEAD              # Unstaged everything
rm -rf src/components/settings-dialog/*.tsx ...  # DELETED ALL UNCOMMITTED WORK
```

**The AI did not realize these were NEW files that had never been committed.**
When `git checkout -- <file>` is run on a new (untracked/staged) file, git says "did not match any files" - but `rm -rf` permanently deletes them.

### Root Cause

1. The AI assumed all staged files were modifications to existing tracked files
2. The AI used `rm -rf` without first checking what files were NEW vs MODIFIED
3. The AI did not understand that `git stash pop` restores staged new files

---

## Mandatory Rules When Resetting/Cleaning

### Rule 1: NEVER Use `rm -rf` on Files You Didn't Create

**FORBIDDEN:**
```bash
rm -rf src/some/path/*.tsx
rm -rf any/directory
```

**If you need to clean up, use git:**
```bash
git checkout -- <file>           # Only for MODIFIED tracked files
git restore <file>               # Only for MODIFIED tracked files
git clean -fd                    # Removes untracked files (ASK FIRST)
```

### Rule 2: ALWAYS Check What You're About to Delete

Before ANY deletion command, run:
```bash
git status --porcelain
```

Look for:
- `M ` = Modified (tracked file changed) - SAFE to checkout/restore
- `A ` = Added (new file staged) - **DANGER** - `git checkout` won't help, `rm` deletes forever
- `??` = Untracked - **DANGER** - not in git at all
- ` D` = Deleted (staged deletion) - can be recovered from git

### Rule 3: For Uncommitted New Files, ASK THE USER

If you see staged new files (`A `) that you didn't create in this session:
```
STOP. These are the user's uncommitted work. Do NOT delete them.
Ask the user what to do.
```

### Rule 4: The Safe Branch Reset Procedure

If you need to reset to a clean state:

1. **Check what you're about to lose:**
   ```bash
   git status
   git diff --stat
   ```

2. **Identify YOUR changes vs USER's changes:**
   - Files you modified in THIS conversation = safe to revert
   - Files that were already staged when conversation started = ASK USER
   - New files you created in THIS conversation = safe to delete
   - New files that were already staged = DO NOT DELETE

3. **Only revert YOUR changes:**
   ```bash
   # For specific files you modified
   git checkout -- path/to/file/you/modified.tsx
   
   # For new files YOU created (be 100% sure)
   rm path/to/file/you/created.tsx
   ```

4. **If unsure, STASH instead of delete:**
   ```bash
   git stash push -m "backup before reset"
   # Now you have a safety net
   ```

### Rule 5: When Using `git stash`

```bash
# Before stashing, note what's staged vs unstaged
git status

# Stash includes BOTH staged and unstaged changes
git stash

# When popping, staged files come back as unstaged
git stash pop

# Check what came back
git status
```

**WARNING:** `git stash` does NOT preserve the distinction between staged new files and modified tracked files. Everything becomes "modified" after `pop`.

---

## Recovery Options (If You Messed Up)

1. **Git reflog** - Only works for commits, not uncommitted files
2. **Git fsck --lost-found** - May find dangling blobs (file contents without names)
3. **IDE Local History** - VS Code: Right-click file → Local History
4. **Filesystem recovery** - `extundelete`, `testdisk` (Linux)
5. **Backups** - Time Machine, Backblaze, etc.

**Most uncommitted deletions are UNRECOVERABLE.**

---

## Checklist Before Any `rm` or `git checkout`

- [ ] Have I identified which files are NEW vs MODIFIED?
- [ ] Are any of these files the USER's work (not mine)?
- [ ] Did I create these files in THIS conversation?
- [ ] Have I asked the user if they want to keep these files?
- [ ] Is there a stash backup just in case?

**If ANY checkbox is uncertain, STOP and ASK THE USER.**

---

## Summary

| Action | Safe For | Dangerous For |
|--------|----------|---------------|
| `git checkout -- <file>` | Modified tracked files | New uncommitted files (no effect) |
| `git restore <file>` | Modified tracked files | New uncommitted files (no effect) |
| `rm <file>` | Files YOU created | ANY user file (permanent loss) |
| `rm -rf <dir>` | NOTHING - always ask | EVERYTHING - permanent loss |
| `git clean -fd` | Nothing - always ask | All untracked files |

**When in doubt: ASK. Never assume. Never delete what you didn't create.**
