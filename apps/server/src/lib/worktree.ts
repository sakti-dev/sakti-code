import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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
  if (!existsSync(join(cwd, ".git")) && !existsSync(join(dirname(cwd), ".git"))) {
    return `"${cwd}" is not a git repository. Initialize git (git init) before this mission can be isolated in a worktree.`;
  }
  const base = detectDefaultBranch(cwd);
  if (!base) {
    return `Could not detect a default branch in "${cwd}". Ensure the repo has at least one commit on a branch.`;
  }
  return null;
}

/** Compute the sibling worktree directory for a change. */
export function worktreePathFor(projectCwd: string, changeName: string): string {
  return join(dirname(projectCwd), `${basename(projectCwd)}-worktrees`, changeName);
}

/**
 * Create a git worktree + branch for a mission. Returns the absolute worktree
 * path. Throws on failure (caller decides how to surface).
 */
export function createMissionWorktree(projectCwd: string, changeName: string): string {
  const base = detectDefaultBranch(projectCwd);
  if (!base) {
    throw new Error(`Cannot create worktree: no default branch detected in "${projectCwd}"`);
  }
  const wtPath = worktreePathFor(projectCwd, changeName);
  const branch = `sakti/${changeName}`;
  git(projectCwd, `worktree add -b ${branch} "${wtPath}" ${base}`);
  return wtPath;
}

/**
 * Remove a mission worktree. Keeps the branch (commits survive for merge).
 * Never throws — best-effort cleanup.
 */
export function removeMissionWorktree(projectCwd: string, changeName: string): void {
  const wtPath = worktreePathFor(projectCwd, changeName);
  try {
    git(projectCwd, `worktree remove --force "${wtPath}"`);
  } catch {
    // Best-effort; the worktree may already be gone.
  }
}
