/**
 * Git Manager for search-docs tool
 *
 * Handles cloning, updating, and validating git repositories.
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Instance } from "../../instance/index.ts";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type CloneOptions = {
  url: string;
  branch: string;
  searchPaths: string[];
  depth?: number;
  quiet?: boolean;
};

export type UpdateOptions = {
  localPath: string;
  branch: string;
  quiet?: boolean;
};

export type CloneResult = {
  success: boolean;
  path?: string;
  commit?: string;
  error?: {
    code: string;
    message: string;
    hint?: string;
  };
};

export type GitError = {
  code: string;
  message: string;
  hint?: string;
};

// ============================================================================
// ERROR HANDLING
// ============================================================================

const GIT_ERROR_PATTERNS: Record<string, { code: string; message: string; hint?: string }> = {
  "Repository not found": {
    code: "REPO_NOT_FOUND",
    message: "Repository not found or access denied",
    hint: "Check the repository URL and your access permissions",
  },
  "Could not resolve host": {
    code: "HOST_NOT_FOUND",
    message: "Could not resolve repository host",
    hint: "Check your internet connection",
  },
  "Permission denied": {
    code: "PERMISSION_DENIED",
    message: "Permission denied",
    hint: "You may need to authenticate",
  },
  "branch.*not found": {
    code: "BRANCH_NOT_FOUND",
    message: "Branch not found",
    hint: "Check available branches with git ls-remote",
  },
};

function parseGitError(stderr: string): GitError {
  for (const [pattern, error] of Object.entries(GIT_ERROR_PATTERNS)) {
    if (new RegExp(pattern, "i").test(stderr)) {
      return error;
    }
  }

  return {
    code: "UNKNOWN_ERROR",
    message: stderr.split("\n")[0] || "Unknown git error",
  };
}

// ============================================================================
// GIT MANAGER IMPLEMENTATION
// ============================================================================

class GitManager {
  private _cacheDir: string | null = null;
  private allowedHosts: Set<string>;

  constructor() {
    this.allowedHosts = new Set(["github.com", "gitlab.com", "bitbucket.org", "gist.github.com"]);
  }

  /**
   * Get cache directory (resolves lazily using Instance.directory)
   */
  private get cacheDir(): string {
    if (!this._cacheDir) {
      // Use workspace directory for cache
      const workspaceDir = Instance.directory;
      this._cacheDir = path.join(workspaceDir, ".ekacode", "search-docs-cache");
      this.ensureCacheDir();
    }
    return this._cacheDir;
  }

  /**
   * Clone a repository
   */
  async clone(options: CloneOptions): Promise<CloneResult> {
    const { url, branch, searchPaths, depth = 1, quiet = true } = options;

    // Validate URL
    if (!this.validateUrl(url)) {
      return {
        success: false,
        error: {
          code: "INVALID_URL",
          message: `URL not allowed: ${url}`,
          hint: "Only github.com, gitlab.com, and bitbucket.org are allowed",
        },
      };
    }

    // Generate local path
    const localPath = this.getLocalPath(url, branch);

    // Check if already exists
    try {
      this.getHeadCommit(localPath);
      // Already cloned, just update
      return await this.update({ localPath, branch, quiet });
    } catch {
      // Doesn't exist, proceed with clone
    }

    try {
      // Build clone arguments
      const args = [
        "clone",
        "--depth",
        String(depth),
        "--single-branch",
        "--branch",
        branch,
        url,
        localPath,
      ];

      // Add sparse checkout if needed
      if (searchPaths.length > 0) {
        args.splice(1, 0, "--sparse");
      }

      // Execute clone
      execGit(args, quiet);

      // If sparse checkout, set the paths
      if (searchPaths.length > 0) {
        const sparsePaths = searchPaths.join(" ");
        execGit(["-C", localPath, "sparse-checkout", "set", sparsePaths], quiet);
      }

      // Get commit hash
      const commit = this.getHeadCommit(localPath);

      return {
        success: true,
        path: localPath,
        commit,
      };
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error);
      const gitError = parseGitError(stderr);

      // Clean up failed clone
      this.cleanupDirectory(localPath);

      return {
        success: false,
        error: gitError,
      };
    }
  }

  /**
   * Update an existing cloned repository
   */
  async update(options: UpdateOptions): Promise<CloneResult> {
    const { localPath, branch, quiet = true } = options;

    try {
      // Fetch latest changes
      execGit(["-C", localPath, "fetch", "origin", branch], quiet);

      // Reset to latest
      execGit(["-C", localPath, "reset", "--hard", `origin/${branch}`], quiet);

      // Get commit hash
      const commit = this.getHeadCommit(localPath);

      return {
        success: true,
        path: localPath,
        commit,
      };
    } catch (error) {
      const stderr = error instanceof Error ? error.message : String(error);
      const gitError = parseGitError(stderr);

      return {
        success: false,
        error: gitError,
      };
    }
  }

  /**
   * Validate a git URL
   */
  validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return this.allowedHosts.has(hostname);
    } catch {
      return false;
    }
  }

  /**
   * Fetch tags from a remote repository
   */
  async fetchTags(url: string): Promise<string[]> {
    try {
      const output = execGit(["ls-remote", "--tags", "--sort=-v:refname", url], true);

      const tags = output
        .split("\n")
        .filter(line => line.includes("refs/tags/"))
        .map(line => {
          const tag = line.split("\t")[1];
          return tag.replace("refs/tags/", "").replace("^{}", "");
        })
        .filter(tag => !tag.endsWith("^{}"));

      return tags;
    } catch {
      return [];
    }
  }

  /**
   * Resolve a version to a specific tag
   */
  resolveVersion(version: string | undefined, availableTags: string[]): string | null {
    // No version → use main branch
    if (!version) {
      return "main";
    }

    // Direct match
    if (availableTags.includes(version)) {
      return version;
    }

    // Semantic version matching
    const normalizedVersion = version.replace(/^[\^~]/, "").replace(/^v?/, "v");
    const versionPrefix = normalizedVersion.endsWith(".")
      ? normalizedVersion
      : normalizedVersion + ".";

    // Find latest matching tag
    const matchingTags = availableTags.filter(tag => tag.startsWith(versionPrefix));

    if (matchingTags.length > 0) {
      // Tags are already sorted by git ls-remote --sort=-v:refname (descending)
      // So the first match is the latest
      return matchingTags[0];
    }

    // Try with "v" prefix if not present
    if (!version.startsWith("v")) {
      const vPrefix = "v" + versionPrefix;
      const vMatchingTags = availableTags.filter(tag => tag.startsWith(vPrefix));
      if (vMatchingTags.length > 0) {
        return vMatchingTags[0];
      }
    }

    return null;
  }

  /**
   * Build a consistent resource key
   */
  buildResourceKey(input: { url: string; ref: string; searchPath?: string }): string {
    const normalizedUrl = input.url.replace(/\.git$/, "").toLowerCase();
    const normalizedPath = (input.searchPath || "").replace(/\/+$/, "");
    return `${normalizedUrl}#${input.ref}::${normalizedPath}`;
  }

  /**
   * Get local cache path for a repository
   */
  private getLocalPath(url: string, branch: string): string {
    // Create a safe directory name from URL
    const urlParts = new URL(url).pathname.split("/").filter(Boolean);
    const org = urlParts[0] || "unknown";
    const repo = urlParts[1] || "repo";
    const dirName = `${org}-${repo}-${branch}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    return path.join(this.cacheDir, dirName);
  }

  /**
   * Get the HEAD commit hash
   */
  private getHeadCommit(localPath: string): string {
    return execGit(["-C", localPath, "rev-parse", "HEAD"], true).trim();
  }

  /**
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    try {
      mkdirSync(this.cacheDir, { recursive: true });
    } catch {
      // Ignore if already exists
    }
  }

  /**
   * Clean up a directory
   */
  private cleanupDirectory(dirPath: string): void {
    try {
      rmSync(dirPath, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function execGit(args: string[], quiet: boolean): string {
  const timeout = 30000; // 30 seconds

  try {
    return execSync("git " + args.join(" "), {
      encoding: "utf-8",
      stdio: quiet ? "pipe" : "inherit",
      timeout,
    });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr || "";
    throw new Error(stderr || String(error));
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let gitManagerInstance: GitManager | null = null;

export function getGitManager(): GitManager {
  if (!gitManagerInstance) {
    gitManagerInstance = new GitManager();
  }
  return gitManagerInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetGitManager(): void {
  gitManagerInstance = null;
}

// ============================================================================
// CONVENIENCE EXPORTS (singleton methods)
// ============================================================================

const manager = getGitManager();

export const gitManager = {
  clone: (options: CloneOptions) => manager.clone(options),
  update: (options: UpdateOptions) => manager.update(options),
  validateUrl: (url: string) => manager.validateUrl(url),
  fetchTags: (url: string) => manager.fetchTags(url),
  resolveVersion: (version: string | undefined, tags: string[]) =>
    manager.resolveVersion(version, tags),
  buildResourceKey: (input: { url: string; ref: string; searchPath?: string }) =>
    manager.buildResourceKey(input),
};
