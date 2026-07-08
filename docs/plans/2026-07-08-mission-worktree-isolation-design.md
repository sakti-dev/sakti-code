# Mission Worktree Isolation — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorming complete)
**Depends on:** `openspec/PHASE-WORKFLOW.md`, the phase-transition system

## Problem

When a plan graduates into a mission, the mission agent works directly in the
project's `cwd` alongside every other session. There is no isolation: the agent's
commits mix into whatever branch the main working tree is on, concurrent missions
stomp on each other, and the agent has no dedicated branch to merge from.

The reason plan sessions and mission sessions are separate was to give the
mission its own isolated working directory at graduation — set the cwd once, and
the mission agent never has to adjust anything. This design delivers that.

## Goal

Every plan→mission graduation creates a dedicated git worktree + branch for that
mission. The mission agent runs with its cwd set to the worktree, so it works in
isolation without any setup. On archive completion, a terminal gate lets the user
clean up the worktree (the branch survives for merge/review).

## Decisions

| Decision         | Choice                                                                                            | Rationale                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Scope            | **Unconditional** — every mission gets a worktree (hotfix included)                               | Isolation is just how missions work; simpler mental model                                   |
| Base branch      | **Default branch** (`main`/`master`), detected via `git symbolic-ref`, fallback `main` → `master` | Clean trunk baseline                                                                        |
| Teardown trigger | **Terminal gate after archive** (user approves)                                                   | Archive is a real phase that runs work; cleanup happens after it finishes                   |
| Teardown action  | **Remove worktree, keep branch**                                                                  | Commits survive on `sakti/<changeName>` for merge/review                                    |
| Cwd model        | **Approach A: session-level `worktreePath` column**                                               | Explicit, queryable, single resolution point; doesn't corrupt project identity              |
| Error surfacing  | **Option 1: pre-flight validation in the transition tool**                                        | Errors surface in the agent's context so it can inform the user; respects gate architecture |
| Tool purity      | **`packages/tools` stays pure; server wraps in `tool-registry.ts`**                               | Server owns git/worktree knowledge                                                          |

## Architecture

### Cwd resolution (Approach A)

Today `projects.cwd` (unique per project) is the single cwd, and the runner reads
`project.cwd` in ~6 spots (`runner.ts:276,331,344,364,416,539`).

A nullable `sessions.worktreePath` column is added. A single helper resolves cwd:

```ts
function resolveSessionCwd(session, project): string {
  return session.worktreePath ?? project.cwd;
}
```

The runner's cwd references route through it. Non-worktree sessions (plan
sessions, pre-existing missions) have `worktreePath = null` and behave exactly as
today. Single source of truth.

### Status consolidation

Statuses are renamed to align 1:1 with phase names, and a terminal status is
added:

| phase                   | status (new) | was          |
| ----------------------- | ------------ | ------------ |
| specify                 | `specify`    | `specifying` |
| build                   | `build`      | `building`   |
| verify                  | `verify`     | `review`     |
| archive (agent running) | `archive`    | `merged`     |
| terminal (cleaned up)   | `done`       | _(new)_      |

**Payoff:** `phaseFromSession` collapses to near-identity — for missions,
`status === phase`. The confusing mismatches (`review`≠verify, `merged`≠archive)
disappear. The sidebar "Archived" group filters on `done`.

**Migration:** clean-slate — delete all existing Drizzle migrations, update
`schema.ts`, regenerate from scratch via `vp run '@sakti-code/db#db:generate'`.
The current DB is unused/deleted, so no data migration is needed.

### Transition table

Two new edges' worth of changes — a new terminal edge and two new side-effect
flags:

| edge             | mode     | statusTarget | side-effects                              |
| ---------------- | -------- | ------------ | ----------------------------------------- |
| plan→mission     | gate     | _(none)_     | graduation + **`requiresWorktreeCreate`** |
| specify→build    | gate     | `build`      | —                                         |
| build→verify     | auto     | `verify`     | forcedObserve                             |
| verify→build     | auto     | `build`      | —                                         |
| verify→archive   | gate     | `archive`    | —                                         |
| **archive→done** | **gate** | **`done`**   | **`requiresWorktreeTeardown`**            |

`TransitionEdge` gains two flags: `requiresWorktreeCreate` (plan→mission, fires
`createMissionWorktree` in the confirm route) and `requiresWorktreeTeardown`
(archive→done, fires `removeMissionWorktree`). These slot into `applyTransition`
exactly like `requiresGraduation` and `requiresForcedObserve` — uniform
side-effect pattern.

`Phase` type gains `"done"`. The `archive→done` edge has no instruction (terminal
— no agent runs after).

### Error surfacing (Option 1: pre-flight in the transition tool)

The transition tool in `packages/tools` stays a **pure, context-free signal**.
The server wraps it in `tool-registry.ts` (which already has `ctx.cwd`).

When `to === "mission"`, the wrapper runs a **read-only** git pre-flight:

- Is `cwd` a git repo? (`git rev-parse --is-inside-work-tree`)
- Can we detect the default branch? (`git symbolic-ref`)
- Is the worktree path creatable?

If any check fails, the tool returns an **error result with `terminate: false`**
— the agent stays alive, sees the error ("Cannot create worktree: project is not
a git repo. Initialize git, then retry"), and informs the user. If pre-flight
passes, the gate renders as normal; actual creation happens at confirm time.

The rare pre-flight-pass-but-execute-fail case (disk full, race) falls back to an
HTTP error from the confirm route, shown by the UI.

This is a guard, not a side-effect — like the edit tool validating before
applying. It respects the "pure signal" design while surfacing errors at the
exact moment the agent can act on them.

### Git ops module

New `apps/server/src/lib/worktree.ts`:

- `detectDefaultBranch(cwd)` → `git symbolic-ref --short HEAD` of the main
  worktree, fallback `main` → `master`.
- `preflightWorktree(cwd, changeName)` → read-only validation (used by the
  transition tool wrapper).
- `createMissionWorktree(projectCwd, changeName)` →
  `git worktree add -b sakti/<changeName> <path> <baseRef>`; returns the path.
- `removeMissionWorktree(projectCwd, changeName)` → `git worktree remove`; keeps
  the branch.

**Worktree location:** sibling directory `<projectDir>-worktrees/<changeName>`
(not nested in the repo, so the agent's file tools don't scan it and it doesn't
pollute the main tree's git status).

**Branch naming:** `sakti/<changeName>`.

## Lifecycle (end to end)

```
plan agent calls transition({ to: "mission" })
  → wrapped tool pre-flights worktree feasibility (read-only)
  → FAIL: error result to agent (terminate: false) → agent informs user, retry
  → PASS: gate renders

user approves plan→mission gate
  → confirm route: graduation (OM reflect) + createMissionWorktree
  → stamps changeName + worktreePath on the plan session
  → desktop client carries both to createSession → mission born with both set
  → mission agent runs with cwd = worktreePath

specify → build ⇄ verify
  → all runs resolve cwd = worktreePath

verify→archive gate approve
  → status flips to archive → archive agent runs (in worktree)
  → syncs spec deltas, moves change dir to archived

archive agent finishes, calls transition({ to: "done" })
  → terminal gate renders ("Archive complete — remove worktree?")

user approves archive→done gate
  → removeMissionWorktree (keeps branch sakti/<changeName>)
  → status archive → done
```

## worktreePath flow

```
confirm route (plan→mission approve)
  → createMissionWorktree() returns path
  → stamps sessions.worktreePath on the PLAN session
desktop client reads worktreePath from plan session post-confirm
  → passes to createSession
  → new mission session has worktreePath set
runner resolves resolveSessionCwd(session, project) = worktreePath
```

Same carry-through pattern as `changeName` (added in the phase-transition
review-fixes work).

## UI changes

No new components. The worktree is invisible to the user.

1. **Status type** (`server-store.ts`): rename to `"specify"|"build"|"verify"|"archive"|"done"`.
2. **Sidebar filters** (`sidebar.tsx`): active = `status !== "done"`; archived = `status === "done"`.
3. **mission-row label map** (`mission-row.tsx`): rename keys; add `done`.
4. **archived-accordion.tsx**: `status={"done" ...}`.
5. **TransitionCard copy map** (`transition-card.tsx`): `TransitionGateTo` gains `"done"`:
   `done: { title: "Archive Complete", approve: "Finish & Remove Worktree", reject: "Keep" }`.
   The existing `handleAsk` drives the archive→done gate through the same confirm route.
6. **createSession + plan-chat**: carry `worktreePath` (same pattern as `changeName`).

## Scope summary

**Schema:** `sessions.worktreePath` (new nullable column); status default → `specify`.
**Migrations:** clean-slate (delete all, regenerate).
**Server:** git ops module; transition-table (rename + new edge + 2 flags);
`applyTransition` (2 new side-effects); `tool-registry` wrapper (pre-flight);
`phaseFromSession` (identity); `resolve-agent` + `resolve-observational-memory`

- `reminder` (status rename); confirm route (worktree create/teardown); runner
  (`resolveSessionCwd` helper).
  **Desktop:** status rename (type, sidebar, mission-row, accordion);
  TransitionCard `"done"` destination; createSession + plan-chat carry worktreePath.
  **No changes:** `packages/tools` (transition tool stays pure), agent package.
