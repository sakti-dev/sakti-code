import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { execSync, spawn } from "node:child_process";

function stripBom(content: string): { bom: string; text: string } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { bom: "\ufeff", text: content.slice(1) };
  }
  return { bom: "", text: content };
}

function detectLineEnding(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeToLf(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function restoreLineEndings(content: string, ending: string): string {
  if (ending === "\r\n") return content.replace(/\n/g, "\r\n");
  return content;
}

const fileLocks = new Map<string, Promise<void>>();

function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const pending = fileLocks.get(path);
  const next = pending ? pending.then(fn, fn) : fn();
  fileLocks.set(path, next.then(
    () => { if (fileLocks.get(path) === next) fileLocks.delete(path); },
    () => { if (fileLocks.get(path) === next) fileLocks.delete(path); },
  ));
  return next;
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

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
      } catch { /* continue */ }
    }
    return name;
  }
}

const RG_BIN = resolveBin("rg");
const FD_BIN = resolveBin("fd");

function runCommand(cmd: string, cwd: string, timeout = 30000): string {
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
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private readonly maxBytes: number;
  private lineCount = 0;

  constructor(maxBytes = 100 * 1024) {
    this.maxBytes = maxBytes;
  }

  append(data: Buffer): void {
    if (this.totalBytes >= this.maxBytes) return;
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
    return this.totalBytes >= this.maxBytes;
  }
}

function spawnCommand(
  command: string,
  cwd: string,
  options: {
    timeout?: number;
    signal?: AbortSignal;
    onUpdate?: (text: string) => void;
    env?: Record<string, string>;
  } = {},
): Promise<{ output: string; exitCode: number | null; truncated: boolean; timedOut: boolean }> {
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
            options.onUpdate!(snapshot);
          }
        }, 50)
      : null;

    const finish = (exitCode: number | null, timedOutFlag: boolean) => {
      if (finished) return;
      finished = true;
      if (updateTimer) clearInterval(updateTimer);
      if (options.onUpdate && accum.content.length > lastUpdateLen) {
        options.onUpdate(accum.content);
      }
      resolve({ output: accum.content, exitCode, truncated: accum.truncated, timedOut: timedOutFlag });
    };

    child.stdout?.on("data", (data: Buffer) => accum.append(data));
    child.stderr?.on("data", (data: Buffer) => accum.append(data));

    if (ms > 0) {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(null, true);
      }, ms);
      child.on("close", (code) => { clearTimeout(timer); finish(code, false); });
      child.on("error", () => { clearTimeout(timer); finish(null, false); });
    } else {
      child.on("close", (code) => finish(code, false));
      child.on("error", () => finish(null, false));
    }

    if (options.signal) {
      const onAbort = () => { child.kill("SIGKILL"); finish(null, false); };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export interface ToolResult {
  content: string;
  terminate: boolean;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (id: string, args: Record<string, unknown>, signal?: AbortSignal, onUpdate?: (p: string) => void) => Promise<ToolResult>;
}

// ── Read Tool ──

export function createReadTool(cwd: string): ToolDefinition {
  return {
    name: "read",
    description: "Read file contents. Supports offset/limit for large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to cwd" },
        offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
        limit: { type: "number", description: "Max lines to read" },
      },
      required: ["path"],
    },
    execute: async (_id, args) => {
      const { path, offset, limit } = args as { path: string; offset?: number; limit?: number };
      const filePath = resolve(cwd, path);

      if (!existsSync(filePath)) {
        return { content: `File not found: ${path}`, terminate: false, isError: true };
      }

      const raw = await readFile(filePath, "utf-8");
      const lines = raw.split("\n");
      const maxLines = 2000;
      const maxBytes = 50 * 1024;

      const startLine = offset ? offset - 1 : 0;
      const endLine = limit ? startLine + limit : maxLines;
      const sliced = lines.slice(startLine, endLine);

      let content = sliced.join("\n");
      let truncated = false;

      if (lines.length > maxLines && !offset) {
        content = lines.slice(0, maxLines).join("\n");
        truncated = true;
      }

      if (Buffer.byteLength(content, "utf-8") > maxBytes) {
        content = content.slice(0, maxBytes);
        truncated = true;
      }

      if (truncated) {
        content += "\n\n[... truncated ...]";
      }

      return { content, terminate: false };
    },
  };
}

// ── Write Tool ──

export function createWriteTool(cwd: string): ToolDefinition {
  return {
    name: "write",
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to cwd" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    execute: async (_id, args) => {
      const { path, content } = args as { path: string; content: string };
      const filePath = resolve(cwd, path);

      const dir = join(filePath, "..");
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, content, "utf-8");

      return { content: `Wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${path}`, terminate: false };
    },
  };
}

// ── Edit Tool ──

export function createEditTool(cwd: string): ToolDefinition {
  return {
    name: "edit",
    description: "Apply exact text replacements to a file. Every edits[].oldText must match a unique, non-overlapping region. BOM and line endings are preserved.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to cwd" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
          },
        },
      },
      required: ["path", "edits"],
    },
    execute: async (_id, args) => {
      const { path, edits } = args as { path: string; edits: Array<{ oldText: string; newText: string }> };
      const filePath = resolve(cwd, path);

      if (!existsSync(filePath)) {
        return { content: `File not found: ${path}`, terminate: false, isError: true };
      }
      if (!Array.isArray(edits) || edits.length === 0) {
        return { content: "edits must be a non-empty array", terminate: false, isError: true };
      }

      return withFileLock(filePath, async () => {
        const raw = await readFile(filePath, "utf-8");
        const { bom, text } = stripBom(raw);
        const originalEnding = detectLineEnding(text);
        const normalized = normalizeToLf(text);

        for (const edit of edits) {
          const count = normalized.split(edit.oldText).length - 1;
          if (count === 0) {
            return {
              content: `Edit failed: oldText not found in ${path}:\n${edit.oldText.slice(0, 200)}`,
              terminate: false, isError: true,
            };
          }
          if (count > 1) {
            return {
              content: `Edit failed: oldText matches ${count} locations in ${path} (must be unique). Add more context:\n${edit.oldText.slice(0, 200)}`,
              terminate: false, isError: true,
            };
          }
        }

        let result = normalized;
        for (const edit of edits) {
          result = result.replace(edit.oldText, edit.newText);
        }

        const final = bom + restoreLineEndings(result, originalEnding);
        await writeFile(filePath, final, "utf-8");
        return { content: `Applied ${edits.length} edit(s) to ${path}`, terminate: false };
      });
    },
  };
}

// ── Bash Tool ──

export function createBashTool(cwd: string, defaultTimeout = 30_000): ToolDefinition {
  return {
    name: "bash",
    description: "Execute a shell command. Returns stdout+stderr. Output truncated to 100KB. Optional timeout in seconds.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in seconds" },
      },
      required: ["command"],
    },
    execute: async (_id, args, signal, onUpdate) => {
      const { command, timeout } = args as { command: string; timeout?: number };
      const ms = timeout ? timeout * 1000 : defaultTimeout;
      try {
        const result = await spawnCommand(command, cwd, {
          timeout: ms,
          signal,
          onUpdate,
        });
        let text = result.output || "(no output)";
        if (result.truncated) {
          text += "\n\n[Output truncated. Use grep/head/tail to read specific parts.]";
        }
        if (result.timedOut) {
          return { content: `${text}\n\n[Command timed out after ${timeout ?? Math.round(ms / 1000)}s]`, terminate: false, isError: true };
        }
        if (result.exitCode !== null && result.exitCode !== 0) {
          return { content: text, terminate: false, isError: true };
        }
        return { content: text, terminate: false };
      } catch (err: any) {
        return { content: err.message || String(err), terminate: false, isError: true };
      }
    },
  };
}

// ── Grep Tool ──

export function createGrepTool(cwd: string): ToolDefinition {
  return {
    name: "grep",
    description: "Search file contents using ripgrep.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern" },
        path: { type: "string", description: "Directory to search in (relative to cwd)" },
        ignoreCase: { type: "boolean", description: "Case insensitive search" },
        limit: { type: "number", description: "Max matches (default 100)" },
      },
      required: ["pattern"],
    },
    execute: async (_id, args) => {
      const { pattern, path, ignoreCase, limit } = args as { pattern: string; path?: string; ignoreCase?: boolean; limit?: number };
      const searchDir = shellQuote(resolve(cwd, path ?? "."));
      const maxMatches = limit ?? 100;
      const icFlag = ignoreCase ? " -i" : "";

      try {
        const result = runCommand(
          `${RG_BIN} --no-heading -n${icFlag} --max-count ${maxMatches} ${shellQuote(pattern)} ${searchDir}`,
          cwd, 30000,
        );

        const lines = result.trim().split("\n").filter(Boolean);
        if (lines.length === 0) {
          return { content: "No matches found.", terminate: false };
        }

        const matches = lines.map((line) => {
          const colonIdx = line.indexOf(":");
          const filePath = line.slice(0, colonIdx);
          const rest = line.slice(colonIdx + 1);
          return `${relative(cwd, filePath)}:${rest}`;
        });

        return { content: matches.join("\n"), terminate: false };
      } catch (err: any) {
        if (err.status === 1) {
          return { content: "No matches found.", terminate: false };
        }
        return { content: `grep error: ${err.message?.slice(0, 200) ?? String(err)}`, terminate: false, isError: true };
      }
    },
  };
}

// ── Find Tool ──

export function createFindTool(cwd: string): ToolDefinition {
  return {
    name: "find",
    description: "Locate files using fd.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. *.ts)" },
        path: { type: "string", description: "Directory to search (relative to cwd)" },
        limit: { type: "number", description: "Max results (default 1000)" },
      },
      required: ["pattern"],
    },
    execute: async (_id, args) => {
      const { pattern, path, limit } = args as { pattern: string; path?: string; limit?: number };
      const searchDir = shellQuote(resolve(cwd, path ?? "."));
      const maxResults = limit ?? 1000;

      try {
        const result = runCommand(
          `${FD_BIN} --glob ${shellQuote(pattern)} --hidden --no-require-git --max-results ${maxResults} ${searchDir}`,
          cwd, 15000,
        );

        const files = result.trim().split("\n").filter(Boolean).map((f) => relative(cwd, f));
        if (files.length === 0) {
          return { content: "No files found.", terminate: false };
        }

        return { content: files.join("\n"), terminate: false };
      } catch (err: any) {
        if (err.status === 1) {
          return { content: "No files found.", terminate: false };
        }
        return { content: `find error: ${err.stderr?.slice(0, 200) ?? err.message?.slice(0, 200) ?? String(err)} (status=${err.status})`, terminate: false, isError: true };
      }
    },
  };
}

// ── Ls Tool ──

export function createLsTool(cwd: string): ToolDefinition {
  return {
    name: "ls",
    description: "List directory contents.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list (relative to cwd, default is cwd)" },
        limit: { type: "number", description: "Max entries (default 500)" },
      },
    },
    execute: async (_id, args) => {
      const { path, limit } = args as { path?: string; limit?: number };
      const dirPath = resolve(cwd, path ?? ".");
      const maxEntries = limit ?? 500;

      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        const sorted = entries
          .sort((a, b) => {
            // Directories first
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          })
          .slice(0, maxEntries)
          .map((e) => e.isDirectory() ? `${e.name}/` : e.name);

        return { content: sorted.join("\n"), terminate: false };
      } catch (err: any) {
        return { content: `ls error: ${err.message?.slice(0, 200) ?? String(err)}`, terminate: false, isError: true };
      }
    },
  };
}
