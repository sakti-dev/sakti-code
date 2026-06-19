import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

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
    shell: true,
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
    description: "Apply exact text replacements to a file. All edits are atomic.",
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

      const raw = await readFile(filePath, "utf-8");

      // Validate all edits before applying
      for (const edit of edits) {
        if (!raw.includes(edit.oldText)) {
          return { content: `Edit failed: oldText not found in ${path}:\n${edit.oldText.slice(0, 200)}`, terminate: false, isError: true };
        }
      }

      // Apply all edits
      let result = raw;
      for (const edit of edits) {
        result = result.replace(edit.oldText, edit.newText);
      }

      await writeFile(filePath, result, "utf-8");
      return { content: `Applied ${edits.length} edit(s) to ${path}`, terminate: false };
    },
  };
}

// ── Bash Tool ──

export function createBashTool(cwd: string, defaultTimeout = 30000): ToolDefinition {
  return {
    name: "bash",
    description: "Execute a shell command in the project directory.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds" },
      },
      required: ["command"],
    },
    execute: async (_id, args) => {
      const { command, timeout } = args as { command: string; timeout?: number };
      const ms = timeout ?? defaultTimeout;

      try {
        const output = runCommand(command, cwd, ms);
        return { content: output || "(no output)", terminate: false };
      } catch (err: any) {
        const msg = err.message || String(err);
        if (msg.includes("TIMEDOUT") || msg.includes("timed out")) {
          return { content: `Command timed out after ${ms}ms`, terminate: false, isError: true };
        }
        return { content: msg, terminate: false, isError: true };
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
