# grep & glob (find) tool rebuild on ripgrep — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the fragile `fd` dependency (confirmed root cause of "glob always fails"), kill grep output garbling, and standardize both agent search tools on a bundled `ripgrep` — with smart-case defaults and two validated repair-layer behaviors (fragment dispatch + whole-project gitignore retry).

**Architecture:** Both `packages/tools` tools keep their pure-package boundary and DI seams (`GrepOperations`/`FindOperations`). The default engine for both becomes `rg` (invoked via `runProcess`). `runProcess` learns to reject on a missing binary (ENOENT) instead of resolving an ambiguous `exitCode:1`. The desktop/server bundles `@vscode/ripgrep` and injects the absolute binary path via the existing `rgPath` option. grep parses `rg --json` `match` **and** `context` records in a single pass (no separate `readFile` — the garbling source).

**Tech Stack:** TypeScript, TypeBox (`@sinclair/typebox`), vitest via `vite-plus/test`, ripgrep (`rg`), `@vscode/ripgrep` (bundled binary), pnpm workspace, `vp` tooling.

**Verified facts (do not re-litigate):**

- `fd` is not bundled/declared/provided anywhere → every find call throws "fd exited with code 1" on machines without `fd`. Reproduced.
- `rg` is currently **also** unbundled (PATH lookup) → same latent class of failure; this plan bundles it.
- `rg --files <explicit-gitignored-dir>` already lists files there (42 == 42 with/without `--no-ignore`) → so `--no-ignore` retry is only useful for **whole-project** zero-result searches, never for explicit-path ones.
- `rg --max-columns` is **ignored under `--json`** (verified: 2012-char line passed through full) → truncation MUST be tool-side.
- `--smart-case` composes with `--fixed-strings` (verified) → case-insensitive for all-lowercase patterns, sensitive otherwise.
- TypeBox `Type.Object` defaults to `additionalProperties: true` → dropping `ignoreCase` from the schema is replay-safe (old recorded calls passing it are ignored, not rejected).
- `runProcess` is used **only** by grep + find (`packages/tools/src/lib/spawn.ts`); the bash tool spawns independently.

**Conventions (from AGENTS.md):**

- TDD: failing test first (RED) → minimal code (GREEN) → refactor.
- Tests colocated in `__tests__/` next to source, using `vite-plus/test`.
- `exactOptionalPropertyTypes: true` → conditional spread `...(x !== undefined ? { x } : {})`, never pass `undefined`.
- Commands: `vp run '@sakti-code/tools#test'` (single pkg), `vp check` (lint+typecheck), `vp run -r test` (all). Quote package targets (zsh).

---

## Task 1: `runProcess` rejects on missing binary (ENOENT)

**Why first:** both tools depend on `runProcess`; fixing it here means grep/find automatically surface a clear error when `rg` is absent instead of the misleading "exit code 1".

**Files:**

- Modify: `packages/tools/src/lib/spawn.ts`
- Create test: `packages/tools/src/lib/__tests__/spawn.test.ts`

### Step 1: Write the failing test

Create `packages/tools/src/lib/__tests__/spawn.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { runProcess } from "../spawn.ts";

describe("runProcess", () => {
  it("rejects with a clear engine error when the binary is missing (ENOENT)", async () => {
    const promise = runProcess("/nonexistent/path/rg", ["--version"], { cwd: "." });
    await expect(promise).rejects.toThrow(/Engine binary not found|ENOENT/);
  });

  it("still resolves {exitCode, stdout, stderr} for a normal exit", async () => {
    const result = await runProcess(process.execPath, ["--version"], { cwd: "." });
    expect(typeof result.exitCode).toBe("number");
    expect(typeof result.stdout).toBe("string");
  });
});
```

### Step 2: Run — verify RED

```
vp run '@sakti-code/tools#test'
```

Expected: FAIL — the ENOENT case currently resolves `{exitCode:1,...}` (the test expects a rejection), and/or the second test's shape differs. Confirm the failure is "did not reject" / wrong contract, not a typo.

### Step 3: Minimal implementation

In `packages/tools/src/lib/spawn.ts`, change the `'error'` handler to reject. Full new file:

```ts
import { spawn } from "node:child_process";

export interface RunProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export class EngineBinaryError extends Error {
  readonly code = "ENGINE_BINARY_NOT_FOUND" as const;
  constructor(command: string, cause: NodeJS.ErrnoException) {
    super(`Engine binary not found: "${command}" (${cause.code ?? "unknown"})`);
    this.name = "EngineBinaryError";
  }
}

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
      // Missing binary (ENOENT) and other spawn-time failures must surface as a
      // clear rejection — resolving {exitCode:1} here caused the "fd exited with
      // code 1" misleading error that hid the missing-binary root cause.
      reject(new EngineBinaryError(command, err));
    });
    proc.on("close", (code) => finalize(code ?? 0));
  });
}
```

### Step 4: Run — verify GREEN

```
vp run '@sakti-code/tools#test'
```

Expected: both tests PASS.

### Step 5: Commit

```bash
git add packages/tools/src/lib/spawn.ts packages/tools/src/lib/__tests__/spawn.test.ts
git commit -m "fix(tools): runProcess rejects on missing engine binary (ENOENT)"
```

---

## Task 2: Rebuild `find` on `rg --files` + fragment dispatch + whole-project retry

**Why:** this is the direct fix for "glob always fails." Replaces the absent `fd` with guaranteed-present `rg`, and adds the two validated repair-layer behaviors.

**Files:**

- Modify: `packages/tools/src/find/index.ts`
- Create test: `packages/tools/src/find/__tests__/find.test.ts`

> Note: keep the existing `FindOperations` DI seam (`exists`, `glob`) and the `customOps?.glob` branch for tests that inject a fake. Only the **default (production) branch** changes from `fd` to `rg`. Replace the `fdPath` option with `rgPath`.

### Step 2a — Write failing tests for the pure helpers first

Create `packages/tools/src/find/__tests__/find.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { resolveGlobPattern, isWholeProjectSearch } from "../index.ts";

describe("find: fragment dispatch (resolveGlobPattern)", () => {
  it("leaves a real glob pattern unchanged", () => {
    expect(resolveGlobPattern("**/*.ts")).toBe("**/*.ts");
    expect(resolveGlobPattern("src/**/*.spec.ts")).toBe("src/**/*.spec.ts");
    expect(resolveGlobPattern("*.{ts,tsx}")).toBe("*.{ts,tsx}");
  });

  it("upgrades a bare name fragment into a substring glob", () => {
    expect(resolveGlobPattern("Button")).toBe("**/*Button*");
    expect(resolveGlobPattern("AuthService")).toBe("**/*AuthService*");
  });
});

describe("find: whole-project detection (isWholeProjectSearch)", () => {
  it("treats '.', './', and undefined as whole-project (resolved absolutely)", () => {
    const root = "/proj";
    expect(isWholeProjectSearch(root, undefined)).toBe(true);
    expect(isWholeProjectSearch(root, ".")).toBe(true);
    expect(isWholeProjectSearch(root, "./")).toBe(true);
  });

  it("treats an explicit subdirectory as NOT whole-project", () => {
    expect(isWholeProjectSearch("/proj", "src/components")).toBe(false);
  });
});
```

### Step 2b — Run — verify RED

```
vp run '@sakti-code/tools#test'
```

Expected: FAIL — `resolveGlobPattern` / `isWholeProjectSearch` are not exported (they don't exist yet).

### Step 2c — Implement the helpers + rg-backed default branch

Rewrite `packages/tools/src/find/index.ts`. Keep the schema, `FindOperations`, `FindToolDetails`, `toPosixPath`. Replace the `fd` block. Export the two pure helpers for testing. Full new file:

```ts
import nodePath from "node:path";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { pathExists, resolveToCwd } from "../lib/path-utils.ts";
import { runProcess } from "../lib/spawn.ts";
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "../lib/truncate.ts";

function toPosixPath(value: string): string {
  return value.split(nodePath.sep).join("/");
}

const findSchema = Type.Object({
  pattern: Type.String({
    description:
      "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'. A bare name fragment like 'Button' is also accepted and matched as a substring across the whole path.",
  }),
  path: Type.Optional(
    Type.String({ description: "Directory to search in (default: current directory)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

export type FindToolInput = Static<typeof findSchema>;
const DEFAULT_LIMIT = 1000;

export interface FindToolDetails {
  resultLimitReached?: number;
  truncation?: TruncationResult;
}

export interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  glob: (
    pattern: string,
    cwd: string,
    options: { ignore: string[]; limit: number },
  ) => Promise<string[]> | string[];
}

const defaultFindOperations: FindOperations = {
  exists: pathExists,
  glob: () => [],
};

export interface FindToolOptions {
  rgPath?: string;
  operations?: FindOperations;
}

/** True if the pattern has glob metacharacters; otherwise it's a name fragment. */
const GLOB_CHARS = /[*?[\]{}]/;

/** Dispatch: real globs pass through; bare fragments become substring globs. */
export function resolveGlobPattern(inputPattern: string): string {
  if (GLOB_CHARS.test(inputPattern)) {
    return inputPattern;
  }
  return `**/*${inputPattern}*`;
}

/** Whole-project iff the resolved search path equals the resolved project root. */
export function isWholeProjectSearch(projectRoot: string, pathArg: string | undefined): boolean {
  const rootAbs = nodePath.resolve(projectRoot);
  const searchAbs = nodePath.resolve(rootAbs, pathArg ?? ".");
  return searchAbs === rootAbs;
}

export function createFindTool(
  cwd: string,
  options?: FindToolOptions,
): AgentTool<typeof findSchema, FindToolDetails | undefined> {
  const customOps = options?.operations;
  return {
    name: "find",
    label: "find",
    description: `Search for files by glob pattern (or a bare name fragment). Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: findSchema,
    permissions: (params) => [
      { permission: "glob", patterns: [(params as FindToolInput).pattern] },
    ],
    async execute(
      _toolCallId: string,
      { pattern, path: searchDir, limit }: FindToolInput,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<FindToolDetails | undefined>,
    ) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const searchPath = resolveToCwd(searchDir || ".", cwd);
      const effectiveLimit = limit ?? DEFAULT_LIMIT;
      const ops = customOps ?? defaultFindOperations;

      if (customOps?.glob) {
        // DI branch (tests inject a fake)
        if (!(await ops.exists(searchPath))) {
          throw new Error(`Path not found: ${searchPath}`);
        }
        if (signal?.aborted) {
          throw new Error("Operation aborted");
        }
        const results = await ops.glob(pattern, searchPath, {
          ignore: ["**/node_modules/**", "**/.git/**"],
          limit: effectiveLimit,
        });
        if (signal?.aborted) {
          throw new Error("Operation aborted");
        }
        return formatFindResults(results, searchPath, effectiveLimit, results.length === 0);
      }

      // Production branch: rg --files (replaces the absent fd binary).
      const rgPath = options?.rgPath ?? "rg";
      const effectivePattern = resolveGlobPattern(pattern);
      const baseArgs = [
        "--no-config",
        "--files",
        "--hidden",
        `--glob=${effectivePattern}`,
        "--glob=!**/.git/**",
      ];

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const runList = (extra: string[]): Promise<string[]> =>
        runProcess(rgPath, [...baseArgs, ...extra, searchPath], signal ? { signal } : {}).then(
          ({ stdout }) => stdout.split("\n").filter((l) => l.length > 0),
        );

      let files = await runList([]);
      let retriedNoIgnore = false;

      // Repair-layer: whole-project search returned nothing → maybe the matches
      // live in a gitignored tree (e.g. vendored references). rg --files already
      // honors an explicit gitignored PATH argument, so this retry only helps
      // the whole-project case (verified: 42==42 with/without --no-ignore for
      // an explicit gitignored dir).
      if (files.length === 0 && isWholeProjectSearch(cwd, searchDir)) {
        const retry = await runList(["--no-ignore"]);
        if (retry.length > 0) {
          files = retry;
          retriedNoIgnore = true;
        }
      }

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      return formatFindResults(
        files,
        searchPath,
        effectiveLimit,
        files.length === 0,
        retriedNoIgnore,
      );
    },
  };
}

/** Relativize + truncate + notices. Shared by both branches. */
function formatFindResults(
  results: string[],
  searchPath: string,
  effectiveLimit: number,
  empty: boolean,
  retriedNoIgnore = false,
): { content: [{ type: "text"; text: string }]; details: FindToolDetails | undefined } {
  if (empty) {
    return {
      content: [{ type: "text", text: "No files found matching pattern" }],
      details: undefined,
    };
  }
  const relativized = results.map((p) => {
    if (p.startsWith(searchPath)) {
      return toPosixPath(p.slice(searchPath.length + 1));
    }
    return toPosixPath(nodePath.relative(searchPath, p));
  });
  const resultLimitReached = relativized.length >= effectiveLimit;
  const rawOutput = relativized.join("\n");
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
  let resultOutput = truncation.content;
  const details: FindToolDetails = {};
  const notices: string[] = [];
  if (resultLimitReached) {
    notices.push(
      `${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
    );
    details.resultLimitReached = effectiveLimit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
    details.truncation = truncation;
  }
  if (notices.length > 0) {
    resultOutput += `\n\n[${notices.join(". ")}]`;
  }
  return {
    content: [{ type: "text", text: resultOutput }],
    details: Object.keys(details).length > 0 ? details : undefined,
  };
}
```

### Step 2d — Run — verify GREEN for helpers

```
vp run '@sakti-code/tools#test'
```

Expected: the `resolveGlobPattern` / `isWholeProjectSearch` tests PASS.

### Step 2e — Add an integration test pinning the rg argv (anti-hallucination guard)

Append to `packages/tools/src/find/__tests__/find.test.ts`:

```ts
import { createFindTool } from "../index.ts";
import { execFileSync } from "node:child_process";

describe("find: rg argv validity", () => {
  // Guards against hallucinated rg flags (e.g. the earlier --binary-rules mistake).
  it("uses only flags the real rg binary accepts for the --files invocation", () => {
    const flags = [
      "--no-config",
      "--files",
      "--hidden",
      "--glob=*.ts",
      "--glob=!**/.git/**",
      "--no-ignore",
    ];
    expect(() => {
      execFileSync(options().rgPath ?? "rg", [...flags, "."], { stdio: "ignore" });
    }).not.toThrow();
  });
});

// helper kept tiny and local
function options() {
  return { rgPath: undefined as string | undefined };
}
```

> If `rg` is not on PATH in the dev shell, this test is the one that flags it — exactly the failure mode we're closing. (On CI/dev it should pass since developers run `nix develop` or have rg.)

### Step 2f — Run + typecheck

```
vp run '@sakti-code/tools#test'
vp check
```

Expected: all green; typecheck clean (the old `fdPath` references are gone).

### Step 2g — Commit

```bash
git add packages/tools/src/find/index.ts packages/tools/src/find/__tests__/find.test.ts
git commit -m "fix(tools): rebuild find on rg --files, add fragment dispatch and whole-project gitignore retry"
```

---

## Task 3: Rebuild `grep` with single-pass `--context` parsing, smart-case, drop `ignoreCase`

**Why:** the separate `readFile` for context lines is the garbling source (desync + CRLF). Parsing `rg`'s own `context` JSON records in-stream eliminates it. Smart-case improves recall. `--no-config` prevents user rg config from polluting results.

**Files:**

- Modify: `packages/tools/src/grep/index.ts`
- Create test: `packages/tools/src/grep/__tests__/grep.test.ts`

### Step 3a — Write failing tests (parser + garbling regression)

Create `packages/tools/src/grep/__tests__/grep.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { formatRgJsonStream } from "../index.ts";

describe("grep: single-pass JSON formatting", () => {
  it("emits path:line:text for matches and path-line-text for context", () => {
    const stream = [
      JSON.stringify({
        type: "match",
        data: {
          path: { text: "/p/src/a.ts" },
          line_number: 2,
          lines: { text: "export const X = 1;\n" },
        },
      }),
      JSON.stringify({
        type: "context",
        data: { path: { text: "/p/src/a.ts" }, line_number: 3, lines: { text: "const Y = 2;\n" } },
      }),
    ].join("\n");
    const out = formatRgJsonStream(stream, "/p");
    expect(out).toContain("src/a.ts:2: export const X = 1;");
    expect(out).toContain("src/a.ts-3- const Y = 2;");
  });

  it("garbling regression: CRLF in a context line is normalized, no \\r leaks", () => {
    const stream = JSON.stringify({
      type: "context",
      data: {
        path: { text: "/p/a.ts" },
        line_number: 5,
        lines: { text: "import { z } from 'z';\r\n" },
      },
    });
    const out = formatRgJsonStream(stream, "/p");
    expect(out).not.toContain("\r");
    expect(out.endsWith("import { z } from 'z';")).toBe(true);
  });

  it("long-line defense: a >maxChars match line is truncated (rg --max-columns is ignored under --json)", () => {
    const long = "a".repeat(2000);
    const stream = JSON.stringify({
      type: "match",
      data: { path: { text: "/p/a.ts" }, line_number: 1, lines: { text: long + "\n" } },
    });
    const out = formatRgJsonStream(stream, "/p");
    expect(out).toContain("[truncated]");
    expect(out.length).toBeLessThan(1200);
  });

  it("ignores begin/end/summary records", () => {
    const stream = [
      JSON.stringify({ type: "begin", data: { path: { text: "/p/a.ts" } } }),
      JSON.stringify({
        type: "match",
        data: { path: { text: "/p/a.ts" }, line_number: 1, lines: { text: "x\n" } },
      }),
      JSON.stringify({ type: "end", data: {} }),
    ].join("\n");
    const out = formatRgJsonStream(stream, "/p");
    expect(out).toContain("a.ts:1: x");
    expect(out).not.toContain("begin");
  });
});
```

### Step 3b — Run — verify RED

```
vp run '@sakti-code/tools#test'
```

Expected: FAIL — `formatRgJsonStream` is not exported.

### Step 3c — Implement the parser + rewrite execute

Rewrite `packages/tools/src/grep/index.ts`. Drop `ignoreCase` from the schema and from `execute`. Reuse `truncateLine` from `lib/truncate.ts`. Export `formatRgJsonStream` for tests. The `GrepOperations` DI seam (isDirectory/readFile) becomes unused once context comes from rg — **remove it** (YAGNI; the separate read was the bug). Full new file:

```ts
import nodePath from "node:path";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { resolveToCwd } from "../lib/path-utils.ts";
import { runProcess } from "../lib/spawn.ts";
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  GREP_MAX_LINE_LENGTH,
  type TruncationResult,
  truncateHead,
  truncateLine,
} from "../lib/truncate.ts";

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex by default)" }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  glob: Type.Optional(
    Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      description: "Treat pattern as a literal string instead of regex (default: false)",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      description: "Number of lines to show before and after each match (default: 0)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of matches to return (default: 100)" }),
  ),
});

export type GrepToolInput = Static<typeof grepSchema>;
const DEFAULT_LIMIT = 100;

export interface GrepToolDetails {
  linesTruncated?: boolean;
  matchLimitReached?: number;
  truncation?: TruncationResult;
}

export interface GrepToolOptions {
  rgPath?: string;
}

interface RgRecord {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
}

/**
 * Parse a `rg --json` stdout stream into the standard `path:line: text`
 * (match) / `path-line- text` (context) text format, in a single pass.
 * Context comes from rg's own records — NO separate file read (the previous
 * read was the source of garbled/misaligned context via CRLF/desync/race).
 * Tool-side truncation is mandatory: `--max-columns` is ignored under `--json`.
 */
export function formatRgJsonStream(
  stdout: string,
  projectRoot: string,
  options: { matchLimit?: number; maxLineChars?: number } = {},
): { output: string; matchCount: number; linesTruncated: boolean; limitReached: boolean } {
  const matchLimit = options.matchLimit ?? DEFAULT_LIMIT;
  const maxLineChars = options.maxLineChars ?? GREP_MAX_LINE_LENGTH;
  const out: string[] = [];
  let matchCount = 0;
  let linesTruncated = false;

  for (const line of stdout.split("\n")) {
    if (!line) continue;
    let event: RgRecord;
    try {
      event = JSON.parse(line) as RgRecord;
    } catch {
      continue;
    }
    if (event.type !== "match" && event.type !== "context") continue;

    if (event.type === "match") {
      matchCount++;
      if (matchCount > matchLimit) break;
    }

    const data = event.data ?? {};
    const rawPath = data.path?.text ?? "";
    const relativePath = relativize(rawPath, projectRoot);
    const lineNumber = data.line_number;
    if (relativePath === "" || typeof lineNumber !== "number") continue;

    let text = (data.lines?.text ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "")
      .replace(/\n$/, "");
    const truncated = truncateLine(text, maxLineChars);
    if (truncated.wasTruncated) {
      text = truncated.text;
      linesTruncated = true;
    }
    const sep = event.type === "match" ? ":" : "-";
    out.push(`${relativePath}${sep}${lineNumber}: ${text}`);
  }

  const limitReached = matchCount > matchLimit;
  return {
    output: out.join("\n"),
    matchCount: Math.min(matchCount, matchLimit),
    linesTruncated,
    limitReached,
  };
}

function relativize(rawPath: string, projectRoot: string): string {
  // rg emits absolute paths when invoked with an absolute search path.
  let rel = rawPath;
  if (nodePath.isAbsolute(rel)) {
    rel = nodePath.relative(projectRoot, rel);
  }
  return rel.replace(/\\/g, "/");
}

export function createGrepTool(
  cwd: string,
  options?: GrepToolOptions,
): AgentTool<typeof grepSchema, GrepToolDetails | undefined> {
  return {
    name: "grep",
    label: "grep",
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars. Smart-case is on: case-insensitive for all-lowercase patterns, sensitive otherwise.`,
    parameters: grepSchema,
    permissions: (params) => [
      { permission: "grep", patterns: [(params as GrepToolInput).pattern] },
    ],
    async execute(
      _toolCallId: string,
      { pattern, path: searchDir, glob, literal, context, limit }: GrepToolInput,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<GrepToolDetails | undefined>,
    ) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const rgPath = options?.rgPath ?? "rg";
      const searchPath = resolveToCwd(searchDir || ".", cwd); // absolute → rg emits absolute paths
      const contextValue = context && context > 0 ? context : 0;
      const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

      const args: string[] = [
        "--no-config",
        "--json",
        "--smart-case",
        "--hidden",
        "--glob=!**/.git/**",
      ];
      if (literal) {
        args.push("--fixed-strings");
      }
      if (contextValue > 0) {
        args.push(`--context=${contextValue}`);
      }
      if (glob) {
        args.push("--glob", glob);
      }
      args.push("--", pattern, searchPath);

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const { exitCode, stderr, stdout } = await runProcess(rgPath, args, signal ? { signal } : {});
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      if (exitCode !== 0 && exitCode !== 1) {
        throw new Error(stderr.trim() || `ripgrep exited with code ${exitCode}`);
      }

      const { output, linesTruncated, limitReached } = formatRgJsonStream(stdout, cwd, {
        matchLimit: effectiveLimit,
      });

      if (output.length === 0) {
        return { content: [{ type: "text", text: "No matches found" }], details: undefined };
      }

      const truncation = truncateHead(output, { maxLines: Number.MAX_SAFE_INTEGER });
      let resultOutput = truncation.content;
      const details: GrepToolDetails = {};
      const notices: string[] = [];
      if (limitReached) {
        notices.push(
          `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
        );
        details.matchLimitReached = effectiveLimit;
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
        details.truncation = truncation;
      }
      if (linesTruncated) {
        notices.push(
          `Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
        );
        details.linesTruncated = true;
      }
      if (notices.length > 0) {
        resultOutput += `\n\n[${notices.join(". ")}]`;
      }
      return {
        content: [{ type: "text", text: resultOutput }],
        details: Object.keys(details).length > 0 ? details : undefined,
      };
    },
  };
}
```

> **Removing `GrepOperations`**: the old `isDirectory`/`readFile` seam existed only to support the separate-read context path — which is the bug we're removing. Any existing test that injected `GrepOperations` must be updated (there are none today — grep has no tests). Search `packages/tools/src/__tests__` and `apps/server` for `GrepOperations` references and update/remove.

### Step 3d — Run — verify GREEN

```
vp run '@sakti-code/tools#test'
vp check
```

Expected: parser tests PASS, including the CRLF garbling regression and long-line truncation. Typecheck clean.

### Step 3e — Add an rg-argv validity test (anti-hallucination guard)

Append to `packages/tools/src/grep/__tests__/grep.test.ts`:

```ts
import { execFileSync } from "node:child_process";

describe("grep: rg argv validity", () => {
  it("uses only flags the real rg binary accepts for the grep invocation", () => {
    const flags = [
      "--no-config",
      "--json",
      "--smart-case",
      "--hidden",
      "--glob=!**/.git/**",
      "--fixed-strings",
      "--context=2",
    ];
    expect(() => {
      execFileSync("rg", [...flags, "--", "x", "."], { stdio: "ignore" });
    }).not.toThrow();
  });
});
```

Run: `vp run '@sakti-code/tools#test'` → PASS.

### Step 3f — Commit

```bash
git add packages/tools/src/grep/index.ts packages/tools/src/grep/__tests__/grep.test.ts
git commit -m "fix(tools): single-pass rg --context parsing kills grep garbling; add smart-case; drop ignoreCase"
```

---

## Task 4: Bundle `@vscode/ripgrep` and inject the binary path

**Why:** without this, both tools still rely on PATH lookup for `rg` — the same latent failure class as `fd`. Bundling makes the engine guaranteed-present.

**Files:**

- Modify: `apps/server/package.json` (add dep)
- Modify: `apps/server/src/agent/config/tool-registry.ts` (wire rgPath)
- Create/modify test: `apps/server/src/agent/config/__tests__/tool-registry.test.ts` (verify rgPath passed)

### Step 4a — Add the dependency

```bash
vp install @vscode/ripgrep --filter @sakti-code/server
```

(If `vp install` syntax differs, use `pnpm add @vscode/ripgrep --filter @sakti-code/server`.) Confirm the entry appears in `apps/server/package.json` `dependencies`.

### Step 4b — Write failing test for the wiring

Create `apps/server/src/agent/config/__tests__/tool-registry.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { rgBinPath } from "../tool-registry.ts";

describe("tool-registry rg path", () => {
  it("resolves to an absolute bundled rg binary path", () => {
    const p = rgBinPath();
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
    // @vscode/ripgarp exposes rgPath as absolute; ensure it's not just "rg"
    expect(p).not.toBe("rg");
  });
});
```

### Step 4c — Run — verify RED

```
vp run '@sakti-code/server#test'
```

Expected: FAIL — `rgBinPath` not exported.

### Step 4d — Wire it in `tool-registry.ts`

In `apps/server/src/agent/config/tool-registry.ts`:

- Add import: `import { rgPath } from "@vscode/ripgrep";`
- Export a helper:
  ```ts
  /** Absolute path to the bundled ripgrep binary. Injected into both search tools. */
  export const rgBinPath = (): string => rgPath;
  ```
- Update the factories:
  ```ts
  grep: (ctx) => createGrepTool(ctx.cwd, { rgPath: rgBinPath() }) as AgentTool,
  find: (ctx) => createFindTool(ctx.cwd, { rgPath: rgBinPath() }) as AgentTool,
  ```

### Step 4e — Run — verify GREEN + typecheck

```
vp run '@sakti-code/server#test'
vp check
```

Expected: PASS. `@vscode/ripgrep`'s `rgPath` is a string absolute path at runtime.

> **Desktop packaging:** `@vscode/ripgrep` ships platform binaries as optionalDependencies. Confirm `apps/desktop/electron-builder.yml` unpacks them so they survive asar. Add to `asarUnpack`:
>
> ```yaml
> asarUnpack:
>   - "**/node-pty/**"
>   - "**/*.node"
>   - "**/@vscode/ripgrep/bin/**"
> ```
>
> Verify by running the packaged app (`vp run desktop#package`) and triggering a grep.

### Step 4f — Commit

```bash
git add apps/server/package.json apps/server/src/agent/config/tool-registry.ts apps/server/src/agent/config/__tests__/tool-registry.test.ts apps/desktop/electron-builder.yml
git commit -m "feat(server): bundle @vscode/ripgrep and inject absolute rgPath into grep/find tools"
```

---

## Task 5: Full-suite verification + doc updates

**Files:**

- Verify: whole workspace tests + lint + typecheck
- Update: `toolset-comparison.md` §3.5/§3.6 (sakti grep no longer shells to fd for find; both now rg-backed), `AGENTS.md` if it mentions `fd`.

### Step 5a — Full workspace check

```
vp check --fix
vp run -r test
```

Expected: all green. Any failure is a regression — investigate with the debugging skill, do not patch over.

### Step 5b — Update comparison doc

In `toolset-comparison.md`:

- §3.5 (Find/Glob): sakti engine is now `rg --files` (not `fd`); note bundled `@vscode/ripgrep`.
- §3.6 (Grep): note single-pass `--context` JSON parsing, `--smart-case` default, dropped `ignoreCase`.

### Step 5c — Manual smoke test in the desktop app

```
vp run desktop#dev
```

In the running app, trigger the agent to:

1. `find` a bare name fragment (e.g. "Button") — should return substring matches (the old tool would error if fd was absent).
2. `grep` for an identifier with `context: 3` in a CRLF file — confirm context lines align with no garbling.
3. `find` in a gitignored vendored dir (`openspec/references`) via explicit `path` — should list (rg honors explicit gitignored paths).

### Step 5d — Commit

```bash
git add toolset-comparison.md
git commit -m "docs: update toolset comparison for rg-backed grep/find"
```

---

## Out-of-scope (deliberately deferred)

- **Fuzzy/typo-tolerance** for grep/glob (FFF-style). Rejected: a subsequence-regex fallback was proven to not tolerate substitution typos and to emit unranked false positives. Real fuzzy needs edit-distance scoring — revisit only if telemetry shows agents repeatedly dead-ending on typos.
- **Repair-layer structural arg repairs** (null→omit, stringified JSON→array, markdown-link unwrap) beyond the two validated here. Deferred per YAGNI until session logs show those failure patterns.
- **Frecency/workspace-context ranking.** Speculative, unplumbed, secondary to the recall problem.
- **`@vscode/ripgrep` for the UI file picker** (`apps/server/src/lib/file-search.ts`). Out of scope; that path still uses `@ff-labs/fff-node` by design.

## Test summary (the regression net)

| Test                             | Pins                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| spawn ENOENT rejects             | missing-binary is a clear error, not "exit code 1"          |
| find fragment dispatch           | `Button` → `**/*Button*`, real globs unchanged              |
| find whole-project detection     | `.`, `./`, undefined = whole-project; subdir = not          |
| find rg argv validity            | no hallucinated rg flags in the --files invocation          |
| grep match vs context separators | `path:line:` and `path-line-` from a single stream          |
| grep CRLF regression             | no `\r` leaks (the garbling bug)                            |
| grep long-line truncation        | `--max-columns` ignored under `--json` → tool-side truncate |
| grep ignores begin/end/summary   | only match/context rendered                                 |
| grep rg argv validity            | no hallucinated rg flags in the grep invocation             |
| tool-registry rgBinPath          | absolute bundled binary path injected                       |
