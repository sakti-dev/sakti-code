/**
 * Shell detection and selection utilities
 *
 * Detects appropriate shell for command execution on different platforms
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Shells that are blacklisted (not compatible with standard POSIX)
 */
const BLACKLIST = new Set(["fish", "nu"]);

/**
 * Get fallback shell based on platform
 */
function getFallbackShell(): string {
  if (process.platform === "win32") {
    // Windows: Try Git Bash first, then cmd.exe
    const gitBashPath = process.env["OPENCODE_GIT_BASH_PATH"];
    if (gitBashPath && existsSync(gitBashPath)) {
      return gitBashPath;
    }

    try {
      const gitPath = execSync("where git", { encoding: "utf-8" }).trim().split("\n")[0];
      if (gitPath) {
        // git.exe is typically at: C:\Program Files\Git\cmd\git.exe
        // bash.exe is at: C:\Program Files\Git\bin\bash.exe
        const bashPath = path.join(path.dirname(gitPath), "..", "bin", "bash.exe");
        if (existsSync(bashPath)) return bashPath;
      }
    } catch (_e) {
      // Git not found
    }

    return process.env.COMSPEC || "cmd.exe";
  }

  if (process.platform === "darwin") {
    return "/bin/zsh";
  }

  // Linux: Try to find bash
  try {
    const bashPath = execSync("which bash", { encoding: "utf-8" }).trim();
    if (bashPath && existsSync(bashPath)) return bashPath;
  } catch (_e) {
    // Bash not found
  }

  return "/bin/sh";
}

/**
 * Get the preferred shell from environment or fallback
 */
export function getPreferredShell(): string {
  const shellEnv = process.env.SHELL;
  if (shellEnv && existsSync(shellEnv)) {
    return shellEnv;
  }
  return getFallbackShell();
}

/**
 * Get an acceptable shell (excluding blacklisted shells)
 *
 * Returns the shell from environment if not blacklisted,
 * otherwise returns the platform fallback.
 */
export function getAcceptableShell(): string {
  const shellEnv = process.env.SHELL;
  if (shellEnv && existsSync(shellEnv)) {
    const shellName =
      process.platform === "win32" ? path.win32.basename(shellEnv) : path.basename(shellEnv);

    if (!BLACKLIST.has(shellName)) {
      return shellEnv;
    }
  }
  return getFallbackShell();
}
