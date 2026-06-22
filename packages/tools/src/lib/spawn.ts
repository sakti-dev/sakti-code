import { spawn } from "node:child_process";

export interface RunProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Spawn a process, collect stdout/stderr as strings, and resolve its exit code.
 * On abort, the child is killed with SIGKILL. Mirrors the collect-all pattern
 * the find/grep tools previously built on top of Bun.spawn + Response(stream).
 */
export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {}
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const onAbort = () => proc.kill("SIGKILL");
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const finalize = (code: number) => {
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: code, stderr, stdout });
    };

    proc.on("error", () => finalize(1));
    proc.on("close", (code) => finalize(code ?? 0));
  });
}
