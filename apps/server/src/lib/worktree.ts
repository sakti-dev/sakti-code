import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getWorktreeBaseDir } from "./config-dirs.ts";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, shell: "/bin/sh", encoding: "utf-8" }).trim();
}

/**
 * Detect the repo's default branch via symbolic-ref. Falls back to "main",
 * then "master". Returns null if cwd is not a git repo.
 */
export function detectDefaultBranch(cwd: string): string | null {
  try {
    // Try the local HEAD symbolic-ref first.
    const ref = git(cwd, "symbolic-ref --short HEAD");
    if (ref) return ref;
  } catch {
    // Not on a branch or not a repo — try fallbacks.
  }
  // Fallbacks: check if main/master exists as a branch.
  for (const candidate of ["main", "master"]) {
    try {
      const result = git(cwd, `branch --list ${candidate}`);
      if (result.includes(candidate)) return candidate;
    } catch {
      // not a repo
    }
  }
  // Final fallback: assume main if it's a repo at all.
  try {
    git(cwd, "rev-parse --is-inside-work-tree");
    return "main";
  } catch {
    return null;
  }
}

/**
 * Read-only pre-flight for worktree creation. Returns null if OK, or an
 * error message explaining what's wrong. Used by the transition tool wrapper
 * so failures surface to the agent (not swallowed).
 */
export function preflightWorktree(cwd: string): string | null {
  // Use git itself to detect a repo — works inside linked worktrees, subdirs,
  // and repos with a relocated gitdir where a `.git` entry may be absent.
  try {
    git(cwd, "rev-parse --is-inside-work-tree");
  } catch {
    return `"${cwd}" is not a git repository. Initialize git (git init) before this mission can be isolated in a worktree.`;
  }
  const base = detectDefaultBranch(cwd);
  if (!base) {
    return `Could not detect a default branch in "${cwd}". Ensure the repo has at least one commit on a branch.`;
  }
  return null;
}

/**
 * Compute the worktree directory for a change under the sakti data dir:
 * `<base>/<projectBasename>--<changeName>`. If that exact path already exists
 * (a different project with the same basename + change), append
 * `--<projectId[:8]>` so two same-named projects don't collide. `base` is the
 * worktree base dir (pass explicitly for tests; production uses
 * {@link getWorktreeBaseDir}).
 */
export function worktreePathFor(
  base: string,
  projectCwd: string,
  projectId: string,
  changeName: string,
): string {
  const primary = join(base, `${basename(projectCwd)}--${changeName}`);
  if (existsSync(primary)) {
    return join(base, `${basename(projectCwd)}--${changeName}--${projectId.slice(0, 8)}`);
  }
  return primary;
}

/** Does `refs/heads/<branch>` exist in the repo at `cwd`? */
function branchExists(cwd: string, branch: string): boolean {
  try {
    git(cwd, `show-ref --verify --quiet refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a git worktree + branch for a mission. Returns the absolute worktree
 * path. Throws on failure (caller decides how to surface).
 *
 * Reuses an existing `sakti/<changeName>` branch when one survives (e.g. a
 * prior archived mission kept it for merge/review) instead of hard-failing on
 * `worktree add -b`; otherwise creates a fresh branch off the default branch.
 */
export function createMissionWorktree(
  projectCwd: string,
  projectId: string,
  changeName: string,
): string {
  const base = getWorktreeBaseDir();
  mkdirSync(base, { recursive: true });
  try {
    git(projectCwd, "worktree prune");
  } catch {
    // ignore
  }
  const wtPath = worktreePathFor(base, projectCwd, projectId, changeName);
  const branch = `sakti/${changeName}`;
  if (branchExists(projectCwd, branch)) {
    git(projectCwd, `worktree add "${wtPath}" ${branch}`);
  } else {
    const detected = detectDefaultBranch(projectCwd);
    if (!detected) {
      throw new Error(`Cannot create worktree: no default branch detected in "${projectCwd}"`);
    }
    git(projectCwd, `worktree add -b ${branch} "${wtPath}" ${detected}`);
  }
  return wtPath;
}

/**
 * Remove a mission worktree by its stored path. Keeps the branch (commits
 * survive for merge). `--force` discards any uncommitted worktree changes —
 * acceptable because the archive phase commits before teardown. Never throws —
 * best-effort cleanup.
 */
export function removeMissionWorktree(projectCwd: string, wtPath: string): void {
  try {
    git(projectCwd, `worktree remove --force "${wtPath}"`);
  } catch {
    // Best-effort; the worktree may already be gone.
  }
}

/**
 * Copy the main repo's uncommitted `.sakti/changes/<change>/` into the
 * worktree and commit it on the mission branch as the first commit. The
 * specify agent then reads proposal.md from the worktree and writes
 * design.md/tasks.md as further commits. Idempotent-ish: a no-op (no throw)
 * when main has no change dir or when the same content is already committed on
 * a reused mission branch.
 */
export function absorbChangeContent(projectCwd: string, wtPath: string, changeName: string): void {
  const src = join(projectCwd, ".sakti", "changes", changeName);
  if (!existsSync(src)) return;
  const dest = join(wtPath, ".sakti", "changes", changeName);
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  git(wtPath, "add .sakti/changes");
  const staged = git(wtPath, "diff --cached --name-only");
  if (staged === "") return;
  git(wtPath, `commit -m "sakti: begin change ${changeName}"`);
}

/**
 * Remove `.sakti/changes/<change>/` from the main working tree after its
 * content has been committed onto the mission branch. Keeps the main repo
 * clean (the content returns to main only via merge of `sakti/<change>`).
 * No-op when absent. Refuses tracked change dirs because removing tracked files
 * would leave staged deletions on main; tracked change content must be handled
 * by the user before graduation so "main stays clean" remains true.
 */
export function cleanMainChangeDir(projectCwd: string, changeName: string): void {
  const dir = join(projectCwd, ".sakti", "changes", changeName);
  if (!existsSync(dir)) {
    return;
  }
  const rel = `.sakti/changes/${changeName}`;
  const tracked = git(projectCwd, `ls-files "${rel}"`);
  if (tracked !== "") {
    throw new Error(
      `Cannot clean tracked change dir "${rel}". Commit, revert, or move this change content before transitioning to mission.`,
    );
  }
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Symlink configured dependency/cache dirs into the worktree so the mission can
 * run project scripts without reinstalling. Absolute targets resolve regardless
 * of the worktree's location. Missing main dirs and existing worktree paths are
 * skipped. Returns the list of linked dir names.
 */
export function linkDependencyDirs(
  projectCwd: string,
  wtPath: string,
  dirs: readonly string[],
): string[] {
  const linked: string[] = [];
  for (const dir of dirs) {
    const target = join(projectCwd, dir);
    const link = join(wtPath, dir);
    if (!existsSync(target) || existsSync(link)) {
      continue;
    }
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, "dir");
    linked.push(dir);
  }
  return linked;
}
