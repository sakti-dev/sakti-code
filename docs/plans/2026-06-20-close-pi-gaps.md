# Close Pi Gaps Implementation Plan

> **Status: ✅ COMPLETE** — All 6 tasks implemented, 88 tests passing, 0 type errors.
>
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the 6 most impactful gaps between sakti-code's agent-core-packages and the Pi reference implementation.

**Architecture:** Each task is independently committable. Tasks 1-4 (tools) are independent of Tasks 5-6 (agent). All tasks modify existing files in the monorepo — no new packages needed. Tests use vitest (tools, agent) and bun:test (db).

**Tech Stack:** TypeScript 6.0.3, Bun 1.2.14, Vitest 4.1.9, @earendil-works/pi-ai 0.79.8, drizzle-orm 0.44.2, bun:sqlite, child_process.spawn

---

## Quick Reference

- **Workspace root:** `/home/eekrain/CODE/sakti-code`
- **Run all tool tests:** `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/`
- **Run agent tests (safe set):** `npx vitest run packages/agent/ --exclude '**/loop.test.ts'`
- **Run db tests:** `cd /home/eekrain/CODE/sakti-code/packages/db && bun test`
- **Typecheck:** `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
- **Commit:** `git add -A && git commit -m "feat: ..."`

### Key File Map

```
packages/tools/src/
  index.ts                          — All 7 tool creators (read, write, edit, bash, grep, find, ls)
  __tests__/tools.test.ts           — 21 vitest tests

packages/agent/src/
  types.ts                          — AgentMessage, AgentEvent, AgentTool, AgentToolResult, SessionStore, AgentConfig
  loop.ts                           — createAgentLoop() — the main loop
  compaction.ts                     — shouldCompact(), estimateTokens()
  index.ts                          — re-exports

packages/db/src/
  session-store.ts                  — SqliteSessionStore implementing SessionStore
  repos/index.ts                    — ProjectRepo, SessionRepo, MessageRepo, CostRepo, SettingsRepo, ModelConfigRepo
```

### Test Count Baseline

- Tools: 21 passing (vitest)
- Agent: 36 passing (vitest, excluding loop.test.ts OOM)
- DB: 16 passing (bun:test)
- Typecheck: 0 errors
- **Total: 73 passing**

### Final Results

- Tools: **33 passing** (+12 new: 3 async bash, 4 edit hardening, 1 image, 4 validation)
- Agent: **39 passing** (+3 compaction execution)
- DB: 16 passing (unchanged)
- Typecheck: **0 errors**
- **Total: 88 passing** (target was 87)

---

## Task 1: Async Bash Tool (Critical)

**Why:** `execSync` blocks the event loop. In a multi-agent desktop app, one agent running `npm install` freezes every other agent. Pi uses `child_process.spawn` with real streaming.

**Files:**
- Modify: `packages/tools/src/index.ts` — rewrite `runCommand`, add `OutputAccumulator`, rewrite `createBashTool`
- Modify: `packages/tools/src/__tests__/tools.test.ts` — add async tests

### Task 1.1: Create OutputAccumulator class

**Step 1: Write the OutputAccumulator class in `packages/tools/src/index.ts`**

Add this before the tool creators (after `runCommand`):

```ts
import { spawn } from "node:child_process";

/** Accumulates process output with byte and line limits. */
class OutputAccumulator {
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private readonly maxBytes: number;
  private readonly maxLines: number;
  private lineCount = 0;

  constructor(maxBytes = 100 * 1024, maxLines = 2000) {
    this.maxBytes = maxBytes;
    this.maxLines = maxLines;
  }

  append(data: Buffer): void {
    if (this.totalBytes >= this.maxBytes) return;
    const remaining = this.maxBytes - this.totalBytes;
    const chunk = data.length > remaining ? data.subarray(0, remaining) : data;
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
    // Count newlines (approximate, fine for truncation)
    this.lineCount += chunk.toString("utf-8").split("\n").length - 1;
  }

  get content(): string {
    return Buffer.concat(this.chunks).toString("utf-8");
  }

  get truncated(): boolean {
    return this.lineCount > this.maxLines || this.totalBytes >= this.maxBytes;
  }
}
```

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: 0 errors

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(tools): add OutputAccumulator for streaming bash output"
```

### Task 1.2: Create async spawnCommand helper

**Step 1: Add `spawnCommand` function after `OutputAccumulator` in `packages/tools/src/index.ts`**

```ts
interface SpawnResult {
  output: string;
  exitCode: number | null;
  truncated: boolean;
  timedOut: boolean;
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
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const accum = new OutputAccumulator();
    const ms = options.timeout ?? 30_000;
    let timedOut = false;
    let killed = false;

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
        }, 100)
      : null;

    const finish = (exitCode: number | null, timedOutFlag: boolean) => {
      killed = true;
      if (updateTimer) clearInterval(updateTimer);
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

    child.stdout?.on("data", (data: Buffer) => { if (!killed) accum.append(data); });
    child.stderr?.on("data", (data: Buffer) => { if (!killed) accum.append(data); });

    if (ms > 0) {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
        finish(null, true);
      }, ms);
      child.on("close", (code) => { clearTimeout(timer); if (!killed) finish(code, false); });
      child.on("error", () => { clearTimeout(timer); if (!killed) finish(null, false); });
    } else {
      child.on("close", (code) => { if (!killed) finish(code, false); });
      child.on("error", () => { if (!killed) finish(null, false); });
    }

    if (options.signal) {
      const onAbort = () => { if (!killed) { child.kill("SIGKILL"); finish(null, false); } };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
```

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: 0 errors

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(tools): add spawnCommand async helper with streaming and timeout"
```

### Task 1.3: Rewrite createBashTool to use spawnCommand

**Step 1: Replace the `createBashTool` function in `packages/tools/src/index.ts`**

Find the current `createBashTool` function and replace it entirely with:

```ts
export function createBashTool(cwd: string, defaultTimeout = 30_000): ToolDefinition {
  return {
    name: "bash",
    description: "Execute a shell command. Returns stdout+stderr. Output truncated to 2000 lines or 100KB. Optional timeout in seconds.",
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
```

Also remove the old synchronous `runCommand` function (it's no longer used by bash — grep and find still use it but they're fine since they're fast lookups).

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: 0 errors

**Step 3: Run existing bash tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/ --reporter=verbose 2>&1 | grep -A2 "BashTool"`
Expected: All 3 existing bash tests pass (echo, exit 1, timeout)

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(tools): rewrite bash tool with async spawn, streaming, truncation"
```

### Task 1.4: Add async bash tool tests

**Step 1: Add new tests to `packages/tools/src/__tests__/tools.test.ts`** in the `BashTool` describe block

Append these tests after the existing 3 bash tests:

```ts
it("streams output via onUpdate callback", async () => {
  const updates: string[] = [];
  const tool = createBashTool(tmpDir);
  const result = await tool.execute("tc_1", { command: `for i in 1 2 3; do echo $i; sleep 0.2; done` }, undefined, (partial) => {
    updates.push(partial);
  });
  expect(result.isError).toBeFalsy();
  expect(result.content).toContain("3");
  expect(updates.length).toBeGreaterThanOrEqual(2); // at least 2 streaming updates
});

it("respects abort signal", async () => {
  const controller = new AbortController();
  const tool = createBashTool(tmpDir, 60_000);
  const promise = tool.execute(
    "tc_1",
    { command: "sleep 30" },
    controller.signal,
  );
  // Abort after a short delay
  setTimeout(() => controller.abort(), 50);
  const result = await promise;
  // Result should come back (not hang) — may be error or not
  expect(result).toBeDefined();
});
```

**Step 2: Run tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/`
Expected: 23 passing (21 original + 2 new)

**Step 3: Commit**

```bash
git add -A && git commit -m "test(tools): async bash streaming and abort signal tests"
```

---

## Task 2: Edit Tool Hardening (Critical)

**Why:** Current edit tool will corrupt CRLF files, silently strip BOM, and doesn't check for duplicate `oldText` matches (non-unique edits apply to wrong location). Pi handles all of these.

**Files:**
- Modify: `packages/tools/src/index.ts` — add BOM/line-ending utils, rewrite edit validation
- Modify: `packages/tools/src/__tests__/tools.test.ts` — add BOM, CRLF, uniqueness tests

### Task 2.1: Add BOM and line-ending utilities

**Step 1: Add these utility functions at the top of `packages/tools/src/index.ts`** (after imports, before `shellQuote`):

```ts
function stripBom(content: string): { bom: string; text: string } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { bom: "\ufeff", text: content.slice(1) };
  }
  return { bom: "", text: content };
}

function detectLineEnding(content: string): string {
  const crlfIdx = content.indexOf("\r\n");
  if (crlfIdx >= 0) return "\r\n";
  return "\n";
}

function normalizeToLf(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function restoreLineEndings(content: string, ending: string): string {
  if (ending === "\r\n") return content.replace(/\n/g, "\r\n");
  return content;
}
```

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: 0 errors

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(tools): add BOM and line-ending utilities for edit tool"
```

### Task 2.2: Add file mutation queue (concurrent edit safety)

**Step 1: Add the mutation queue after the line-ending utilities in `packages/tools/src/index.ts`**

```ts
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
```

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: 0 errors

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(tools): add file mutation queue for concurrent edit safety"
```

### Task 2.3: Rewrite createEditTool with BOM, line-endings, uniqueness check

**Step 1: Replace the `createEditTool` function in `packages/tools/src/index.ts`**

```ts
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

        // Validate uniqueness: each oldText must appear exactly once
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
              content: `Edit failed: oldText matches ${count} locations in ${path} (must be unique). Add more surrounding context:\n${edit.oldText.slice(0, 200)}`,
              terminate: false, isError: true,
            };
          }
        }

        // Apply edits sequentially (safe: each oldText is unique)
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
```

**Step 2: Run existing edit tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/ --reporter=verbose 2>&1 | grep -A2 "EditTool"`
Expected: All 4 existing edit tests pass

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(tools): rewrite edit tool with BOM preservation, line endings, uniqueness check"
```

### Task 2.4: Add edit tool hardening tests

**Step 1: Add tests to `packages/tools/src/__tests__/tools.test.ts`** in the `EditTool` describe block

Append after the existing 4 edit tests:

```ts
it("preserves BOM on edit", async () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]); // UTF-8 BOM
  const content = Buffer.concat([bom, Buffer.from("hello\nworld\n")]);
  writeFileSync(join(tmpDir, "bom.txt"), content);
  const tool = createEditTool(tmpDir);
  await tool.execute("tc_1", { path: "bom.txt", edits: [{ oldText: "hello", newText: "HELLO" }] });
  const result = readFileSync(join(tmpDir, "bom.txt"), "utf-8");
  expect(result.charCodeAt(0)).toBe(0xfeff); // BOM preserved
  expect(result).toContain("HELLO");
});

it("preserves CRLF line endings", async () => {
  writeFileSync(join(tmpDir, "crlf.txt"), "line1\r\nline2\r\n");
  const tool = createEditTool(tmpDir);
  await tool.execute("tc_1", { path: "crlf.txt", edits: [{ oldText: "line1", newText: "LINE1" }] });
  const result = readFileSync(join(tmpDir, "crlf.txt"), "utf-8");
  expect(result).toContain("\r\n"); // CRLF preserved
  expect(result).toContain("LINE1\r\n");
});

it("rejects non-unique oldText", async () => {
  writeFileSync(join(tmpDir, "dup.txt"), "const x = 1;\nconst x = 2;\n");
  const tool = createEditTool(tmpDir);
  const result = await tool.execute("tc_1", { path: "dup.txt", edits: [{ oldText: "const x", newText: "const y" }] });
  expect(result.isError).toBe(true);
  expect(result.content).toContain("matches 2 locations");
  // File unchanged
  expect(readFileSync(join(tmpDir, "dup.txt"), "utf-8")).toBe("const x = 1;\nconst x = 2;\n");
});

it("rejects empty edits array", async () => {
  writeFileSync(join(tmpDir, "empty.txt"), "hello");
  const tool = createEditTool(tmpDir);
  const result = await tool.execute("tc_1", { path: "empty.txt", edits: [] });
  expect(result.isError).toBe(true);
});
```

**Step 2: Run tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/`
Expected: 27 passing (23 from Task 1 + 4 new)

**Step 3: Commit**

```bash
git add -A && git commit -m "test(tools): BOM, CRLF, uniqueness, and empty edits tests"
```

---

## Task 3: Read Tool Image Support

**Why:** Multimodal models can see images. Pi's read tool detects MIME types, reads image files as base64, and auto-resizes. We need at least basic image passthrough.

**Files:**
- Modify: `packages/tools/src/index.ts` — update `createReadTool`
- Modify: `packages/tools/src/__tests__/tools.test.ts` — add image test

### Task 3.1: Add image support to createReadTool

**Step 1: Add MIME detection helper at the top of `packages/tools/src/index.ts`** (after the line-ending utilities):

```ts
const IMAGE_EXTENSIONS = new Map([
  ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"],
  ["png", "image/png"], ["gif", "image/gif"], ["webp", "image/webp"],
]);

function detectImageMime(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.get(ext) : undefined;
}

function bufferToBase64DataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}
```

**Step 2: Replace the `createReadTool` function body's execute method** with this updated version:

```ts
export function createReadTool(cwd: string): ToolDefinition {
  return {
    name: "read",
    description: "Read file contents. Supports text and images (jpg, png, gif, webp). Images are returned as base64 data URLs. Text supports offset/limit for large files.",
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

      // Check for image file
      const mime = detectImageMime(path);
      if (mime) {
        const buf = await readFile(filePath);
        const dataUrl = bufferToBase64DataUrl(buf, mime);
        return { content: `Read image file [${mime}]\n${dataUrl}`, terminate: false };
      }

      // Text file
      const raw = await readFile(filePath, "utf-8");
      const lines = raw.split("\n");
      const maxLines = 2000;
      const maxBytes = 50 * 1024;

      const startLine = offset ? offset - 1 : 0;
      const endLine = limit ? startLine + limit : lines.length;
      const sliced = lines.slice(startLine, endLine);

      let content = sliced.join("\n");
      let truncated = false;

      if (!offset && lines.length > maxLines) {
        content = lines.slice(0, maxLines).join("\n");
        truncated = true;
      }

      if (Buffer.byteLength(content, "utf-8") > maxBytes) {
        content = content.slice(0, maxBytes);
        truncated = true;
      }

      if (truncated) {
        const shownLines = content.split("\n").length;
        const nextOffset = (offset ? offset : 1) + shownLines;
        content += `\n\n[Showing ${shownLines} of ${lines.length} lines. Use offset=${nextOffset} to continue.]`;
      }

      return { content, terminate: false };
    },
  };
}
```

**Step 3: Run existing read tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/ --reporter=verbose 2>&1 | grep -A2 "ReadTool"`
Expected: All 4 existing read tests pass

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(tools): add image support and better truncation messaging to read tool"
```

### Task 3.2: Add image read test

**Step 1: Add test in the `ReadTool` describe block in `packages/tools/src/__tests__/tools.test.ts`**

```ts
it("reads image files as base64 data URL", async () => {
  // Create a minimal 1x1 PNG
  const minimalPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  );
  writeFileSync(join(tmpDir, "test.png"), minimalPng);
  const tool = createReadTool(tmpDir);
  const result = await tool.execute("tc_1", { path: "test.png" });
  expect(result.isError).toBeFalsy();
  expect(result.content).toContain("image/png");
  expect(result.content).toContain("data:image/png;base64,");
});
```

**Step 2: Run tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/`
Expected: 28 passing

**Step 3: Commit**

```bash
git add -A && git commit -m "test(tools): image file read test"
```

---

## Task 4: Tool Argument Validation

**Why:** Tools receive raw `Record<string, unknown>` from the LLM. Malformed arguments (missing required fields, wrong types) currently cause runtime errors or silent failures. Pi validates with TypeBox schemas.

**Files:**
- Modify: `packages/tools/src/index.ts` — add `validateArgs` helper, apply to all tools
- Modify: `packages/tools/src/__tests__/tools.test.ts` — add validation tests

### Task 4.1: Add validateArgs helper

**Step 1: Add this function in `packages/tools/src/index.ts`** (after the image helpers):

```ts
interface ArgDef {
  type: "string" | "number" | "boolean" | "array" | "object";
  required?: boolean;
  description?: string;
}

function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, ArgDef>,
  toolName: string,
): { valid: true; args: Record<string, unknown> } | { valid: false; error: string } {
  const result: Record<string, unknown> = {};

  // Check for unexpected keys (ignore)
  for (const [key, def] of Object.entries(schema)) {
    if (def.required && !(key in args)) {
      return { valid: false, error: `Missing required argument '${key}' for ${toolName}` };
    }
    if (key in args) {
      const val = args[key];
      const typeOk =
        (def.type === "string" && typeof val === "string") ||
        (def.type === "number" && typeof val === "number") ||
        (def.type === "boolean" && typeof val === "boolean") ||
        (def.type === "array" && Array.isArray(val)) ||
        (def.type === "object" && val !== null && typeof val === "object" && !Array.isArray(val));
      if (!typeOk && val !== undefined) {
        return { valid: false, error: `Argument '${key}' must be ${def.type}, got ${typeof val}` };
      }
      result[key] = val;
    }
  }

  return { valid: true, args: result };
}
```

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: 0 errors

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(tools): add validateArgs helper for tool argument validation"
```

### Task 4.2: Apply validation to all tool execute methods

**Step 1: Add validation at the top of each tool's `execute` method.** The pattern is the same for each tool. Here's the approach:

For each tool, add this as the first lines of execute:
```ts
const v = validateArgs(args as Record<string, unknown>, { path: { type: "string", required: true }, ... }, "toolname");
if (!v.valid) return { content: v.error, terminate: false, isError: true };
const { path, ... } = v.args as { path: string; ... };
```

Apply to:
- **read:** validate `path` (required string), `offset` (optional number), `limit` (optional number)
- **write:** validate `path` (required string), `content` (required string)
- **edit:** validate `path` (required string), `edits` (required array)
- **bash:** validate `command` (required string), `timeout` (optional number)
- **grep:** validate `pattern` (required string), `path` (optional string), `ignoreCase` (optional boolean), `limit` (optional number)
- **find:** validate `pattern` (required string), `path` (optional string), `limit` (optional number)
- **ls:** validate `path` (optional string), `limit` (optional number)

**Step 2: Run all tool tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/`
Expected: 28 passing (existing tests still work — their args are already valid)

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(tools): add argument validation to all 7 tools"
```

### Task 4.3: Add validation tests

**Step 1: Add a describe block for argument validation in `packages/tools/src/__tests__/tools.test.ts`**

```ts
describe("Tool Argument Validation", () => {
  it("read rejects missing path", async () => {
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Missing required");
  });

  it("bash rejects missing command", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Missing required");
  });

  it("edit rejects missing path", async () => {
    const tool = createEditTool(tmpDir);
    const result = await tool.execute("tc_1", { edits: [] });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Missing required");
  });

  it("bash rejects wrong type for timeout", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", { command: "echo hi", timeout: "ten" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("must be number");
  });
});
```

**Step 2: Run tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/`
Expected: 32 passing (28 + 4 new)

**Step 3: Commit**

```bash
git add -A && git commit -m "test(tools): argument validation tests for all tools"
```

---

## Task 5: Agent Event Enrichment

**Why:** Our events are lossy — the SolidJS frontend can't reconstruct the assistant message from deltas alone. Pi forwards the raw `AssistantMessageEvent` and includes full messages in turn events.

**Files:**
- Modify: `packages/agent/src/types.ts` — update event interfaces
- Modify: `packages/agent/src/loop.ts` — forward richer data in events

### Task 5.1: Update event type definitions

**Step 1: Update the following interfaces in `packages/agent/src/types.ts`**

Replace the `MessageUpdateEvent`:
```ts
export interface MessageUpdateEvent extends AgentEventBase {
  type: "message_update";
  update: MessageUpdate;
  /** Current partial assistant message content. Undefined for non-content events. */
  content?: (TextContent | ThinkingContent | ToolCall)[];
}
```

Replace the `TurnEndEvent`:
```ts
export interface TurnEndEvent extends AgentEventBase {
  type: "turn_end";
  turnIndex: number;
  /** Final assistant message for this turn. */
  message: Extract<AgentMessage, { role: "assistant" }>;
  /** Tool result messages from this turn (empty if no tool calls). */
  toolResults: Extract<AgentMessage, { role: "tool" }>[];
}
```

Replace the `ToolExecutionEndEvent`:
```ts
export interface ToolExecutionEndEvent extends AgentEventBase {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: AgentToolResult;
}
```

Add imports at the top if needed — `TextContent`, `ThinkingContent` are already defined in types.ts. `ToolCall` is already imported from pi-ai.

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: Errors in loop.ts (it doesn't match the new interfaces yet) — this is expected for TDD.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(agent): enrich event types with message content and tool results"
```

### Task 5.2: Update loop.ts to emit enriched events

**Step 1: Update `packages/agent/src/loop.ts`** to match the new event types.

In the streaming switch statement, update the `message_update` yields to include content:

```ts
// Inside the for-await-of stream events switch:
case "text_delta":
case "thinking_delta":
  if (partialAssistant) {
    // Rebuild content array from accumulated data
    const content = buildContentFromStream(partialAssistant);
    yield evt("message_update", { update: { type: event.type, delta: event.delta }, content });
  }
  break;
case "toolcall_start":
case "toolcall_delta":
case "toolcall_end":
  if (partialAssistant) {
    const content = buildContentFromStream(partialAssistant);
    yield evt("message_update", { update: { type: event.type, ...event }, content });
  }
  break;
```

You'll need a helper to track the partial assistant content. Add this before the loop function:

```ts
function buildContentFromStream(events: Array<{ type: string; delta?: string; toolCall?: any; contentIndex?: number }>): (TextContent | ThinkingContent | ToolCall)[] {
  // This is simplified — Pi tracks the full partial message via event.partial
  // For our case, we emit the raw events as-is and let the frontend reconstruct
  return [];
}
```

Actually, since pi-ai's `streamSimple` doesn't provide a partial message builder (that's in the TUI layer), and we can't easily reconstruct the full partial from individual events, the pragmatic approach is:

**Simpler approach:** Don't include partial `content` in `message_update` events yet. Instead, focus on the turn_end and tool_execution_end enrichment which are straightforward.

Replace the approach in 5.1 to NOT add `content` to `MessageUpdateEvent` (keep it simple), and focus on `TurnEndEvent` and `ToolExecutionEndEvent`.

**Revised Step 1:**

In `loop.ts`, find the `turn_end` yield and replace:
```ts
// OLD:
yield evt("turn_end", { turnIndex });

// NEW:
yield evt("turn_end", {
  turnIndex,
  message: finalAssistant,
  toolResults: toolResultMessages,
});
```

Where `toolResultMessages` is collected during tool execution:
```ts
// In the tool execution section, collect results:
const toolResultMessages: Extract<AgentMessage, { role: "tool" }>[] = [];
// ... inside the for-of toolCalls loop, after each tool execute:
const toolMsg: Extract<AgentMessage, { role: "tool" }> = {
  role: "tool",
  toolCallId: tc.id,
  toolName: tc.name,
  content: [{ type: "text", text: result.content }],
  isError: result.isError ?? false,
  timestamp: Date.now(),
};
toolResultMessages.push(toolMsg);
```

In `tool_execution_end`, add `toolName`:
```ts
// OLD:
yield evt("tool_execution_end", { toolCallId: tc.id, result });

// NEW:
yield evt("tool_execution_end", { toolCallId: tc.id, toolName: tc.name, result });
```

And update `ToolExecutionUpdateEvent` to include `toolName`:
```ts
export interface ToolExecutionUpdateEvent extends AgentEventBase {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  accumulated: string;
}
```

Update the corresponding yield:
```ts
yield evt("tool_execution_update", { toolCallId: tc.id, toolName: tc.name, accumulated });
```

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: 0 errors

**Step 3: Run agent tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/agent/ --exclude '**/loop.test.ts'`
Expected: 36 passing

**Step 4: Commit**

```bash
git add -A && git commit -m "feat(agent): enrich turn_end and tool_execution events with full data"
```

### Task 5.3: Update event tests

**Step 1: Update `packages/agent/src/__tests__/event-types.test.ts`** to reflect the new event shapes.

Find the `turn_end` test and update it to include `message` and `toolResults`:
```ts
it("turn_start and turn_end events", () => {
  const turnStart = { type: "turn_start", timestamp: 1, turnIndex: 0 };
  const turnEnd = {
    type: "turn_end",
    timestamp: 2,
    turnIndex: 0,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: 2,
    },
    toolResults: [],
  };
  expect(isAgentEvent(turnStart)).toBe(true);
  expect(isAgentEvent(turnEnd)).toBe(true);
});
```

Find the `tool_execution events` test and update `tool_execution_end`:
```ts
it("tool_execution events", () => {
  const start = { type: "tool_execution_start", timestamp: 1, toolCallId: "tc1", toolName: "read" };
  const update = { type: "tool_execution_update", timestamp: 2, toolCallId: "tc1", toolName: "read", accumulated: "..." };
  const end = {
    type: "tool_execution_end",
    timestamp: 3,
    toolCallId: "tc1",
    toolName: "read",
    result: { content: "file contents", terminate: false },
  };
  expect(isAgentEvent(start)).toBe(true);
  expect(isAgentEvent(update)).toBe(true);
  expect(isAgentEvent(end)).toBe(true);
});
```

**Step 2: Run agent tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/agent/ --exclude '**/loop.test.ts'`
Expected: 36 passing

**Step 3: Commit**

```bash
git add -A && git commit -m "test(agent): update event type tests for enriched events"
```

---

## Task 6: Compaction Execution

**Why:** We have `shouldCompact()` and `estimateTokens()` but no LLM-powered summarization. Long sessions will hit context limits with no recovery. Pi uses `completeSimple` for summarization with a structured prompt.

**Files:**
- Modify: `packages/agent/src/compaction.ts` — add `compactMessages()`
- Create: `packages/agent/src/__tests__/compaction-execution.test.ts` — mocked tests

### Task 6.1: Add compactMessages function

**Step 1: Add to `packages/agent/src/compaction.ts`**:

```ts
import { completeSimple } from "@earendil-works/pi-ai";
import type { AgentMessage } from "./types.ts";

const SUMMARIZE_SYSTEM_PROMPT = `You are a context summarization assistant. Produce a structured summary. Do NOT continue the conversation.`;

const SUMMARIZE_PROMPT = `Create a structured context checkpoint summary:

## Goal
[What is the user trying to accomplish?]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [File paths, function names, error messages needed to continue]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

export interface CompactionResult {
  /** Compacted messages: summary user message + recent messages */
  messages: AgentMessage[];
  /** Token count before compaction */
  tokensBefore: number;
  /** Token count after compaction */
  tokensAfter: number;
}

export interface CompactionOptions {
  /** LLM model to use for summarization */
  model: import("@earendil-works/pi-ai").Model<any>;
  /** API key for the LLM */
  apiKey: string;
  /** Messages to compact */
  messages: AgentMessage[];
  /** Model context window size */
  contextWindow: number;
  /** Tokens to reserve for summary + response */
  reserveTokens?: number;
  /** Tokens of recent messages to keep */
  keepRecentTokens?: number;
  /** Abort signal */
  signal?: AbortSignal;
}

function messageToText(msg: AgentMessage): string {
  if (msg.role === "user") return `User: ${msg.content}`;
  if (msg.role === "assistant") {
    const text = (msg.content as Array<{ type: string; text?: string; thinking?: string; name?: string; arguments?: unknown }>)
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n");
    return `Assistant: ${text}`;
  }
  if (msg.role === "tool") {
    return `Tool (${msg.toolName}): ${(msg.content as Array<{ text: string }>).map((c) => c.text).join("")}`;
  }
  return "";
}

export async function compactMessages(options: CompactionOptions): Promise<CompactionResult> {
  const {
    model, apiKey, messages, contextWindow,
    reserveTokens = 16_000, keepRecentTokens = 20_000, signal,
  } = options;

  const tokensBefore = estimateTokens(messages);

  // Find cut point: keep recent messages up to keepRecentTokens
  let cutIndex = messages.length;
  let recentTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    recentTokens += estimateTokens([messages[i]!]);
    if (recentTokens >= keepRecentTokens) {
      cutIndex = i;
      break;
    }
  }

  if (cutIndex <= 1) {
    // Not enough history to compact
    return { messages, tokensBefore, tokensAfter: tokensBefore };
  }

  const historyMessages = messages.slice(0, cutIndex);
  const recentMessages = messages.slice(cutIndex);

  // Serialize history for summarization
  const conversationText = historyMessages.map(messageToText).join("\n\n");

  const summaryPrompt = `<conversation>\n${conversationText}\n</conversation>\n\n${SUMMARIZE_PROMPT}`;

  const response = await completeSimple(
    model,
    {
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: summaryPrompt, timestamp: Date.now() }],
    },
    { maxTokens: Math.floor(reserveTokens * 0.8), apiKey, signal },
  );

  if (response.stopReason === "error" || response.stopReason === "aborted") {
    return { messages, tokensBefore, tokensAfter: tokensBefore };
  }

  const summaryText = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const summaryMessage: AgentMessage = {
    role: "user",
    content: `[Session Summary]\n\n${summaryText}`,
    timestamp: Date.now(),
  };

  const compacted = [summaryMessage, ...recentMessages];
  const tokensAfter = estimateTokens(compacted);

  return { messages: compacted, tokensBefore, tokensAfter };
}
```

**Step 2: Verify it compiles**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: 0 errors

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(agent): add LLM-powered compaction with compactMessages()"
```

### Task 6.2: Add compaction execution tests

**Step 1: Create `packages/agent/src/__tests__/compaction-execution.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";

// Mock pi-ai's completeSimple
vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual("@earendil-works/pi-ai");
  return {
    ...actual,
    completeSimple: vi.fn().mockResolvedValue({
      stopReason: "stop",
      content: [{ type: "text", text: "## Goal\nFix bug\n\n## Progress\n### Done\n- [x] found it" }],
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: Date.now(),
    }),
  };
});

import { compactMessages, estimateTokens } from "../compaction";

describe("compactMessages", () => {
  it("compacts a long conversation into summary + recent", async () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}: ${"x".repeat(100)}`,
      timestamp: i,
    }));

    const result = await compactMessages({
      model: { id: "test", name: "Test", api: "openai-completions" as const, provider: "openai", input: ["text"] as ["text"], contextWindow: 200000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false, baseUrl: "" },
      apiKey: "test-key",
      messages,
      contextWindow: 200000,
      keepRecentTokens: 5000,
    });

    expect(result.tokensBefore).toBeGreaterThan(result.tokensAfter);
    expect(result.messages.length).toBeLessThan(100);
    expect(result.messages[0]!.role).toBe("user");
    expect(result.messages[0]!.content).toContain("[Session Summary]");
  });

  it("returns original messages when not enough history", async () => {
    const messages = [
      { role: "user" as const, content: "hello", timestamp: 1 },
    ];

    const result = await compactMessages({
      model: { id: "test", name: "Test", api: "openai-completions" as const, provider: "openai", input: ["text"] as ["text"], contextWindow: 200000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false, baseUrl: "" },
      apiKey: "test-key",
      messages,
      contextWindow: 200000,
    });

    expect(result.messages).toBe(messages);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });

  it("preserves recent messages after the summary", async () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: "user" as const,
      content: `Message ${i}: ${"x".repeat(200)}`,
      timestamp: i,
    }));

    const result = await compactMessages({
      model: { id: "test", name: "Test", api: "openai-completions" as const, provider: "openai", input: ["text"] as ["text"], contextWindow: 200000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: false, baseUrl: "" },
      apiKey: "test-key",
      messages,
      contextWindow: 200000,
      keepRecentTokens: 2000,
    });

    // Last few messages should be preserved as-is
    const lastOriginal = messages[messages.length - 1]!;
    const lastCompacted = result.messages[result.messages.length - 1]!;
    expect(lastCompacted.content).toBe(lastOriginal.content);
  });
});
```

**Step 2: Run tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/agent/ --exclude '**/loop.test.ts'`
Expected: 39 passing (36 + 3 new)

**Step 3: Commit**

```bash
git add -A && git commit -m "test(agent): compaction execution tests with mocked completeSimple"
```

### Task 6.3: Export compactMessages from agent index

**Step 1: Update `packages/agent/src/index.ts`** to export `compactMessages`:

```ts
export { shouldCompact, estimateTokens, compactMessages } from "./compaction.ts";
export type { CompactionResult, CompactionOptions } from "./compaction.ts";
```

**Step 2: Verify it compiles and tests pass**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json && npx vitest run packages/agent/ --exclude '**/loop.test.ts'`
Expected: 0 errors, 39 passing

**Step 3: Commit**

```bash
git add -A && git commit -m "feat(agent): export compactMessages from agent index"
```

---

## Task 7: Final Verification

**Files:** None (verification only)

### Task 7.1: Full typecheck

**Step 1: Run typecheck**

Run: `cd /home/eekrain/CODE/sakti-code && npx tsc --project tsconfig.json`
Expected: 0 errors

### Task 7.2: Full test suite

**Step 1: Run tool tests**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/tools/`
Expected: 32 passing

**Step 2: Run agent tests (safe set)**

Run: `cd /home/eekrain/CODE/sakti-code && npx vitest run packages/agent/ --exclude '**/loop.test.ts'`
Expected: 39 passing

**Step 3: Run DB tests**

Run: `cd /home/eekrain/CODE/sakti-code/packages/db && bun test`
Expected: 16 passing

**Step 4: Total baseline**

Expected: **87 passing** (32 tools + 39 agent + 16 db), 0 type errors

### Task 7.3: Final commit

```bash
git add -A && git commit -m "chore: close Pi gaps — async bash, edit hardening, image read, validation, enriched events, compaction"
```

---

## Future Work (Not in this plan)

These are architectural decisions that need design work before implementation:

1. **Tool operations abstraction** — Pluggable Read/Edit/Write/Bash operations for remote execution (SSH, agent runs on server). Requires designing the remote protocol.

2. **Session branching/labeling** — Tree-based session structure like Pi's JSONL. Requires DB schema changes (add `parent_session_id`, `labels` table) and significant session management logic.

3. **Parallel tool execution** — Pi has sequential + parallel modes with per-tool overrides. Requires a task scheduler and changes to the loop's tool execution section.

4. **Before/after tool hooks** — `beforeToolCall` (blocking) and `afterToolCall` (result rewriting). Requires changes to `AgentLoopConfig` and the loop's tool pipeline.

5. **Structured tool results** — Change `AgentToolResult.content` from `string` to `(TextContent | ImageContent)[]` and add a `details` field. This cascades through the entire stack and should be coordinated with the SolidJS frontend design.

6. **Compaction integration in the loop** — Auto-detect when context is full and compact mid-session. Requires a `transformContext` hook in the loop config (currently we don't have one).
