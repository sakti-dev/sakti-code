/**
 * Version Control System detection and operations
 *
 * Detects VCS type and retrieves branch, commit, and remote information.
 * Provides git operations: clone, worktree, branch listing.
 */

import { resolveAppPaths } from "@sakti-code/shared/paths";
import fs from "node:fs/promises";
import path from "node:path";
import simpleGit from "simple-git";
import type { VCSInfo } from "../instance/context";

const ALLOWED_HOSTS = ["github.com", "gitlab.com", "bitbucket.org"];

/**
 * Get VCS information for a directory
 *
 * @param directory - Directory to check for VCS
 * @returns VCS information
 */
export async function getVCSInfo(directory: string): Promise<VCSInfo> {
  const root = await findVCSRoot(directory);

  if (!root) {
    return { type: "none" };
  }

  // Check git
  if (await hasGitDirectory(root)) {
    const [branch, commit, remote] = await Promise.all([
      getGitBranch(root),
      getGitCommit(root),
      getGitRemote(root),
    ]);
    return {
      type: "git",
      branch,
      commit,
      remote,
    };
  }

  // Check mercurial
  if (await hasHgDirectory(root)) {
    return { type: "hg" };
  }

  // Check svn
  if (await hasSvnDirectory(root)) {
    return { type: "svn" };
  }

  return { type: "none" };
}

/**
 * List remote branches from a git repository URL
 *
 * @param url - The repository URL (e.g., https://github.com/user/repo)
 * @returns Array of branch names
 */
export async function listRemoteBranches(url: string): Promise<string[]> {
  const git = simpleGit();

  try {
    const result = await git.listRemote(["--heads", url]);

    // Parse branches from output
    // Format: <sha>\trefs/heads/<branch-name>
    const branches = result
      .split("\n")
      .filter(line => line.includes("refs/heads/"))
      .map(line => {
        const match = line.match(/refs\/heads\/(.+)$/);
        return match ? match[1].trim() : null;
      })
      .filter((branch): branch is string => branch !== null);

    return branches;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list remote branches";
    throw new Error(message);
  }
}

/**
 * Find VCS root directory by searching upward
 */
async function findVCSRoot(startPath: string): Promise<string | null> {
  const vcsDirs = [".git", ".hg", ".svn"];

  let currentPath = startPath;

  while (currentPath !== path.dirname(currentPath)) {
    for (const vcsDir of vcsDirs) {
      const vcsPath = path.join(currentPath, vcsDir);
      try {
        const stats = await fs.stat(vcsPath);
        if (stats.isDirectory() || stats.isFile()) {
          return currentPath;
        }
      } catch {
        // VCS directory doesn't exist
      }
    }

    currentPath = path.dirname(currentPath);
  }

  return null;
}

/**
 * Check if directory has .git
 */
async function hasGitDirectory(directory: string): Promise<boolean> {
  const gitPath = path.join(directory, ".git");
  try {
    const stats = await fs.stat(gitPath);
    return stats.isDirectory() || stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Check if directory has .hg
 */
async function hasHgDirectory(directory: string): Promise<boolean> {
  const hgPath = path.join(directory, ".hg");
  try {
    const stats = await fs.stat(hgPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if directory has .svn
 */
async function hasSvnDirectory(directory: string): Promise<boolean> {
  const svnPath = path.join(directory, ".svn");
  try {
    const stats = await fs.stat(svnPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get current git branch
 */
async function getGitBranch(directory: string): Promise<string | undefined> {
  try {
    const git = simpleGit(directory);
    const status = await git.status();
    return status.current || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get current git commit SHA
 */
async function getGitCommit(directory: string): Promise<string | undefined> {
  try {
    const git = simpleGit(directory);
    const log = await git.log(["-1"]);
    return log.latest?.hash || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get git remote URL
 */
async function getGitRemote(directory: string): Promise<string | undefined> {
  try {
    const git = simpleGit(directory);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === "origin");
    return origin?.refs?.fetch || undefined;
  } catch {
    return undefined;
  }
}

/**
 * List local branches from a git repository
 *
 * @param directory - Path to the git repository
 * @returns Array of branch names
 * @throws Error if not a git repository
 */
export async function listLocalBranches(directory: string): Promise<string[]> {
  if (!(await hasGitDirectory(directory))) {
    throw new Error("Not a git repository");
  }

  const git = simpleGit(directory);
  const branches = await git.branchLocal();
  return branches.all;
}

/**
 * Clone a git repository
 *
 * @param options - Clone options
 * @param options.url - Repository URL
 * @param options.targetDir - Target directory to clone into
 * @param options.branch - Branch to clone
 * @returns Path to cloned repository
 * @throws Error if URL host is not allowed or clone fails
 */
export async function clone(options: {
  url: string;
  targetDir: string;
  branch: string;
}): Promise<string> {
  const { url, targetDir, branch } = options;

  // Validate URL host
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === "file:") {
      // Local file URLs are allowed for offline/local workflows (including tests).
    } else {
      const hostname = parsedUrl.hostname.replace(/^www\./, "");
      if (!ALLOWED_HOSTS.includes(hostname)) {
        throw new Error(
          `URL hostname not allowed: ${hostname}. Only ${ALLOWED_HOSTS.join(", ")} are supported.`
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("not allowed")) {
      throw error;
    }
    throw new Error("Invalid URL format");
  }

  // Extract repo name from URL
  const urlParts = url.replace(/\.git$/, "").split(/[/\\]/);
  const repoName = urlParts[urlParts.length - 1] || "repository";
  const clonePath = path.join(targetDir, repoName);

  // Ensure target directory exists
  await fs.mkdir(targetDir, { recursive: true });

  // Clone with simple-git
  const git = simpleGit();
  await git.clone(url, clonePath, ["--branch", branch, "--single-branch"]);

  return clonePath;
}

/**
 * Create a git worktree
 *
 * @param options - Worktree options
 * @param options.repoPath - Path to the main repository
 * @param options.worktreeName - Name for the worktree (used as directory name)
 * @param options.branch - Branch name to create/checkout in the worktree
 * @param options.worktreesDir - Directory where worktrees are stored
 * @param options.createBranch - If true, create a new branch with the given name
 * @returns Path to the created worktree
 * @throws Error if not a git repository or worktree creation fails
 */
export async function createWorktree(options: {
  repoPath: string;
  worktreeName: string;
  branch: string;
  worktreesDir: string;
  createBranch?: boolean;
}): Promise<string> {
  const { repoPath, worktreeName, branch, worktreesDir, createBranch } = options;

  if (!(await hasGitDirectory(repoPath))) {
    throw new Error("Not a git repository");
  }

  // Ensure worktrees directory exists
  await fs.mkdir(worktreesDir, { recursive: true });

  const worktreePath = path.join(worktreesDir, worktreeName);

  // Check if worktree already exists
  if (await exists(worktreePath)) {
    throw new Error(`Worktree '${worktreeName}' already exists`);
  }

  // Create worktree with simple-git
  const git = simpleGit(repoPath);
  if (createBranch) {
    // Create new branch AND worktree
    await git.raw(["worktree", "add", "-b", branch, worktreePath]);
  } else {
    // Use existing branch
    await git.raw(["worktree", "add", worktreePath, branch]);
  }

  return worktreePath;
}

/**
 * Check if a worktree name already exists
 *
 * @param worktreeName - Name of the worktree to check
 * @param worktreesDir - Directory where worktrees are stored
 * @returns True if worktree exists, false otherwise
 */
export async function worktreeExists(worktreeName: string, worktreesDir: string): Promise<boolean> {
  const worktreePath = path.join(worktreesDir, worktreeName);
  return exists(worktreePath);
}

/**
 * Get the workspaces directory path
 *
 * @returns Absolute path to ~/.sakti/workspaces
 */
export function getWorkspacesDir(): string {
  const paths = resolveAppPaths();
  return paths.workspaces;
}

/**
 * Check if a path exists
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
