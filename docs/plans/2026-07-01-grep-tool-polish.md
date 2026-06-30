# Grep Tool Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the critical file-scope bug in `grep`, kill the latent glob-ordering leak it shares with `find`, add a friendly path pre-flight, and rewrite the description — reusing the helpers established during the find-tool polish via a shared lib.

**Architecture:** Leaf-tool changes in `packages/tools/src/grep/index.ts` + colocated tests. A small Task 1 refactor extracts `EXCLUDE_GLOBS` and `buildPathNotFoundMessage` from `find/index.ts` into `packages/tools/src/lib/` so both tools share one source of truth (DRY; grep→lib, never grep→find). Five tasks, each TDD with a commit. Direct execution (no subagents).

**Tech Stack:** TypeScript, `vitest` (`vite-plus/test`), ripgrep (`rg --json --smart-case`), `node:fs`/`node:path`. Tool wraps `runProcess` (`packages/tools/src/lib/spawn.ts`) → `{exitCode, stdout, stderr}`.

---

## Verified rg / tool behavior (do not re-derive — bisected 2026-07-01)

| Fact                                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The file-`path` bug is a parsing bug, NOT an rg bug.** rg finds matches in a single file; `data.path.text` = the path as invoked (absolute).                                                                                                 | `rg --json -- "rgPath" <abs file>` emits `match` records with `path.text` = the file. The tool's `relativize` then computes `nodePath.relative(<file>, <file>)` = `""` → the `relativePath === ""` guard at `grep/index.ts:97` drops **every** record → empty output → "No matches found". |
| **The fix:** `nodePath.relative(dirname(file), file)` = `"index.ts"` (correct). Even simpler: in `relativize`, when `relative(root, rawPath)` returns `""`, fall back to `basename(rawPath)`.                                                  | `node -e 'path.relative(f,f)'` → `""`; `path.relative(path.dirname(f),f)` → `"index.ts"`.                                                                                                                                                                                                  |
| **rg multi-glob is last-match-wins for BOTH `--files` and `--json` modes.** Excludes pushed _before_ an include glob are overridden by it.                                                                                                     | `rg --json --glob='!**/target/**' --glob='*.rs' -- main <dir>` → 1 target match (LEAK); reversed order → 0 (correct). Same as `--files`.                                                                                                                                                   |
| **grep currently orders excludes BEFORE the user `glob`** (`:163-164` initial array, user glob pushed at `:173`) → when a user `glob` is passed, excluded build-output dirs with matching files leak.                                          | Confirmed via the `--json` target fixture above. (No leak when no user glob is passed — there's no include to override the excludes.)                                                                                                                                                      |
| **rg does NOT special-case `node_modules`** — `--no-ignore` searches it (1 match in a controlled fixture). The earlier "both orders = 0" anomaly was `*.ts` not basename-matching that specific path (a rg glob quirk), irrelevant to the fix. | `rg --no-ignore --hidden -- MARKER <dir w/ node_modules>` → node_modules match found.                                                                                                                                                                                                      |
| grep already handles **exit 1 (no matches) correctly** (`:185`: only `!== 0 && !== 1` throws) → "No matches found" (`:194`). No exit-code fix needed (unlike find).                                                                            | Read of `index.ts:185-194`.                                                                                                                                                                                                                                                                |
| But grep has **no path pre-flight** — a missing path → rg exit 2 → raw `IO error… (os error 2)` thrown (`:186`).                                                                                                                               | Symmetric to the find bug fixed in find Task 3.                                                                                                                                                                                                                                            |

---

## Files

- **Create:** `packages/tools/src/lib/excludes.ts`, `packages/tools/src/lib/path-errors.ts`
- **Modify:** `packages/tools/src/find/index.ts` (import the two helpers from lib instead of defining inline — pure refactor)
- **Modify:** `packages/tools/src/find/__tests__/find.test.ts` (update the `buildPathNotFoundMessage` import source)
- **Modify:** `packages/tools/src/grep/index.ts` (the actual fixes)
- **Test:** `packages/tools/src/grep/__tests__/grep.test.ts` (120 lines, 6 tests currently)

## Commands

```bash
# Run grep tests (workdir: packages/tools)
vp test run src/grep
vp test run src/grep -t "<name>"

# Find tests (must stay green after Task 1 refactor)
vp test run src/find

# Full gate
vp run '@sakti-code/tools#test'
vp check
```

## Conventions

- **RED** = failing test for the right reason; **GREEN** = minimal code; commit per task.
- No `console.log`, no emojis, arrow callbacks, `for...of`, early returns, `throw new Error(...)`. `exactOptionalPropertyTypes: true`.
- Tool **throws** for usage errors (bad path, empty pattern, rg crash) and **returns text** for normal outcomes incl. no-matches.
- Pre-commit hook runs `vp check --fix` — let it.

---

## Task 1: Extract shared lib (pure refactor, DRY)

**Files:**

- Create: `packages/tools/src/lib/excludes.ts`, `packages/tools/src/lib/path-errors.ts`
- Modify: `packages/tools/src/find/index.ts`, `packages/tools/src/find/__tests__/find.test.ts`

**Rationale:** grep needs the same `EXCLUDE_GLOBS` and `buildPathNotFoundMessage` find already has. Extract to `lib/` so both tools import from there (grep→lib, never grep→find). No behavior change — the gate is find's 48 tests + grep's 6 tests staying green.

### Step 1: Create `packages/tools/src/lib/excludes.ts`

```ts
/**
 * Directories never useful in search results (VCS, deps, build output).
 * Single source of truth — consumed by both the find and grep tools.
 * NOTE: rg multi-glob is last-match-wins, so an include glob MUST be passed
 * BEFORE these negation globs, or matching files inside these dirs get
 * re-included.
 */
export const EXCLUDE_GLOBS = [
  "**/.git/**",
  "**/node_modules/**",
  "**/target/**", // Rust
  "**/dist/**", // generic build output / TS
  "**/build/**", // generic
  "**/.next/**", // Next.js
  "**/out/**", // Next.js export / generic
];
```

### Step 2: Create `packages/tools/src/lib/path-errors.ts`

Move `LISTING_CAP`, `SIMILAR_CAP`, and `buildPathNotFoundMessage` here verbatim from `find/index.ts` (export `buildPathNotFoundMessage`; the caps stay module-private to this file):

```ts
import { basename, dirname } from "node:path";

const LISTING_CAP = 20;
const SIMILAR_CAP = 5;

/**
 * Build a friendly "path not found" message, optionally enriched with the
 * parent directory's entries and similar names. Pure: takes the entry list
 * (or null), does no I/O.
 */
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

### Step 3: Update `find/index.ts` to import from lib

- Remove the local `EXCLUDE_GLOBS` const (and its comment) and the local `LISTING_CAP`/`SIMILAR_CAP`/`buildPathNotFoundMessage`.
- Add imports: `import { EXCLUDE_GLOBS } from "../lib/excludes.ts";` and `import { buildPathNotFoundMessage } from "../lib/path-errors.ts";`.
- Drop the now-unused `basename, dirname` from the `node:path` import in find IF nothing else uses them (check — find's `dirname` is used in the pre-flight at `index.ts:168`; keep it). Re-read find/index.ts after editing and run `vp check` to catch unused imports.

### Step 4: Update `find.test.ts` import

Change `import { buildPathNotFoundMessage } from "../index.ts";` patterns — the pure-helper tests import `buildPathNotFoundMessage`. Update that one import to `"../../lib/path-errors.ts"` (verify the path depth from `find/__tests__/`). Keep the `createFindTool`/`resolveGlobPattern`/`classifyRgExitCode` imports from `"../index.ts"`.

### Step 5: Verify (no new tests — refactor gate)

```bash
vp test run src/find     # 48 pass
vp test run src/grep     # 6 pass (unchanged)
vp check                 # clean (watch for unused-import errors)
```

### Step 6: Commit

```bash
git add packages/tools/src/lib/excludes.ts packages/tools/src/lib/path-errors.ts \
        packages/tools/src/find/index.ts packages/tools/src/find/__tests__/find.test.ts
git commit -m "refactor(tools): extract EXCLUDE_GLOBS and buildPathNotFoundMessage to lib"
```

---

## Task 2: Fix file-`path` scope (the critical bug, report Issue 1)

**Files:**

- Modify: `packages/tools/src/grep/index.ts` — `relativize` (`:121-128`)
- Test: `packages/tools/src/grep/__tests__/grep.test.ts`

**Rationale:** When `path` is a file, `relativize` returns `""` and the `relativePath === ""` guard drops all records. Minimal, pure fix: when `relative(root, rawPath)` is `""`, fall back to `basename(rawPath)`. No `stat` needed — `relative` is only `""` when `rawPath === projectRoot`, which only happens for a single-file search.

### Step 1: RED — pure formatting test + e2e tests

Add to the `"grep: single-pass JSON formatting"` describe (pure):

```ts
it("uses the basename when projectRoot IS the file (file-scope search, report 1.5)", () => {
  const stream = JSON.stringify({
    type: "match",
    data: {
      path: { text: "/p/src/a.ts" },
      line_number: 4,
      lines: { text: "import { z } from 'z';\n" },
    },
  });
  // projectRoot == the file itself -> relative would be "" -> must fall back to basename
  const { output: out } = formatRgJsonStream(stream, "/p/src/a.ts");
  expect(out).toContain("a.ts:4: import { z } from 'z';");
});
```

Add a new e2e describe block (needs `mkdirSync` added to the `node:fs` import in the test file):

```ts
describe("grep: file-scope search (report 1.5 — path as a file)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-grep-file-"));
    writeFileSync(join(dir, "routes.ts"), "import { a } from 'a';\nimport { b } from 'b';\n");
    writeFileSync(join(dir, "other.ts"), "import { c } from 'c';\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns matches when path points to a FILE (not 'No matches found')", async () => {
    const tool = createGrepTool(dir);
    const result = await tool.execute("tc", { pattern: "import", path: "routes.ts" });
    const text = getTextContent(result);
    expect(text).not.toContain("No matches found");
    expect(text).toContain("routes.ts");
  });

  it("file scope is a subset of dir scope for that file", async () => {
    const tool = createGrepTool(dir);
    const fileText = getTextContent(
      await tool.execute("tc", { pattern: "import", path: "routes.ts" }),
    );
    const dirText = getTextContent(await tool.execute("tc", { pattern: "import", path: "." }));
    expect(fileText).toContain("routes.ts:1:");
    expect(dirText).toContain("routes.ts:1:");
    expect(fileText).not.toContain("other.ts");
  });

  it("works with an absolute file path", async () => {
    const tool = createGrepTool(dir);
    const abs = join(dir, "routes.ts");
    const text = getTextContent(await tool.execute("tc", { pattern: "import", path: abs }));
    expect(text).toContain("routes.ts:1:");
  });

  it("works across patterns and with literal mode on a file", async () => {
    const tool = createGrepTool(dir);
    const text = getTextContent(
      await tool.execute("tc", { pattern: "import { b }", path: "routes.ts", literal: true }),
    );
    expect(text).toContain("routes.ts:2:");
  });
});
```

### Step 2: verify RED

```bash
vp test run src/grep -t "file-scope search"
vp test run src/grep -t "basename when projectRoot IS the file"
```

Expected: FAIL — file-scope returns "No matches found"; the pure test fails (output empty).

### Step 3: GREEN — one-line fallback in `relativize`

```ts
function relativize(rawPath: string, projectRoot: string): string {
  // rg emits absolute paths when invoked with an absolute search path.
  let rel = rawPath;
  if (nodePath.isAbsolute(rel)) {
    rel = nodePath.relative(projectRoot, rel);
  }
  // When the search target is a single file, projectRoot == rawPath and
  // relative() returns "" — fall back to the basename so records survive.
  if (rel === "") {
    rel = nodePath.basename(rawPath);
  }
  return rel.replace(/\\/g, "/");
}
```

### Step 4: verify GREEN

```bash
vp test run src/grep     # all pass (6 prior + 5 new = 11)
```

### Step 5: Commit

```bash
git add packages/tools/src/grep/index.ts packages/tools/src/grep/__tests__/grep.test.ts
git commit -m "fix(grep): search a single file path instead of returning 'No matches found'"
```

---

## Task 3: Fix glob ordering + expand excludes (latent leak, shared with find)

**Files:**

- Modify: `packages/tools/src/grep/index.ts` — the `args` construction (`:157-175`); import `EXCLUDE_GLOBS` from lib
- Test: `packages/tools/src/grep/__tests__/grep.test.ts`

**Rationale:** rg is last-match-wins; grep pushes the user `glob` _after_ the exclude globs, so a user glob overrides the excludes and build-output files leak. Push the user glob _before_ the excludes, and use the shared expanded `EXCLUDE_GLOBS` (target/dist/build/.next/out).

### Step 1: RED — ordering test

```ts
describe("grep: build artifacts are excluded even when a user glob matches them", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-grep-excl-"));
    mkdirSync(join(dir, "target", "debug"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "target", "debug", "build.rs"), "fn run_process() {}\n");
    writeFileSync(join(dir, "src", "main.rs"), "fn run_process() {}\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("excludes target/ despite glob='*.rs' matching its file (ordering fix)", async () => {
    const tool = createGrepTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "run_process", glob: "*.rs" }));
    expect(text).toContain("main.rs");
    expect(text).not.toContain("target");
    expect(text).not.toContain("build.rs");
  });

  it("glob + path still returns real matches", async () => {
    const tool = createGrepTool(dir);
    const text = getTextContent(
      await tool.execute("tc", { pattern: "run_process", glob: "*.rs", path: "src" }),
    );
    expect(text).toContain("main.rs");
  });
});
```

### Step 2: verify RED

```bash
vp test run src/grep -t "build artifacts are excluded"
```

Expected: FAIL — `target/build.rs` leaks (current order: excludes then user glob).

### Step 3: GREEN — reorder + shared const

At the top of `grep/index.ts`, add `import { EXCLUDE_GLOBS } from "../lib/excludes.ts";`. Replace the `args` construction so the user glob comes FIRST, excludes AFTER:

```ts
const args: string[] = ["--no-config", "--json", "--smart-case", "--hidden", "--no-ignore"];
if (glob) {
  args.push("--glob", glob); // include glob FIRST (rg is last-match-wins)
}
args.push(...EXCLUDE_GLOBS.map((g) => `--glob=!${g}`)); // excludes AFTER
if (literal) {
  args.push("--fixed-strings");
}
if (contextValue > 0) {
  args.push(`--context=${contextValue}`);
}
args.push("--", pattern, searchPath);
```

### Step 4: verify GREEN

```bash
vp test run src/grep     # all pass (11 + 2 new = 13)
```

If the existing `"grep: rg argv validity"` test (`grep.test.ts:82-99`) breaks because its hardcoded flag list no longer matches, update its flag list to reflect the new order — but its purpose is "rg accepts these flags" (order-irrelevant), so it should still pass as-is.

### Step 5: Commit

```bash
git add packages/tools/src/grep/index.ts packages/tools/src/grep/__tests__/grep.test.ts
git commit -m "fix(grep): order user glob before excludes and expand the exclude list"
```

---

## Task 4: Path pre-flight (friendly missing-path error)

**Files:**

- Modify: `packages/tools/src/grep/index.ts` — add pre-flight before building args; import `pathExists`, `readdir`, `buildPathNotFoundMessage`
- Test: `packages/tools/src/grep/__tests__/grep.test.ts`

**Rationale:** grep has no existence check; a missing path reaches rg → exit 2 → raw `IO error… os error 2` thrown. Reuse find's pre-flight + `buildPathNotFoundMessage` for parity.

### Step 1: RED — tests

```ts
describe("grep: missing path raises a friendly error", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-grep-path-"));
    writeFileSync(join(dir, "alpha.ts"), "alpha\n");
    writeFileSync(join(dir, "alfred.ts"), "alfred\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("rejects with 'Path not found', not a raw OS error", async () => {
    const tool = createGrepTool(dir);
    await expect(tool.execute("tc", { pattern: "alpha", path: "does-not-exist" })).rejects.toThrow(
      /Path not found/,
    );
  });

  it("the error message contains no raw OS error text", async () => {
    const tool = createGrepTool(dir);
    await expect(
      tool.execute("tc", { pattern: "alpha", path: "no-such-dir"),
    ).rejects.toSatisfy((err: Error) => !err.message.includes("os error") && !err.message.includes("IO error"));
  });

  it("suggests similar entries when the parent exists", async () => {
    const tool = createGrepTool(dir);
    await expect(tool.execute("tc", { pattern: "alpha", path: "alp" })).rejects.toThrow(
      /Did you mean.*(alpha\.ts|alfred\.ts)/,
    );
  });

  it("does not false-positive on an existing path", async () => {
    const tool = createGrepTool(dir);
    const text = getTextContent(await tool.execute("tc", { pattern: "alpha", path: "." }));
    expect(text).toContain("alpha.ts");
  });
});
```

### Step 2: verify RED

```bash
vp test run src/grep -t "missing path raises a friendly error"
```

Expected: FAIL — production branch throws raw `rg: ... IO error ... (os error 2)`.

### Step 3: GREEN — add pre-flight

Imports at top of `grep/index.ts`:

```ts
import { readdir } from "node:fs/promises";
import { resolveToCwd, pathExists } from "../lib/path-utils.ts";
import { buildPathNotFoundMessage } from "../lib/path-errors.ts";
```

(Adjust the existing `resolveToCwd` import line to also bring in `pathExists`.) Then in `execute`, immediately after `searchPath`/`contextValue`/`effectiveLimit` are computed and after the opening abort check:

```ts
if (!(await pathExists(searchPath))) {
  let parentEntries: string[] | null = null;
  const parent = nodePath.dirname(searchPath);
  if (await pathExists(parent)) {
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
```

### Step 4: verify GREEN

```bash
vp test run src/grep     # all pass (13 + 4 new = 17)
```

### Step 5: Commit

```bash
git add packages/tools/src/grep/index.ts packages/tools/src/grep/__tests__/grep.test.ts
git commit -m "fix(grep): pre-flight path existence with parent-dir hints instead of leaking rg IO errors"
```

---

## Task 5: Description rewrite + empty-pattern guard

**Files:**

- Modify: `packages/tools/src/grep/index.ts` — `description` (`:137`) + an early guard in `execute`
- Test: `packages/tools/src/grep/__tests__/grep.test.ts`

**Rationale:** Document the context `-` separator (so LLMs don't mistake context for git-diff deletions), state that `path` may be a file _or_ directory (the report's "must be a directory" advice is now wrong), and guard empty patterns (rg with `""` is surprising). Keep it concise.

### Step 1: RED — tests

```ts
describe("grep: description and input guard", () => {
  const tool = createGrepTool(process.cwd());

  it("description explains the context '-' separator is not a deletion", () => {
    expect(tool.description).toMatch(/context.*-|separator/i);
  });

  it("description states path may be a file or directory", () => {
    expect(tool.description.toLowerCase()).toMatch(/file or director|file, directory|file or dir/);
  });

  it("rejects an empty pattern with a friendly error", async () => {
    await expect(tool.execute("tc", { pattern: "" })).rejects.toThrow(/pattern.*required|empty/i);
  });
});
```

### Step 2: verify RED

```bash
vp test run src/grep -t "description and input guard"
```

Expected: FAIL — current description lacks both points; empty pattern is passed through to rg.

### Step 3: GREEN

New `description` (replace the current one at `:137`):

```ts
description: `Search file CONTENTS for a pattern (regex by default). Returns matching lines as 'path:line: text'. 'path' may be a file or a directory (default: cwd). Use 'glob' to filter files (e.g. '*.ts'), 'literal=true' to treat the pattern as plain text, 'context=N' for surrounding lines, and 'limit' (default ${DEFAULT_LIMIT}) to cap matches.\nSmart-case is on: an all-lowercase pattern matches any case; any uppercase makes it case-sensitive. Searches all files including gitignored ones; excludes .git, node_modules, target, dist, build, .next, out.\nIn context output, context lines use '-' and matched lines use ':' as the separator — context lines are surrounding code, NOT deleted lines. If no pattern matches you'll get 'No matches found'; refine the pattern or widen 'path'/'glob'.`,
```

Empty-pattern guard at the top of `execute` (before resolving `searchPath`), right after the opening `if (signal?.aborted)`:

```ts
if (!pattern) {
  throw new Error("pattern is required");
}
```

### Step 4: verify GREEN

```bash
vp test run src/grep     # all pass (17 + 3 new = 20)
```

### Step 5: Commit

```bash
git add packages/tools/src/grep/index.ts packages/tools/src/grep/__tests__/grep.test.ts
git commit -m "docs(grep): document context separator and file/dir path; guard empty pattern"
```

---

## Task 6: Full gate + final verification

### Step 1

```bash
vp run '@sakti-code/tools#test'   # all tools tests (find 48 + grep 20 + rest)
vp check                           # format + lint + typecheck
```

Expected: both clean.

### Step 2: sanity-read

Read the final `packages/tools/src/grep/index.ts` end-to-end to confirm the pre-flight, ordering, relativize fallback, and guard compose coherently and the imports are all used.

### Step 3: final commit (only if lint touched anything)

```bash
git add -A && git commit -m "chore(grep): lint/format after polish" || echo "nothing to commit"
```

---

## Complete test inventory

### Existing (retained) — 6

| Test                                      | Asserts                        |
| ----------------------------------------- | ------------------------------ |
| emits `path:line:text` / `path-line-text` | match/context separators       |
| CRLF regression: no `\r` leaks            | context normalization          |
| long-line defense: >maxChars truncated    | `[truncated]`                  |
| ignores begin/end/summary records         | only match/context emitted     |
| rg argv validity                          | rg accepts the flags           |
| gitignore regression                      | gitignored content is searched |

### Task 1 — no new tests (refactor gate: find 48 + grep 6 stay green)

### Task 2 — file-scope (5)

| Test                                                    | Asserts                |
| ------------------------------------------------------- | ---------------------- |
| pure: basename when projectRoot is the file             | fallback fires         |
| e2e: file path returns matches (not "No matches found") | report 1.5             |
| e2e: file scope ⊆ dir scope, excludes other.ts          | consistency            |
| e2e: absolute file path works                           | report 1.5 variant     |
| e2e: literal mode on a file works                       | pattern×literal matrix |

### Task 3 — ordering/excludes (2)

| Test                                  | Asserts           |
| ------------------------------------- | ----------------- |
| excludes target/ despite glob='\*.rs' | ordering fix      |
| glob + path returns real matches      | no over-exclusion |

### Task 4 — pre-flight (4)

| Test                              | Asserts                  |
| --------------------------------- | ------------------------ |
| rejects with 'Path not found'     | friendly, not raw        |
| no raw OS error text              | no "os error"/"IO error" |
| suggests similar entries          | enrichment               |
| existing path → no false positive | regression guard         |

### Task 5 — description/guard (3)

| Test                                       | Asserts                         |
| ------------------------------------------ | ------------------------------- |
| description explains context '-' separator | report Issue 2                  |
| description states path may be file or dir | corrects report's "must be dir" |
| empty pattern rejected                     | report test 3.5                 |

**Total new grep tests: 14** (5 + 2 + 4 + 3). Grep goes from 6 → 20.

---

## Decisions & rationale

1. **File-path fix is a one-line fallback in `relativize`, not a `stat`.** `relative(root, rawPath)` is `""` only when `rawPath === projectRoot`, which only happens for single-file search. Falling back to `basename(rawPath)` is pure, needs no I/O, and is trivially unit-testable via `formatRgJsonStream`.
2. **Ordering fix mirrors find Task 5.** Verified rg is last-match-wins for `--json` too. Only matters when a user `glob` is present.
3. **Reuse via lib, not grep→find import.** A `grep` import of `find/index.ts` would be a weird dependency direction; `lib/` is the neutral home both tools already use (`lib/path-utils`, `lib/spawn`, `lib/truncate`).
4. **`path` may be a file or dir** — the report's recommended description says "path= must be a directory, not a file". That advice codifies the bug; after Task 2 files work, so the description must say file-or-dir.
5. **Defer Issue 3 (total match count on truncation).** `formatRgJsonStream` breaks early at the limit, so the true total is unknown. Showing "X of Y" requires parsing all of rg's already-buffered stdout (O(n)) — a real but lower-priority improvement; the current "N matches limit reached. Try a larger limit…" is acceptable. Tracked under Out-of-scope.
6. **Empty-pattern guard** — rg with `""` is surprising; a clear `pattern is required` error is friendlier than relying on rg's behavior.
7. **No exit-code refactor needed** — grep already treats exit 1 as "no matches" (`:185`), so it never leaked `rg exited with code 1` (unlike find). Only exit 2 (bad path) leaks, fixed by the Task 4 pre-flight.

## Out of scope (follow-ups)

- **Total match count in the truncation notice** (report Issue 3) — parse full stdout to report "Showing N of M".
- **Streaming rg with early termination at `limit`** — `runProcess` buffers all stdout; a perf follow-up.
- **Shared `lib` extraction of `classifyRgExitCode`** — grep's inline `exitCode !== 0 && exitCode !== 1` check could reuse find's classifier, but grep's 2-line check is fine; not worth the coupling now.
- **Harness-level repair layer** (separate future project) — the pure helpers (`buildPathNotFoundMessage`, `EXCLUDE_GLOBS`) established here and in find will seed it.
