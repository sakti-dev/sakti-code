function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export { shellQuote };

function resolveBin(name: string): string {
  try {
    const result = Bun.spawnSync(["/bin/sh", "-c", `which ${name}`]);
    const stdout = result.stdout?.toString().trim();
    if (stdout && result.exitCode === 0) {
      return stdout;
    }
  } catch {
    /* continue to fallback */
  }
  const home = process.env.HOME ?? "/root";
  const candidates = [
    `${home}/.pi/agent/bin/${name}`,
    `${home}/.local/bin/${name}`,
    `/usr/local/bin/${name}`,
  ];
  for (const c of candidates) {
    try {
      const check = Bun.spawnSync(["/bin/sh", "-c", `test -x ${c}`]);
      if (check.exitCode === 0) {
        return c;
      }
    } catch {
      /* continue */
    }
  }
  return name;
}

export const RG_BIN = resolveBin("rg");
export const FD_BIN = resolveBin("fd");

export function runCommand(
  cmd: string,
  cwd: string,
  _timeout = 30_000
): string {
  const result = Bun.spawnSync(["/bin/sh", "-c", cmd], { cwd });
  return result.stdout?.toString() ?? "";
}

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

export async function spawnCommand(
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
  const accum = new OutputAccumulator();
  const ms = options.timeout ?? 30_000;

  const proc = Bun.spawn({
    cmd: ["/bin/sh", "-c", command],
    cwd,
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutStream = proc.stdout as ReadableStream<Uint8Array>;
  const stderrStream = proc.stderr as ReadableStream<Uint8Array>;

  let timedOut = false;
  const timeoutId =
    ms > 0
      ? setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
          stdoutStream.cancel().catch(() => {});
          stderrStream.cancel().catch(() => {});
        }, ms)
      : undefined;

  let lastUpdateLen = 0;
  const updateTimer = options.onUpdate
    ? setInterval(() => {
        const snapshot = accum.content;
        if (snapshot.length > lastUpdateLen) {
          lastUpdateLen = snapshot.length;
          options.onUpdate?.(snapshot);
        }
      }, 50)
    : undefined;

  const onAbort = () => {
    proc.kill("SIGKILL");
    stdoutStream.cancel().catch(() => {});
    stderrStream.cancel().catch(() => {});
  };
  if (options.signal) {
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const readStream = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      accum.append(Buffer.from(value));
    }
  };

  try {
    await Promise.all([
      readStream(proc.stdout as ReadableStream<Uint8Array>),
      readStream(proc.stderr as ReadableStream<Uint8Array>),
    ]);
    const exitCode = await proc.exited;

    if (options.onUpdate && accum.content.length > lastUpdateLen) {
      options.onUpdate(accum.content);
    }

    return {
      output: accum.content,
      exitCode,
      truncated: accum.truncated,
      timedOut,
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (updateTimer) {
      clearInterval(updateTimer);
    }
    options.signal?.removeEventListener("abort", onAbort);
  }
}
