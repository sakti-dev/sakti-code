# Find Tool Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the `find` tool robust and LLM-friendly — kill the cryptic `rg exited with code 1`, enforce `limit`, exclude build artifacts correctly, and rewrite the description to teach recovery instead of inviting retry loops.

**Architecture:** Leaf-tool-level changes only (a harness repair-layer is a separate future project — the pure classifiers and error vocabulary established here will seed it). All changes in `packages/tools/src/find/index.ts` + colocated tests. Five independent fixes, each TDD: (1) pure exit-code classifier, (2) path pre-flight + parent-dir enrichment, (3) hard-cap `limit`, (4) centralized exclude list **with corrected glob ordering**, (5) description rewrite.

**Tech Stack:** TypeScript, `vitest` (via `vite-plus/test`), ripgrep (`rg --files`), `node:fs`/`node:path`. Tool wraps `runProcess` (`packages/tools/src/lib/spawn.ts`) which returns `{exitCode, stdout, stderr}` and buffers all output.

---

## Verified rg behavior (do not re-derive — bisected 2026-07-01)

These facts were confirmed empirically against the bundled `@vscode/ripgrep`. They are the foundation of every test case below.

| Fact                                                                                                                                                                   | Evidence                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| rg `--files` exit codes: **0** = matches, **1** = no matches (success), **2** = error                                                                                  | `rg --files --glob=ZZZ.ts` → exit 1, empty stderr; `--glob=*.ts /bad` → exit 2, stderr `IO error... os error 2`                                                    |
| **Multi-glob is last-match-wins**                                                                                                                                      | `--glob='!**/target/**' --glob='*.rs'` → returns `target/build.rs` (exclude overridden by later include). Reversed order → correctly excluded.                     |
| **Current code orders excludes BEFORE include** (`index.ts:119-121`) → `.git`/`node_modules` excludes are **already broken** for any file matching the include pattern | Reproduced: a `.ts` file inside `target/` is returned by the current arg order                                                                                     |
| rg basename-matches no-slash globs                                                                                                                                     | `--glob='spawn*'` scoped to `lib/` matched both `spawn.ts` and `__tests__/spawn.test.ts`. So `logger*` finds `utils/logger.ts` (report 1.8 is correct, not a bug). |
| `baresync*` does NOT match files inside a `baresync/` dir                                                                                                              | Files inside have basenames like `package.json` (no "baresync"). `path=` is the correct lever (report 1.19 = docs, not a bug).                                     |
| `.*` is classified as a real glob (the `*` triggers `GLOB_CHARS`), passes through as `--glob=.*` → returns dotfiles, exit 0                                            | `/[*?[\]{}]/.test('.*')` → true (because of `*`, not `.`)                                                                                                          |
| rg has **no `--max-filecount`** flag                                                                                                                                   | Must slice results in JS after `runProcess` returns                                                                                                                |

---

## Files

- **Modify:** `packages/tools/src/find/index.ts` (192 lines currently)
- **Test:** `packages/tools/src/find/__tests__/find.test.ts` (98 lines, 6 tests currently)
- **No other files change.** (`packages/tools/src/lib/{path-utils,spawn,truncate}.ts` are consumed as-is.)

## Commands

```bash
# Run all find tests (workdir: packages/tools)
vp test run src/find

# Run a single test by name
vp test run src/find -t "classifyRgExitCode"

# Full package test + lint + typecheck gate (run before committing)
vp run '@sakti-code/tools#test'
vp check
```

## Conventions for this plan

- **RED** = write failing test, run it, watch it fail for the _right_ reason.
- **GREEN** = minimal code to pass.
- Every task ends with `vp test run src/find` green + a commit.
- No `console.log`, no emojis in code, arrow callbacks, `for...of`, early returns, `throw new Error(...)`. `exactOptionalPropertyTypes: true` → conditional spread for optional fields.
- Tool throws `Error` for **usage errors** (bad path, rg crash) so the agent loop surfaces them as tool errors; **returns text** for normal outcomes including empty results (empty is not an error).

---

## Task 1: Pure `classifyRgExitCode` classifier (Fix 1 core)

**Files:**

- Modify: `packages/tools/src/find/index.ts` (add exported fn near `resolveGlobPattern` ~line 59)
- Test: `packages/tools/src/find/__tests__/find.test.ts`

**Rationale:** The bug at `index.ts:134-135` conflates exit 1 (no matches) with exit 2 (error) and throws on both. Model the rg exit-code contract as a pure, separately-testable discriminated union (pattern stolen from `pi-tool-repair-layer/recorder/classifier.ts:107-134`). This fn does NO I/O.

### Step 1: RED — write the classifier tests

Add a new `describe` block at the top of the test file (after imports):

```ts
describe("find: classifyRgExitCode (pure)", () => {
  it("returns 'results' for exit code 0", () => {
    expect(classifyRgExitCode(0, "src/a.ts\n", "")).toEqual({ kind: "results" });
  });

  it("returns 'empty' for exit code 1 (no matches is NOT an error)", () => {
    expect(classifyRgExitCode(1, "", "")).toEqual({ kind: "empty" });
  });

  it("returns 'empty' for exit code 1 even if stderr is non-empty (pins rg contract)", () => {
    expect(classifyRgExitCode(1, "", "warning: something")).toEqual({ kind: "empty" });
  });

  it("returns 'error' with stderr message for exit code 2", () => {
    const out = classifyRgExitCode(2, "", "rg: IO error: No such file (os error 2)");
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.message).toContain("os error 2");
    }
  });

  it("returns 'error' with fallback message when exit >=2 and stderr empty", () => {
    const out = classifyRgExitCode(2, "", "");
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.message).toMatch(/rg failed/i);
      expect(out.message).toContain("exit 2");
    }
  });

  it("returns 'error' for unusual exit codes (e.g. 130 SIGINT)", () => {
    expect(classifyRgExitCode(130, "", "").kind).toBe("error");
  });

  it("never throws — pure function", () => {
    expect(() => classifyRgExitCode(-1, "", "")).not.toThrow();
  });
});
```

Add `classifyRgExitCode` to the import from `../index.ts` (it will not exist yet).

### Step 2: Run — verify RED

```bash
vp test run src/find -t "classifyRgExitCode"
```

Expected: FAIL — `classifyRgExitCode is not defined` (import resolves to undefined).

### Step 3: GREEN — implement the classifier

In `index.ts`, above `createFindTool`, add:

```ts
export type RgOutcome =
  | { kind: "results" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/**
 * Classify a `rg --files` result by its exit code.
 * rg contract: 0 = matches, 1 = no matches (success), >=2 = error.
 * Pure — no I/O. (Modelled on pi-tool-repair-layer classifyErrorType.)
 */
export function classifyRgExitCode(exitCode: number, _stdout: string, stderr: string): RgOutcome {
  if (exitCode === 0) return { kind: "results" };
  if (exitCode === 1) return { kind: "empty" };
  return { kind: "error", message: stderr.trim() || `rg failed (exit ${exitCode})` };
}
```

### Step 4: Run — verify GREEN

```bash
vp test run src/find -t "classifyRgExitCode"
```

Expected: PASS (7 tests).

### Step 5: Commit

```bash
git add packages/tools/src/find/index.ts packages/tools/src/find/__tests__/find.test.ts
git commit -m "feat(find): add pure classifyRgExitCode classifier (rg exit 1 = empty, not error)"
```

---

## Task 2: Wire classifier into the production branch + friendly empty message (Fix 1 integration)

**Files:**

- Modify: `packages/tools/src/find/index.ts` — `runList` (~line 128-138) and `formatFindResults` signature/empty branch (~line 151-162)
- Test: `packages/tools/src/find/__tests__/find.test.ts`

**Rationale:** Replace the buggy `if (exitCode !== 0 && stdout empty) throw` with the classifier. Exit 1 → return `[]` → flows to a friendly message. Thread `pattern` into `formatFindResults` so the empty message names the pattern and offers recovery (concise — full recovery hints live in the description to avoid per-result token bloat).

### Step 1: RED — add integration tests for no-match friendliness

```ts
describe("find: no matches returns a friendly message, never 'rg exited with code'", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-find-empty-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns a friendly message for a pattern that matches nothing (report 1.6)", async () => {
    writeFileSync(join(dir, "real.ts"), "x");
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "zzz_nonexistent_xyz" });
    const text = getTextContent(result);
    expect(text).not.toContain("rg exited with code");
    expect(text).not.toContain("os error");
    expect(text.toLowerCase()).toContain("no files found");
    expect(text).toContain("zzz_nonexistent_xyz"); // message names the pattern
  });

  it("returns the same friendly message when a path is given (report 1.7)", async () => {
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "*.md", path: dir });
    expect(getTextContent(result).toLowerCase()).toContain("no files found");
  });

  it("treats character-class patterns gracefully instead of crashing (report 1.12)", async () => {
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "[Cc]onfig" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
  });

  it("treats a prefix-only wildcard that matches nothing gracefully (report 1.13)", async () => {
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "config*" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
  });

  it("treats a '.*' pattern gracefully (report 1.18)", async () => {
    writeFileSync(join(dir, ".env"), "x");
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: ".*" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
  });

  it("bare name + path that matches nothing is friendly, not a crash (report 1.19)", async () => {
    mkdirSync(join(dir, "baresync"), { recursive: true });
    writeFileSync(join(dir, "baresync", "package.json"), "{}");
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "baresync*", path: "baresync" });
    expect(getTextContent(result)).not.toContain("rg exited with code");
  });
});
```

Add `mkdirSync` to the `node:fs` import.

### Step 2: Run — verify RED

```bash
vp test run src/find -t "no matches returns a friendly message"
```

Expected: most FAIL — current code throws `rg exited with code 1` for the no-match cases.

### Step 3: GREEN — wire the classifier + thread pattern

In `runList` (replace lines ~128-138):

```ts
const runList = async (): Promise<string[]> => {
  const { exitCode, stderr, stdout } = await runProcess(
    rgPath,
    [...baseArgs, searchPath],
    signal ? { signal } : {},
  );
  const outcome = classifyRgExitCode(exitCode, stdout, stderr);
  if (outcome.kind === "error") {
    throw new Error(outcome.message);
  }
  if (outcome.kind === "empty") {
    return [];
  }
  return stdout.split("\n").filter((l) => l.length > 0);
};
```

Change `formatFindResults` to accept `pattern` and use it in the empty branch. Update its signature and the empty return:

```ts
function formatFindResults(
  results: string[],
  searchPath: string,
  effectiveLimit: number,
  empty: boolean,
  pattern: string,
): { content: [{ type: "text"; text: string }]; details: FindToolDetails | undefined } {
  if (empty) {
    return {
      content: [
        {
          type: "text",
          text: `No files found matching '${pattern}'. Broaden the pattern, try snake_case/kebab-case variants, or list the parent directory with the read or bash tool.`,
        },
      ],
      details: undefined,
    };
  }
  // ... rest unchanged
```

Update both call sites (DI branch ~line 108 and production branch ~line 145) to pass `pattern` as the 5th arg.

### Step 4: Run — verify GREEN

```bash
vp test run src/find -t "no matches returns a friendly message"
```

Expected: PASS (6 tests). Also run the full file to confirm no regressions:

```bash
vp test run src/find
```

### Step 5: Commit

```bash
git add packages/tools/src/find/index.ts packages/tools/src/find/__tests__/find.test.ts
git commit -m "fix(find): treat rg exit 1 as empty results with a friendly message, not an error"
```

---

## Task 3: Hoist path pre-flight + parent-dir enrichment (Fix 2)

**Files:**

- Modify: `packages/tools/src/find/index.ts` — add `buildPathNotFoundMessage` pure helper; hoist the existence check above the DI/production split (~line 89-93)
- Test: `packages/tools/src/find/__tests__/find.test.ts`

**Rationale:** The DI branch already pre-checks path existence (`index.ts:95-97`); the production branch does not, so a bad path reaches rg and leaks `IO error... os error 2` (report 1.9). Hoist the check so both branches share it, and enrich the message with the parent directory's entries + similar names (pattern stolen from `pi-tool-repair-layer/index.ts:472-491`) so the LLM can self-correct.

### Step 1: RED — add the pure message-builder tests

```ts
describe("find: buildPathNotFoundMessage (pure)", () => {
  it("includes the missing path verbatim", () => {
    const msg = buildPathNotFoundMessage("/x/y/missing", null);
    expect(msg).toContain("Path not found: /x/y/missing");
  });

  it("does not mention raw OS errors", () => {
    const msg = buildPathNotFoundMessage("/x/y/missing", null);
    expect(msg).not.toContain("os error");
    expect(msg).not.toContain("IO error");
  });

  it("lists up to 20 parent entries when parent exists", () => {
    const entries = Array.from({ length: 25 }, (_, i) => `f${i}.ts`);
    const msg = buildPathNotFoundMessage("/d/missing", entries);
    expect(msg).toContain("f0.ts");
    expect(msg).toContain("f19.ts");
    expect(msg).toContain("more"); // "... (5 more)" suffix
    expect(msg).not.toContain("f20.ts"); // 21st omitted
  });

  it("surfaces up to 5 similar entries (case-insensitive)", () => {
    const entries = [
      "Config.ts",
      "conf.ts",
      "Configuration.ts",
      "config.json",
      "my-config.ts",
      "extra.ts",
    ];
    const msg = buildPathNotFoundMessage("/d/config", entries);
    expect(msg).toContain("Did you mean");
    expect(msg).toContain("Config.ts");
    expect(msg).toContain("config.json");
  });

  it("omits the 'did you mean' line when nothing is similar", () => {
    const msg = buildPathNotFoundMessage("/d/zzz", ["alpha.ts", "beta.ts"]);
    expect(msg).not.toContain("Did you mean");
  });

  it("omits the listing when parent is null", () => {
    const msg = buildPathNotFoundMessage("/d/zzz", null);
    expect(msg).not.toContain("Entries in");
  });
});
```

### Step 2: Run — verify RED

```bash
vp test run src/find -t "buildPathNotFoundMessage"
```

Expected: FAIL — `buildPathNotFoundMessage is not defined`.

### Step 3: GREEN — implement pure helper

In `index.ts` (add `readdir` import from `node:fs/promises` at top; add `basename`, `dirname` to the `node:path` import):

```ts
/**
 * Build a friendly "path not found" message, optionally enriched with the
 * parent directory's entries and similar names. Pure: takes the entry list
 * (or null), does no I/O. (Modelled on pi-tool-repair-layer Step 3b.)
 */
const LISTING_CAP = 20;
const SIMILAR_CAP = 5;

export function buildPathNotFoundMessage(
  searchPath: string,
  parentEntries: string[] | null,
): string {
  let msg = `Path not found: ${searchPath}`;
  if (!parentEntries || parentEntries.length === 0) return msg;

  const base = basename(searchPath).toLowerCase();
  const listing = parentEntries.slice(0, LISTING_CAP);
  const overflow = parentEntries.length - LISTING_CAP;

  if (base) {
    const similar = parentEntries
      .filter((e) => e.toLowerCase().includes(base))
      .slice(0, SIMILAR_CAP);
    if (similar.length > 0) {
      msg += `\n\nDid you mean: ${similar.map((e) => `'${e}'`).join(", ")}?`;
    }
  }

  const dir = dirname(searchPath);
  msg += `\n\nEntries in ${dir}:\n` + listing.map((e) => `  ${e}`).join("\n");
  if (overflow > 0) {
    msg += `\n  ... (${overflow} more)`;
  }
  return msg;
}
```

### Step 4: RED — add the end-to-end path tests

```ts
describe("find: missing path raises a friendly error (report 1.9)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-find-path-"));
    writeFileSync(join(dir, "alpha.ts"), "x");
    writeFileSync(join(dir, "alfred.ts"), "x");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("rejects with 'Path not found', not a raw OS error", async () => {
    const tool = createFindTool(dir);
    await expect(tool.execute("tc", { pattern: "*.ts", path: "does-not-exist" })).rejects.toThrow(
      /Path not found/,
    );
  });

  it("the error message contains no raw OS error text", async () => {
    const tool = createFindTool(dir);
    await expect(tool.execute("tc", { pattern: "*.ts", path: "no-such-dir" })).rejects.toThrow(
      (err: Error) => !err.message.includes("os error") && !err.message.includes("IO error"),
    );
  });

  it("suggests similar entries when the parent exists", async () => {
    const tool = createFindTool(dir);
    await expect(tool.execute("tc", { pattern: "*.ts", path: "alp" })).rejects.toThrow(
      /Did you mean.*alpha\.ts|alfred\.ts/,
    );
  });

  it("does not false-positive on an existing path", async () => {
    const tool = createFindTool(dir);
    const result = await tool.execute("tc", { pattern: "*.ts", path: "." });
    expect(getTextContent(result)).toContain("alpha.ts");
  });

  it("works for an absolute non-existent path", async () => {
    const tool = createFindTool(dir);
    await expect(
      tool.execute("tc", { pattern: "*.ts", path: "/definitely/not/here" }),
    ).rejects.toThrow(/Path not found/);
  });
});
```

### Step 5: Run — verify RED (path tests fail; pure tests pass)

```bash
vp test run src/find -t "missing path raises a friendly error"
```

Expected: FAIL — production branch still leaks `IO error... os error 2`.

### Step 6: GREEN — hoist the pre-flight

Restructure `execute` so the existence check + enrichment run ONCE before the branch split. Replace the block around lines 89-109 with:

```ts
const searchPath = resolveToCwd(searchDir || ".", cwd);
const effectiveLimit = limit && limit > 0 ? limit : DEFAULT_LIMIT;
const ops = customOps ?? defaultFindOperations;

if (!(await ops.exists(searchPath))) {
  let parentEntries: string[] | null = null;
  const parent = dirname(searchPath);
  if (await ops.exists(parent)) {
    try {
      parentEntries = await readdir(parent);
    } catch {
      parentEntries = null;
    }
  }
  throw new Error(buildPathNotFoundMessage(searchPath, parentEntries));
}

if (signal?.aborted) {
  throw new Error("Operation aborted");
}

if (customOps?.glob) {
  // DI branch (tests inject a fake)
  const results = await ops.glob(pattern, searchPath, {
    ignore: EXCLUDE_GLOBS,
    limit: effectiveLimit,
  });
  if (signal?.aborted) throw new Error("Operation aborted");
  return formatFindResults(results, searchPath, effectiveLimit, results.length === 0, pattern);
}

// Production branch ...
```

(Remove the now-duplicate existence check that was inside the DI branch at old lines 95-97.) Note `EXCLUDE_GLOBS` is defined in Task 5; to keep tasks independently green, define a temporary `const EXCLUDE_GLOBS = ["**/.git/**", "**/node_modules/**"];` at module top now and expand it in Task 5.

### Step 7: Run — verify GREEN

```bash
vp test run src/find
```

Expected: ALL PASS.

### Step 8: Commit

```bash
git add packages/tools/src/find/index.ts packages/tools/src/find/__tests__/find.test.ts
git commit -m "fix(find): pre-flight path existence with parent-dir hints instead of leaking rg IO errors"
```

---

## Task 4: Hard-cap `limit` (Fix 3)

**Files:**

- Modify: `packages/tools/src/find/index.ts` — `formatFindResults` (~line 151-192)
- Test: `packages/tools/src/find/__tests__/find.test.ts`

**Rationale:** `limit` currently only sets an advisory notice boolean (`index.ts:169`); the full result list is always joined (`:170`). The report (1.11) confirms `limit=10` returned 80+. Fix: slice to `effectiveLimit` **before** relativizing; keep the transparent notice (already follows pi's "deterministic truncation marker" rule). Guard `limit <= 0` → default.

### Step 1: RED — limit tests

```ts
describe("find: limit is enforced as a hard cap", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-find-limit-"));
    for (let i = 0; i < 12; i++) writeFileSync(join(dir, `f${i}.ts`), "x");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns at most `limit` results", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.ts", limit: 5 }));
    const fileLines = text.split("\n").filter((l) => /^f\d+\.ts$/.test(l));
    expect(fileLines.length).toBeLessThanOrEqual(5);
  });

  it("returns at most 1 result when limit=1", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.ts", limit: 1 }));
    const fileLines = text.split("\n").filter((l) => /^f\d+\.ts$/.test(l));
    expect(fileLines.length).toBe(1);
  });

  it("shows a 'limit reached' notice when results exceed limit", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.ts", limit: 5 }));
    expect(text).toMatch(/limit reached|results limit/i);
  });

  it("omits the notice when results fit under the limit", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.ts", limit: 100 }));
    expect(text).not.toMatch(/limit reached|results limit/i);
  });

  it("treats limit <= 0 as the default (does not crash, does not return zero)", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.ts", limit: 0 }));
    const fileLines = text.split("\n").filter((l) => /^f\d+\.ts$/.test(l));
    expect(fileLines.length).toBe(12); // default applies
  });

  it("still applies the 50KB byte truncation independently of limit", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.ts", limit: 100000 }));
    // small fixture won't hit 50KB, so just assert no crash + all files present
    expect(text).toContain("f0.ts");
  });
});
```

### Step 2: Run — verify RED

```bash
vp test run src/find -t "limit is enforced"
```

Expected: FAIL — `limit=5` returns 12 results.

### Step 3: GREEN — slice before relativizing

In `formatFindResults`, change the body after the `empty` branch:

```ts
const resultLimitReached = results.length > effectiveLimit;
const capped = results.slice(0, effectiveLimit);
const relativized = capped.map((p) => {
  if (p.startsWith(searchPath)) {
    return toPosixPath(p.slice(searchPath.length + 1));
  }
  return toPosixPath(nodePath.relative(searchPath, p));
});
```

(Keep the rest — `rawOutput`, `truncateHead`, notices — unchanged. The `resultLimitReached` now uses the **original** `results.length` so the notice fires only when results were actually truncated.)

And in `execute`, guard the limit (both the DI/production branches already compute `effectiveLimit`):

```ts
const effectiveLimit = limit && limit > 0 ? limit : DEFAULT_LIMIT;
```

### Step 4: Run — verify GREEN

```bash
vp test run src/find -t "limit is enforced"
vp test run src/find
```

Expected: PASS.

### Step 5: Commit

```bash
git add packages/tools/src/find/index.ts packages/tools/src/find/__tests__/find.test.ts
git commit -m "fix(find): enforce limit as a hard cap by slicing results before relativizing"
```

---

## Task 5: Centralized `EXCLUDE_GLOBS` + corrected glob ordering (Fix 4)

**Files:**

- Modify: `packages/tools/src/find/index.ts` — module-top const + `baseArgs` reorder (~line 114-122)
- Test: `packages/tools/src/find/__tests__/find.test.ts`

**Rationale:** Two problems compound here:

1. No build-artifact exclusion (report 1.2/1.3) — only `.git`/`node_modules`.
2. **Pre-existing bug:** rg multi-glob is last-match-wins, and the current code orders excludes _before_ the include glob, so any file matching the include inside an "excluded" dir is re-included. The `.git`/`node_modules` excludes are therefore **already ineffective** for matching files.

Fix: one named, commented constant consumed by both branches; put the include glob **first**, excludes **after**. (Pattern stolen from `pi-tool-repair-layer/repairs/constants.ts:135-152`.)

### Step 1: RED — exclusion + ordering tests

```ts
describe("find: build artifacts and deps are excluded even when they match the pattern", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-find-excl-"));
    mkdirSync(join(dir, "target", "debug"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "target", "debug", "build.rs"), "x"); // matches *.rs, inside target/
    writeFileSync(join(dir, "node_modules", "pkg", "index.ts"), "x"); // matches *.ts, inside deps
    writeFileSync(join(dir, "dist", "out.ts"), "x"); // matches *.ts, inside dist/
    writeFileSync(join(dir, "src", "main.rs"), "x"); // real source
    writeFileSync(join(dir, "app.ts"), "x"); // real source
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("excludes target/ even though its file matches the include (ordering fix)", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.rs" }));
    expect(text).toContain("main.rs");
    expect(text).not.toContain("target");
    expect(text).not.toContain("build.rs");
  });

  it("excludes node_modules/ even though its file matches the include", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.ts" }));
    expect(text).toContain("app.ts");
    expect(text).not.toContain("node_modules");
    expect(text).not.toContain("pkg/index.ts");
  });

  it("excludes dist/", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.ts" }));
    expect(text).not.toContain("dist/out.ts");
  });

  it("excludes target/ within a scoped path (report 1.3)", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.rs", path: "." }));
    expect(text).not.toContain("target/");
  });

  it("still returns real source files", async () => {
    const tool = createFindTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "*.ts" }));
    expect(text).toContain("app.ts");
  });
});
```

### Step 2: Run — verify RED

```bash
vp test run src/find -t "build artifacts and deps are excluded"
```

Expected: FAIL — `target/debug/build.rs` and `node_modules/pkg/index.ts` appear (current ordering re-includes them).

### Step 3: GREEN — constant + reorder

At module top (replace the temporary `EXCLUDE_GLOBS` from Task 3):

```ts
/**
 * Directories never useful in file-search results (VCS, deps, build output).
 * Single source of truth — consumed by both the DI and production branches.
 * NOTE: rg multi-glob is last-match-wins, so the include glob MUST be passed
 * BEFORE these negation globs, or matching files inside these dirs get
 * re-included.
 */
const EXCLUDE_GLOBS = [
  "**/.git/**",
  "**/node_modules/**",
  "**/target/**", // Rust
  "**/dist/**", // generic build output / TS
  "**/build/**", // generic
  "**/.next/**", // Next.js
  "**/out/**", // Next.js export / generic
];
```

Reorder `baseArgs` so the include glob comes FIRST, excludes AFTER:

```ts
const baseArgs = [
  "--no-config",
  "--files",
  "--hidden",
  "--no-ignore",
  `--glob=${effectivePattern}`,
  ...EXCLUDE_GLOBS.map((g) => `--glob=!${g}`),
];
```

### Step 4: Run — verify GREEN

```bash
vp test run src/find -t "build artifacts and deps are excluded"
vp test run src/find
```

Expected: PASS. The existing "rg argv validity" test (`find.test.ts:30-45`) must still pass — if its hardcoded flag list breaks, update it to the new order.

### Step 5: Commit

```bash
git add packages/tools/src/find/index.ts packages/tools/src/find/__tests__/find.test.ts
git commit -m "fix(find): centralize exclude list and order include-before-exclude so excludes hold"
```

---

## Task 6: Rewrite the description (Fix 5)

**Files:**

- Modify: `packages/tools/src/find/index.ts` — `description` field (~line 74)
- Test: `packages/tools/src/find/__tests__/find.test.ts`

**Rationale:** Current description is factually correct but flat and omits recovery. Rewrite in pi's 3-part shape (what / tips / recovery + circuit-breaker). Empirically justified by `pi-tool-repair-layer/recorder/empty-search-tracker.ts:6-13` (a model searched `NavUnifiedDropdown` 15+ times while the file was `nav_unified_dropdown.templ`). Keep it concise — full guidance belongs in the future harness layer, not every tool result.

### Step 1: RED — description content test

```ts
describe("find: description teaches recovery, not retry", () => {
  const tool = createFindTool(process.cwd());
  const d = tool.description;

  it("states the exclude list", () => {
    expect(d).toContain("target");
    expect(d).toContain("node_modules");
    expect(d).toContain("dist");
  });

  it("documents the bare-name → substring behavior", () => {
    expect(d).toMatch(/bare name|substring/i);
  });

  it("documents path= and limit=", () => {
    expect(d).toContain("path");
    expect(d).toContain("limit");
  });

  it("tells the model NOT to retry minor glob variations (circuit-breaker)", () => {
    expect(d).toMatch(/do not.*retry|don't.*retry/i);
  });

  it("hints at snake_case/kebab-case naming", () => {
    expect(d).toMatch(/snake_case|kebab-case/i);
  });
});
```

### Step 2: Run — verify RED

```bash
vp test run src/find -t "description teaches recovery"
```

Expected: FAIL — current description lacks the breaker, snake_case hint, and `target`/`dist`.

### Step 3: GREEN — rewrite description

```ts
description: `Find files by glob pattern or a bare name fragment (matched as a substring across the whole path, e.g. 'Button' -> '**/*Button*'). Returns file paths relative to 'path' (default: cwd). Searches all files including gitignored ones; excludes .git, node_modules, target, dist, build, .next, out.\nTips: pass 'path' to scope to a subdirectory (faster, fewer false positives); pass 'limit' (default ${DEFAULT_LIMIT}) to cap results.\nIf nothing is found, do NOT retry with minor glob variations — broaden the pattern, search a shorter fragment (the file may use snake_case or kebab-case), or list the parent directory with the read or bash tool. A directory name like 'foo' does not match files inside it; use path='foo' instead.`,
```

### Step 4: Run — verify GREEN

```bash
vp test run src/find -t "description teaches recovery"
vp test run src/find
```

Expected: PASS.

### Step 5: Commit

```bash
git add packages/tools/src/find/index.ts packages/tools/src/find/__tests__/find.test.ts
git commit -m "docs(find): rewrite description to teach recovery and document excludes/limit/path"
```

---

## Task 7: Full gate + final verification

### Step 1: Run the full gate

```bash
vp run '@sakti-code/tools#test'   # all tools tests
vp check                           # format + lint + typecheck
```

Expected: both clean.

### Step 2: Smoke-test against a real repo (manual, optional)

```bash
# From a target project, exercise the scenarios from the report:
# no-match friendly message, target/ exclusion, limit cap, bad-path hint.
```

### Step 3: Final commit (if any lint fixes)

```bash
git add -A && git commit -m "chore(find): lint/format after polish" || echo "nothing to commit"
```

---

## Complete test inventory (cross-reference)

Every test that will exist after this plan, mapped to its source:

### Pure unit tests (no rg, no filesystem)

| Test                                                   | Task | Asserts                 |
| ------------------------------------------------------ | ---- | ----------------------- |
| `classifyRgExitCode: results for exit 0`               | 1    | `{kind:"results"}`      |
| `classifyRgExitCode: empty for exit 1`                 | 1    | `{kind:"empty"}`        |
| `classifyRgExitCode: empty for exit 1 with stderr`     | 1    | pins rg contract        |
| `classifyRgExitCode: error for exit 2 (stderr)`        | 1    | message from stderr     |
| `classifyRgExitCode: error fallback when stderr empty` | 1    | `rg failed (exit N)`    |
| `classifyRgExitCode: error for unusual codes (130)`    | 1    | error                   |
| `classifyRgExitCode: never throws`                     | 1    | pure                    |
| `buildPathNotFoundMessage: includes path`              | 3    | verbatim path           |
| `buildPathNotFoundMessage: no OS error text`           | 3    | no "os error"           |
| `buildPathNotFoundMessage: caps listing at 20`         | 3    | f19 in, f20 out, "more" |
| `buildPathNotFoundMessage: up to 5 similar`            | 3    | "Did you mean"          |
| `buildPathNotFoundMessage: no similar → no hint`       | 3    | no "Did you mean"       |
| `buildPathNotFoundMessage: null parent → no listing`   | 3    | no "Entries in"         |

### resolveGlobPattern tests (existing, unchanged)

| Test                                     | Asserts                  |
| ---------------------------------------- | ------------------------ |
| leaves real glob unchanged               | passthrough              |
| upgrades bare fragment to substring glob | `Button` → `**/*Button*` |

### rg argv validity (existing; update flag order if needed in Task 5)

| Test                     | Asserts                                 |
| ------------------------ | --------------------------------------- |
| uses only accepted flags | `execFileSync("rg", ...)` doesn't throw |

### Production-branch end-to-end (filesystem fixtures)

| Test                                          | Task     | Report ref         |
| --------------------------------------------- | -------- | ------------------ |
| returns files matching glob via rg            | existing | 1.1                |
| upgrades bare fragment via rg                 | existing | 1.8                |
| gitignored .ts file is returned               | existing | (regression guard) |
| no-match friendly (zzz_nonexistent)           | 2        | 1.6                |
| no-match with path (\*.md)                    | 2        | 1.7                |
| char-class graceful ([Cc]onfig)               | 2        | 1.12               |
| prefix-only wildcard graceful (config\*)      | 2        | 1.13               |
| `.*` graceful                                 | 2        | 1.18               |
| bare name + path graceful (baresync\*)        | 2        | 1.19               |
| missing path → Path not found                 | 3        | 1.9                |
| missing path → no raw OS error                | 3        | 1.9                |
| missing path → suggests similar               | 3        | (enrichment)       |
| existing path → no false positive             | 3        | (regression)       |
| absolute non-existent path                    | 3        | 1.9/1.15           |
| limit=5 caps results                          | 4        | 1.11               |
| limit=1 → exactly 1                           | 4        | 1.11               |
| limit reached notice fires                    | 4        | 1.11               |
| no notice when under limit                    | 4        | 1.11               |
| limit<=0 → default                            | 4        | (edge)             |
| byte truncation independent of limit          | 4        | (edge)             |
| target/ excluded despite matching \*.rs       | 5        | 1.2/1.3            |
| node_modules/ excluded despite matching \*.ts | 5        | (pre-existing bug) |
| dist/ excluded                                | 5        | 1.2                |
| target/ excluded within scoped path           | 5        | 1.3                |
| real source files still returned              | 5        | (regression)       |

### Description content tests

| Test                             | Task |
| -------------------------------- | ---- |
| states exclude list              | 6    |
| documents bare-name → substring  | 6    |
| documents path= and limit=       | 6    |
| circuit-breaker ("do not retry") | 6    |
| snake_case/kebab-case hint       | 6    |

**Total new tests: ~30** (7 classifier + 6 message-builder + 6 no-match + 5 path + 6 limit + 5 exclude + 5 description). Existing 6 tests retained (2 resolveGlobPattern, 1 argv, 2 production-branch, 1 gitignore).

---

## Decisions & rationale (record)

1. **Exit 1 = empty, not error** — verified rg contract. This single fix resolves report items 1.6, 1.7, 1.12, 1.13, 1.18, 1.19.
2. **Path-not-found throws; no-match returns text** — usage errors surface as tool errors so the agent knows the call was wrong; empty is a normal outcome. Consistent with existing DI-branch behavior.
3. **Exclude ordering reversed (include-first)** — bisected: rg is last-match-wins; the previous order made excludes a no-op for matching files. This is a pre-existing bug the report did not catch.
4. **`limit <= 0` → default** — avoids the footgun where `limit: 0` returns nothing. Matches "handle gracefully" (report 2.4).
5. **Enrichment capped at 20 entries / 5 similar** — stolen from pi `index.ts:474-491`; bounds token cost.
6. **1.19 (`baresync*`) is docs, not code** — correct glob semantics; the description now says "A directory name like 'foo' does not match files inside it; use path='foo' instead."
7. **`.*` left as-is** — classified as a real glob (the `*`), returns dotfiles; not a crasher after Task 2.
8. **Leaf-level only** — a harness repair-layer (pi-style 3-layer with cache-safety) is a separate future project. The pure `classifyRgExitCode` + `buildPathNotFoundMessage` + error vocabulary established here are designed to be lifted into that layer later.
9. **No streaming/early-exit for limit** — `runProcess` buffers all stdout; slicing after is the cheap correct fix. Streaming rg with early kill once N lines arrive is a documented follow-up (perf, not correctness).

## Out of scope (follow-ups)

- Streaming `rg` with early termination at `limit` lines (perf).
- Harness-level repair layer (separate project).
- Making `EXCLUDE_GLOBS` configurable via tool options (YAGNI until a real need).
- Auto-retry with modified args (pi explicitly doesn't; we hint via description instead).
