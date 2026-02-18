/**
 * Version Control System detection
 *
 * Detects VCS type and retrieves branch, commit, and remote information.
 */

import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { VCSInfo } from "../instance/context";

const execAsync = promisify(exec);

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
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd: directory,
      timeout: 5000,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get current git commit SHA
 */
async function getGitCommit(directory: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git rev-parse HEAD", {
      cwd: directory,
      timeout: 5000,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get git remote URL
 */
async function getGitRemote(directory: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git remote get-url origin", {
      cwd: directory,
      timeout: 5000,
    });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
