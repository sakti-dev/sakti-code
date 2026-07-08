# Worktree Isolation v2 — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorming complete)
**Supersedes:** `2026-07-08-mission-worktree-isolation-design.md` (v1) — location, dependency handling, and change-content ownership are reworked. The status rename, transition table, and side-effect wiring from v1 stay.

## Problem

v1 worktree isolation (just shipped) has three gaps discovered in review and use:

1. **Cluttered user space.** Worktrees live in a sibling dir `<projectDir>-worktrees/<change>` inside (or next to) the user's project tree. Users see sakti-managed dirs beside their code.
2. **Broken scripts.** A worktree is a fresh checkout from the base branch — it has the source but **none of `node_modules`** (gitignored). So `pnpm test` / `npm test` fail in the mission until deps exist. Missions can't actually run the project's tests.
3. **Change content is invisible to the mission.** The plan session creates `.sakti/changes/<change>/proposal.md` (and design/tasks/specs) **uncommitted in the main repo's working tree**. A fresh base-branch checkout does not contain them. So when the specify agent runs in the worktree and is told _"Read proposal.md for this change"_, there is nothing there.

## Goal

- Worktrees live under the sakti data dir, not the user's project tree.
- Missions can run the project's scripts/tests — dependencies are available in the worktree.
- The SDD change content lives **on the mission branch, committed** — the main repo stays clean throughout the mission's life. Sakti automates the git bookkeeping; the user never manually manages dirty trees.

## Decisions

| Decision               | Choice                                                                                                     | Rationale                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Worktree location      | **`~/.sakti/projects/<projectBasename>--<changeName>`** (+ `--<projectId[:8]>` suffix on collision)        | Out of the user's project tree; further from the main repo than v1's sibling dir (less likely to be scanned)  |
| Dependencies           | **Symlink `node_modules` from the main repo into the worktree**                                            | Instant, zero disk, auto-stays-in-sync; correct for short-lived same-machine worktrees. v1 scope is JS only   |
| Change content         | **Commit `.sakti/changes/<change>/` onto the `sakti/<change>` branch as its first commit**                 | Git-native; branch becomes the single source of truth for the change; main never carries mission dirt         |
| Main repo after absorb | **Remove the change dir from main** (untracked → `rm`)                                                     | Main stays clean; content lives on the branch and returns to main only via merge                              |
| Clean-graduation guard | **Transition tool refuses `to:"mission"` if the working tree is dirty outside `.sakti/changes/<change>/`** | Stops graduation from absorbing unrelated WIP; surfaces at the moment the agent can act                       |
| Dep scope (v1)         | **`node_modules` only**                                                                                    | Covers the JS/TS majority (this project included). `worktree.symlinkDirs` + ecosystem detect deferred (YAGNI) |

## Architecture

### Location

```
~/.sakti/projects/<projectBasename>--<changeName>            # common case
~/.sakti/projects/<projectBasename>--<changeName>--<pid8>     # if path exists for a different project
```

- Base dir resolves from the existing sakti config home (`~/.sakti/`, overridable via the same env knob that governs `SAKTI_AGENT_DIR`). New `projects/` subdir.
- `<projectBasename>` = `path.basename(project.cwd)`; `<changeName>` = the SDD change slug; `<pid8>` = first 8 of the project's DB id, appended only when the target path already exists and belongs to a different project (collision-safe, readable in the common case).
- Branch naming unchanged: `sakti/<changeName>`.

Git worktrees may live anywhere on disk (the worktree's `.git` is a file pointing back to the main repo's gitdir), so the relocation is mechanically straightforward — only `worktreePathFor` changes.

### Graduation sequence (plan→mission) — the core

Runs server-side in the confirm route on approve. **All-or-nothing**: a failure returns HTTP 500 and leaves the gate pending so the user can retry (built on v1's Fix 5 reorder — worktree creation precedes the irreversible OM graduation). Order:

1. **Resolve** the active `<change>` from `project.cwd/.sakti/changes/`. If none, warn-log (mission runs unisolated — existing v1 behavior).
2. **Re-verify the clean invariant** (belt-and-suspenders; the transition-tool guardrail already enforced it pre-gate, but state may have changed): every `git status --porcelain` line is under `.sakti/changes/<change>/`.
3. **Create the worktree** from the default branch at the new location: `git worktree add -b sakti/<change> <path> <base>` (reuse a surviving branch — existing v1 logic).
4. **Absorb the change content**: copy `project.cwd/.sakti/changes/<change>/` → `<worktree>/.sakti/changes/<change>/`, then in the worktree `git add .sakti/changes/<change>/ && git commit -m "sakti: begin change <change>"`. This is the branch's first commit; the mission's specify/build/archive commits stack on top.
5. **Clean main**: remove `project.cwd/.sakti/changes/<change>/` (untracked-only per the invariant) so the main working tree returns to clean.
6. **Symlink deps**: `ln -s <project.cwd>/node_modules <worktree>/node_modules` (skip if main has no `node_modules`).
7. **Stamp** `worktreePath` + `changeName` on the plan session → carried to the new mission session (existing v1 carry-through).

**Net result:** main is clean; the mission branch owns the change content as a commit; the worktree has deps; the specify agent reads the committed `proposal.md` and writes `design.md`/`tasks.md` as further commits on the branch — none of it touching main.

### Dependency symlinks

- v1 symlinks `node_modules` only (step 6 above). Instant, zero disk, and stays in sync with the main repo automatically.
- The symlink lives **inside** the worktree dir, so teardown (`git worktree remove --force`) deletes it for free — no separate cleanup, and the main repo's `node_modules` is never touched.
- Deferred (not v1): a project setting `worktree.symlinkDirs` for `target/`/`.venv`/etc., and an install-based escape hatch (`pnpm install` / `npm ci`) for native-module ABI edge cases. Added when a real non-JS or native-sensitive mission needs them.

### Transition-tool guardrail (the "clean first" rule)

Extend `preflightWorktree` in the server's transition-tool wrapper (`tool-registry.ts`), which already runs when `to === "mission"`. New check beyond the existing repo/default-branch detection:

- `git -C <cwd> status --porcelain` — **every** output line must be a path under `.sakti/changes/<activeChange>/`.
- Any other dirty path → error tool result with `terminate: false`: _"Working tree isn't clean — commit or stash your changes first, then call transition({ to: \"mission\" }) again."_

The change dir itself is allowed (it is exactly what graduation absorbs). The error surfaces at the moment the agent can act — it informs the user — before the gate renders.

### Teardown (archive→done) — unchanged shape

- Remove the worktree dir (`git worktree remove --force`); this deletes the `node_modules` symlink with it. The main repo's deps are untouched.
- Keep branch `sakti/<change>` — it carries all the mission's commits, including the absorbed change content.
- Clear `worktreePath` on the session (already in v1).
- **Merge path:** the user merges `sakti/<change>` into main; the change content lands on main as committed files. No manual cleanup anywhere.

## Edge cases / error handling

- **Worktree creation fails** → 500, main untouched. Absorb/clean (steps 4–5) run only after creation succeeds, so a creation failure leaves no side effects.
- **Absorb or clean fails mid-sequence** → best-effort: remove the half-created worktree, leave main exactly as it was, return 500. The change-dir copy (step 4) is non-destructive to main; only step 5's `rm` mutates main, and it runs last.
- **Branch already survives** (re-graduation of an archived change) → reuse the branch (existing v1 logic); skip the absorb-commit when the change content is already present on the branch.
- **Change dir is tracked on main** (rare — user committed it) → the guardrail still permits it (path is under `.sakti/changes/<change>/`); step 5 uses `git rm` instead of a plain `rm`.
- **No `node_modules` in main** → skip the symlink (step 6 is a no-op). Mission may still install deps itself if needed.

## Migration from v1 (what changes in code)

- `apps/server/src/lib/worktree.ts`: `worktreePathFor` → new location + collision suffix; new `absorbChangeContent` + `cleanMainChangeDir` helpers; deps symlink helper.
- `apps/server/src/routes/sessions/confirm.ts`: graduation sequence gains absorb → clean → symlink steps between worktree creation and the stamp.
- `apps/server/src/agent/config/tool-registry.ts` (`preflightWorktree` / wrapper): add the clean-working-tree check.
- `apps/server/src/lib/__tests__/worktree.test.ts` + `confirm.test.ts`: location, absorb, clean, symlink, guardrail coverage.
- **Unchanged:** status rename, `transition-table.ts` edges/flags, `applyTransition` teardown wiring, `resolveSessionCwd`, the desktop carry-through, the `done`-session guards.

## Out of scope (v1)

- Non-`node_modules` dep dirs (`target/`, `.venv`), install-based dep provisioning, ecosystem auto-detect.
- Automatic merge of `sakti/<change>` into main at archive (user merges manually; the branch is retained).
- Windows symlink permissions (this is a Linux desktop app).
