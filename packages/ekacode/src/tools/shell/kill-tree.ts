/**
 * Process tree cleanup utilities
 *
 * Handles killing process trees on all platforms (Windows, Linux, macOS)
 */

import { spawn, type ChildProcess } from "node:child_process";

const SIGKILL_TIMEOUT_MS = 200;

/**
 * Kill a process tree including all child processes
 *
 * @param proc - The child process to kill
 * @param opts - Options for checking if process already exited
 */
export async function killTree(
  proc: ChildProcess,
  opts?: { exited?: () => boolean }
): Promise<void> {
  const pid = proc.pid;
  if (!pid || opts?.exited?.()) return;

  if (process.platform === "win32") {
    // Windows: Use taskkill to terminate the process tree
    await new Promise<void>(resolve => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }

  // Unix: Use process group killing with negative PID
  try {
    // Try SIGTERM first for graceful shutdown
    process.kill(-pid, "SIGTERM");
    await sleep(SIGKILL_TIMEOUT_MS);
    // If still not exited, use SIGKILL
    if (!opts?.exited?.()) {
      process.kill(-pid, "SIGKILL");
    }
  } catch (_e) {
    // Fallback: Try killing the process directly
    try {
      proc.kill("SIGTERM");
      await sleep(SIGKILL_TIMEOUT_MS);
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL");
      }
    } catch (_e2) {
      // Process may already be dead
    }
  }
}

/**
 * Simple sleep utility for promises
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
