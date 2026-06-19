import { execSync, spawn } from "node:child_process";

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export { shellQuote };

/** Resolve a binary from PATH, returning absolute path or the name as fallback. */
function resolveBin(name: string): string {
  try {
    return execSync(`which ${name}`, { encoding: "utf-8" }).trim();
  } catch {
    // Fallback: check common locations
    const home = process.env.HOME ?? "/root";
    const candidates = [
      `${home}/.pi/agent/bin/${name}`,
      `${home}/.local/bin/${name}`,
      `/usr/local/bin/${name}`,
    ];
    for (const c of candidates) {
      try {
        execSync(`test -x ${c}`);
        return c;
      } catch {
        /* continue */
      }
    }
    return name;
  }
}

export const RG_BIN = resolveBin("rg");
export const FD_BIN = resolveBin("fd");

export function runCommand(cmd: string, cwd: string, timeout = 30_000): string {
  return execSync(cmd, {
    encoding: "utf-8",
    cwd,
    timeout,
    maxBuffer: 1024 * 1024,
    shell: "/bin/sh",
  });
}

/** Accumulates process output with byte and line limits. */
class OutputAccumulator {
  private readonly chunks: Buffer[] = [];
  private totalBytes = 0;
  private lineCount = 0;
  private readonly maxBytes: number;
  private readonly maxLines: number;

  constructor(maxBytes = 100 * 1024, maxLines = 2000) {
    this.maxBytes = maxBytes;
    this.maxLines = maxLines;
  }

  append(data: Buffer): void {
    if (this.totalBytes >= this.maxBytes) {
      return;
    }
    const remaining = this.maxBytes - this.totalBytes;
    const chunk = data.length > remaining ? data.subarray(0, remaining) : data;
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
    this.lineCount += chunk.toString("utf-8").split("\n").length - 1;
  }

  get content(): string {
    return Buffer.concat(this.chunks).toString("utf-8");
  }

  get truncated(): boolean {
    return this.lineCount > this.maxLines || this.totalBytes >= this.maxBytes;
  }
}

export function spawnCommand(
  command: string,
  cwd: string,
  options: {
    timeout?: number;
    signal?: AbortSignal;
    onUpdate?: (text: string) => void;
    env?: Record<string, string>;
  } = {}
): Promise<{
  output: string;
  exitCode: number | null;
  truncated: boolean;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const accum = new OutputAccumulator();
    const ms = options.timeout ?? 30_000;
    let finished = false;

    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      env: { ...process.env, ...options.env } as Record<string, string>,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let lastUpdateLen = 0;
    const updateTimer = options.onUpdate
      ? setInterval(() => {
          const snapshot = accum.content;
          if (snapshot.length > lastUpdateLen) {
            lastUpdateLen = snapshot.length;
            options.onUpdate?.(snapshot);
          }
        }, 50)
      : null;

    const finish = (exitCode: number | null, timedOutFlag: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      if (updateTimer) {
        clearInterval(updateTimer);
      }
      if (options.onUpdate && accum.content.length > lastUpdateLen) {
        options.onUpdate(accum.content);
      }
      resolve({
        output: accum.content,
        exitCode,
        truncated: accum.truncated,
        timedOut: timedOutFlag,
      });
    };

    child.stdout?.on("data", (data: Buffer) => accum.append(data));
    child.stderr?.on("data", (data: Buffer) => accum.append(data));

    if (ms > 0) {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(null, true);
      }, ms);
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(code, false);
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish(null, false);
      });
    } else {
      child.on("close", (code) => finish(code, false));
      child.on("error", () => finish(null, false));
    }

    if (options.signal) {
      const onAbort = () => {
        child.kill("SIGKILL");
        finish(null, false);
      };
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });
}
