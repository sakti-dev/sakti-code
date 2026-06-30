import { spawn } from "node:child_process";

export interface RunProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export class EngineBinaryError extends Error {
  readonly code = "ENGINE_BINARY_NOT_FOUND" as const;
  constructor(command: string, cause: NodeJS.ErrnoException) {
    super(`Engine binary not found: "${command}" (${cause.code ?? "unknown"})`, { cause });
    this.name = "EngineBinaryError";
  }
}

const SPAWN_FAILURE_CODES = new Set(["ENOENT", "EACCES"]);

/**
 * Spawn a process, collect stdout/stderr as strings, and resolve its exit code.
 * On abort, the child is killed with SIGKILL. Spawn-time failures (e.g. the
 * binary is missing / ENOENT) reject with an {@link EngineBinaryError} so the
 * caller can surface a clear root-cause instead of a misleading "exit code 1".
 */
export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
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

    proc.on("error", (err: NodeJS.ErrnoException) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (err.code !== undefined && SPAWN_FAILURE_CODES.has(err.code)) {
        reject(new EngineBinaryError(command, err));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => finalize(code ?? 0));
  });
}
