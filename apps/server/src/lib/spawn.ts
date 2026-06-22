import { spawn } from "node:child_process";
import { text } from "node:stream/consumers";

export interface SpawnResult {
  exitCode: number | null;
  spawnError?: string;
  stderr: string;
  stdout: string;
}

export interface SpawnHandle {
  child: ReturnType<typeof spawn>;
  done: Promise<SpawnResult>;
}

/**
 * Spawn a child process with piped stdout/stderr. Collects output as text and
 * resolves on close. A missing binary surfaces as `result.spawnError` (Node
 * emits an async 'error' event, unlike Bun.spawn which throws synchronously).
 */
export function spawnPiped(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {}
): SpawnHandle {
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutPromise = text(child.stdout);
  const stderrPromise = text(child.stderr);

  const done = new Promise<SpawnResult>((resolve) => {
    let spawnError: string | undefined;
    child.on("error", (err) => {
      spawnError = err.message;
    });
    child.on("close", async (exitCode) => {
      const [stdout, stderr] = await Promise.all([
        stdoutPromise,
        stderrPromise,
      ]);
      resolve({
        exitCode,
        stderr,
        stdout,
        ...(spawnError === undefined ? {} : { spawnError }),
      });
    });
  });

  return { child, done };
}
