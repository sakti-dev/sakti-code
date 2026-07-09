# Context-Aware File Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `@` context picker return a smarter default list where directories are first-class results and plausible directory targets rank above files inside them, without adding a user-facing search mode.

**Architecture:** Keep the existing `GET /api/projects/:id/files?query=&limit=` contract. Move context-aware ranking into `apps/server/src/lib/file-search.ts` by over-fetching `fff.mixedSearch()` results, boosting directory matches, honoring trailing-slash directory intent, and making `fd`/`find` fallbacks preserve comparable directory behavior. Preserve `kind` through the desktop `@` menu row model so directory results can be displayed and picked deliberately.

**Tech Stack:** TypeScript, Hono, SolidJS, `@ff-labs/fff-node`, `spawnPiped`, Vitest via `vite-plus/test`, Vite+ commands via `vp`.

## Global Constraints

- SolidJS is a hard requirement; do not introduce React.
- The endpoint stays `GET /api/projects/:id/files?query=&limit=`; do not add `mode`, `type`, or other UI-facing mode config for this behavior.
- Follow TDD: write a failing test, run it red, implement, run it green.
- Tests live in colocated `__tests__/` directories and use `vite-plus/test`.
- Use `vp run '@sakti-code/server#test'` and `vp run desktop#test` for focused validation, then `vp check` before completion.
- Respect `exactOptionalPropertyTypes: true`; use conditional spread instead of passing explicit `undefined`.
- Logs are permanent instrumentation; do not remove existing logger calls.

---

## File Structure

- Modify `apps/server/src/lib/file-search.ts`
  - Owns `searchProjectFiles`, `FileEntry`, `fff` integration, fallback commands, and the new context-aware ranking helpers.
- Modify `apps/server/src/lib/__tests__/file-search.test.ts`
  - Adds behavior tests for directory boosting, trailing-slash directory intent, and fallback-compatible directory listings.
- Modify `apps/server/src/__tests__/search-files.test.ts`
  - Adds route-level coverage that the public API returns directory `kind` and does not require mode config.
- Modify `apps/desktop/src/components/chat-input/context-rows.ts`
  - Extends `FileItem` with `kind` and maps directories to a directory group/description while preserving `@path` tokens.
- Modify `apps/desktop/src/components/chat-input/chat-input.tsx`
  - Stops erasing `kind` from the API response type.
- Modify `apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts`
  - Adds row model tests for directory entries.
- Modify `apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx`
  - Adds integration-style coverage that `@` search still calls the same endpoint with only `query`, and directory rows from the response render.

---

### Task 1: Server Ranking Semantics

**Files:**

- Modify: `apps/server/src/lib/file-search.ts`
- Test: `apps/server/src/lib/__tests__/file-search.test.ts`

**Interfaces:**

- Consumes: existing `searchProjectFiles(cwd: string, query: string | null, limit: number): Promise<FileEntry[]>`
- Produces: same `searchProjectFiles` signature, with smarter default ordering:
  - directory exact/prefix/path-segment matches rank before files inside them
  - a query ending in `/` returns only directory entries
  - result count still respects `limit`

- [ ] **Step 1: Add failing tests for context-aware ranking**

Append these tests inside `describe("searchProjectFiles", () => { ... })` in `apps/server/src/lib/__tests__/file-search.test.ts`:

```ts
it("ranks a matching directory before files inside it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fff-context-dir-"));
  mkdirSync(join(dir, "apps", "server", "src", "routes", "projects"), { recursive: true });
  writeFileSync(join(dir, "apps", "server", "src", "routes", "projects", "search-files.ts"), "x");
  writeFileSync(join(dir, "apps", "server", "src", "routes", "projects", "context.ts"), "x");

  const results = await searchProjectFiles(dir, "routes/projects", 10);

  expect(results[0]).toEqual({
    kind: "directory",
    path: "apps/server/src/routes/projects",
  });
  expect(results.map((r) => r.path)).toContain("apps/server/src/routes/projects/search-files.ts");
});

it("treats a trailing slash query as directory intent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fff-context-slash-"));
  mkdirSync(join(dir, "src", "components"), { recursive: true });
  writeFileSync(join(dir, "src", "components", "button.tsx"), "x");

  const results = await searchProjectFiles(dir, "components/", 10);

  expect(results).toEqual([{ kind: "directory", path: "src/components" }]);
});

it("keeps exact file basename matches above weaker directory matches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fff-context-file-"));
  mkdirSync(join(dir, "src", "components"), { recursive: true });
  mkdirSync(join(dir, "src", "button-utils"), { recursive: true });
  writeFileSync(join(dir, "src", "components", "button.tsx"), "x");
  writeFileSync(join(dir, "src", "button-utils", "index.ts"), "x");

  const results = await searchProjectFiles(dir, "button.tsx", 10);

  expect(results[0]).toEqual({ kind: "file", path: "src/components/button.tsx" });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
vp run '@sakti-code/server#test' -- apps/server/src/lib/__tests__/file-search.test.ts
```

Expected: at least the new directory ranking tests fail because the current implementation sorts `fff.mixedSearch()` only by native score and does not enforce directory-first context ranking. The trailing slash test may pass on the `fff` path but can still expose path formatting differences; keep the test because fallback behavior must also match it.

- [ ] **Step 3: Extend the local `FffPicker` interface**

In `apps/server/src/lib/file-search.ts`, replace the current `mixedSearch`-only `FffPicker` shape with this interface:

```ts
interface FffPicker {
  destroy(): void;
  directorySearch(
    query: string,
    opts?: { pageSize?: number },
  ): {
    ok: boolean;
    value?: {
      items: Array<{ relativePath: string }>;
      scores?: Array<{ total: number }>;
    };
    error?: string;
  };
  isScanning(): boolean;
  mixedSearch(
    query: string,
    opts?: { pageSize?: number },
  ): {
    ok: boolean;
    value?: {
      items: Array<{
        type: "file" | "directory";
        item: { relativePath: string };
      }>;
      scores?: Array<{ total: number }>;
    };
    error?: string;
  };
  waitForScan(timeoutMs?: number): Promise<unknown>;
}
```

- [ ] **Step 4: Add focused ranking helpers**

Add these helper functions after `getPicker` in `apps/server/src/lib/file-search.ts`:

```ts
function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/$/, "").replace(/^\.\//, "");
}

function normalizeQuery(query: string | null): string {
  return normalizeRelativePath((query ?? "").trim());
}

function isDirectoryIntent(query: string | null): boolean {
  const trimmed = (query ?? "").trim();
  return trimmed.endsWith("/") || trimmed.endsWith("\\");
}

function pathSegments(path: string): string[] {
  return normalizeRelativePath(path)
    .toLowerCase()
    .split("/")
    .filter((segment) => segment.length > 0);
}

function basename(path: string): string {
  const segments = pathSegments(path);
  return segments.at(-1) ?? "";
}

function directoryBoost(entry: FileEntry, query: string | null): number {
  const normalizedQuery = normalizeQuery(query).toLowerCase();
  if (!normalizedQuery) {
    return entry.kind === "directory" ? 50 : 0;
  }

  const normalizedPath = normalizeRelativePath(entry.path).toLowerCase();
  const entryBase = basename(entry.path);
  const queryBase = basename(normalizedQuery);

  if (entry.kind === "file" && entryBase === queryBase && queryBase.includes(".")) {
    return 900;
  }

  if (entry.kind === "directory" && normalizedPath === normalizedQuery) {
    return 1_000;
  }
  if (entry.kind === "directory" && normalizedPath.endsWith(`/${normalizedQuery}`)) {
    return 950;
  }
  if (entry.kind === "directory" && entryBase === queryBase) {
    return 850;
  }
  if (entry.kind === "directory" && normalizedPath.includes(normalizedQuery)) {
    return 750;
  }
  if (
    entry.kind === "directory" &&
    pathSegments(entry.path).some((part) => part.startsWith(queryBase))
  ) {
    return 650;
  }
  if (entry.kind === "directory") {
    return 100;
  }
  return 0;
}

function rankEntries(
  entries: Array<FileEntry & { score: number; index: number }>,
  query: string | null,
  limit: number,
): FileEntry[] {
  const directoryOnly = isDirectoryIntent(query);
  const seen = new Set<string>();
  return entries
    .filter((entry) => !directoryOnly || entry.kind === "directory")
    .map((entry) => ({
      ...entry,
      contextBoost: directoryBoost(entry, query),
      depth: normalizeRelativePath(entry.path).split("/").length,
    }))
    .sort((a, b) => {
      const boostDelta = b.contextBoost - a.contextBoost;
      if (boostDelta !== 0) {
        return boostDelta;
      }
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const depthDelta = a.depth - b.depth;
      if (depthDelta !== 0) {
        return depthDelta;
      }
      return a.index - b.index;
    })
    .filter((entry) => {
      const key = `${entry.kind}:${entry.path}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ kind, path }) => ({ kind, path }));
}
```

- [ ] **Step 5: Use over-fetching and re-ranking for `fff` results**

Replace the current `if (picker.ok) { ... }` block inside `searchProjectFiles` with:

```ts
const picker = await getPicker(cwd);
if (picker.ok) {
  const pageSize = Math.max(limit * 4, limit);
  const found = isDirectoryIntent(query)
    ? picker.picker.directorySearch(query ?? "", { pageSize })
    : picker.picker.mixedSearch(query ?? "", { pageSize });
  if (found.ok && found.value) {
    const entries = found.value.items.map((item, index) => {
      if ("type" in item) {
        return {
          path: normalizeRelativePath(item.item.relativePath),
          kind: item.type === "directory" ? ("directory" as const) : ("file" as const),
          score: found.value?.scores?.[index]?.total ?? 0,
          index,
        };
      }
      return {
        path: normalizeRelativePath(item.relativePath),
        kind: "directory" as const,
        score: found.value?.scores?.[index]?.total ?? 0,
        index,
      };
    });
    const ranked = rankEntries(entries, query, limit);
    if (ranked.length > 0 || isDirectoryIntent(query)) {
      return ranked;
    }
  }
}
```

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
vp run '@sakti-code/server#test' -- apps/server/src/lib/__tests__/file-search.test.ts
```

Expected: all `file-search.test.ts` tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add apps/server/src/lib/file-search.ts apps/server/src/lib/__tests__/file-search.test.ts
git commit -m "feat(server): rank directories for context file search"
```

---

### Task 2: Fallback Parity for `fd` and `find`

**Files:**

- Modify: `apps/server/src/lib/file-search.ts`
- Test: `apps/server/src/lib/__tests__/file-search.test.ts`

**Interfaces:**

- Consumes: `rankEntries(entries, query, limit): FileEntry[]` from Task 1
- Produces:
  - `runFd(query: string | null, cwd: string, limit: number): Promise<FileEntry[]>` returns context-ranked files and directories
  - `runFind(query: string | null, cwd: string, limit: number): Promise<FileEntry[]>` returns context-ranked files and directories

- [ ] **Step 1: Add fallback-focused tests that do not require disabling `fff`**

Append these tests to `apps/server/src/lib/__tests__/file-search.test.ts`:

```ts
it("returns directories for broad listings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fff-context-listing-"));
  mkdirSync(join(dir, "src", "features"), { recursive: true });
  writeFileSync(join(dir, "src", "features", "index.ts"), "x");

  const results = await searchProjectFiles(dir, "", 20);

  expect(results).toContainEqual({ kind: "directory", path: "src" });
  expect(results).toContainEqual({ kind: "directory", path: "src/features" });
});

it("respects limit after context ranking", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fff-context-limit-"));
  mkdirSync(join(dir, "src", "components"), { recursive: true });
  writeFileSync(join(dir, "src", "components", "button.tsx"), "x");
  writeFileSync(join(dir, "src", "components", "card.tsx"), "x");

  const results = await searchProjectFiles(dir, "components", 1);

  expect(results).toEqual([{ kind: "directory", path: "src/components" }]);
});
```

- [ ] **Step 2: Run tests to verify RED or expose current gap**

Run:

```bash
vp run '@sakti-code/server#test' -- apps/server/src/lib/__tests__/file-search.test.ts
```

Expected: the broad listing test may fail because native search may prioritize files or omit parent directories from the first page. If it passes on the local `fff` path, still continue because the production fallback code currently has an observable gap: `runFind` uses `-type f` only.

- [ ] **Step 3: Update `runFd` to tag directories and files reliably**

Replace the body of `runFd` with:

```ts
async function runFd(query: string | null, cwd: string, limit: number): Promise<FileEntry[]> {
  try {
    const directoryOnly = isDirectoryIntent(query);
    const searchQuery = normalizeQuery(query);

    const runTypedFd = async (
      type: "f" | "d",
      kind: "file" | "directory",
      startIndex: number,
    ): Promise<Array<FileEntry & { score: number; index: number }> | null> => {
      const args = [
        "--type",
        type,
        "--max-results",
        String(Math.max(limit * 4, limit)),
        "--color",
        "never",
      ];
      if (searchQuery) {
        args.push(searchQuery);
      }
      const { done } = spawnPiped("fd", args, { cwd });
      const result = await done;
      if (result.spawnError) {
        return null;
      }
      return result.stdout
        .split("\n")
        .filter(Boolean)
        .map((p, offset) => ({
          path: normalizeRelativePath(p),
          kind,
          score: 0,
          index: startIndex + offset,
        }));
    };

    const directories = await runTypedFd("d", "directory", 0);
    if (!directories) {
      return [];
    }

    const files = directoryOnly ? [] : await runTypedFd("f", "file", directories.length);
    if (!files) {
      return [];
    }

    const entries = [...directories, ...files];
    return rankEntries(entries, query, limit);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Update `runFind` to tag directories and files reliably**

Replace the body of `runFind` with:

```ts
async function runFind(query: string | null, cwd: string, limit: number): Promise<FileEntry[]> {
  try {
    const ignoreDirs = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".cache",
      ".next",
      "__pycache__",
      ".DS_Store",
    ];
    const ignoreDirsExpr = ignoreDirs.flatMap((d) => ["-not", "-path", `*/${d}/*`]);
    const searchQuery = normalizeQuery(query);
    const directoryOnly = isDirectoryIntent(query);

    const runTypedFind = async (
      type: "f" | "d",
      kind: "file" | "directory",
      startIndex: number,
    ): Promise<Array<FileEntry & { score: number; index: number }> | null> => {
      const args = [".", "-type", type];
      if (searchQuery) {
        const escaped = searchQuery.replace(/[.*?[\]()]/g, "\\$&");
        args.push("-name", `*${escaped}*`);
      }
      args.push(...ignoreDirsExpr);

      const { done } = spawnPiped("find", args, { cwd });
      const result = await done;
      if (result.spawnError) {
        return null;
      }
      return result.stdout
        .split("\n")
        .filter((p) => p && p !== ".")
        .map((p, offset) => ({
          path: normalizeRelativePath(p),
          kind,
          score: 0,
          index: startIndex + offset,
        }));
    };

    const directories = await runTypedFind("d", "directory", 0);
    if (!directories) {
      return [];
    }

    const files = directoryOnly ? [] : await runTypedFind("f", "file", directories.length);
    if (!files) {
      return [];
    }

    const entries = [...directories, ...files];
    return rankEntries(entries, query, limit);
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Run server tests**

Run:

```bash
vp run '@sakti-code/server#test' -- apps/server/src/lib/__tests__/file-search.test.ts
```

Expected: all file search library tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/server/src/lib/file-search.ts apps/server/src/lib/__tests__/file-search.test.ts
git commit -m "fix(server): keep file search fallbacks context aware"
```

---

### Task 3: Route Contract Coverage

**Files:**

- Modify: `apps/server/src/__tests__/search-files.test.ts`
- Uses: `apps/server/src/routes/projects/search-files.ts`

**Interfaces:**

- Consumes: unchanged route `GET /api/projects/:id/files?query=&limit=`
- Produces: test coverage proving callers do not need mode config and the response carries directory `kind`

- [ ] **Step 1: Add directory fixture setup**

In `beforeAll` in `apps/server/src/__tests__/search-files.test.ts`, add `mkdirSync` to imports and create a nested directory. Replace:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
```

with:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
```

Then add this before creating the app:

```ts
mkdirSync(join(tempDir, "src", "components"), { recursive: true });
writeFileSync(join(tempDir, "src", "components", "button.tsx"), "export const Button = 1;\n");
```

- [ ] **Step 2: Add failing route test**

Append this test in `describe("file search routes", () => { ... })`:

```ts
it("returns matching directories through the same files endpoint", async () => {
  const res = await app.request(
    new Request(`http://localhost/api/projects/${projectId}/files?query=components`),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.files[0]).toEqual({ kind: "directory", path: "src/components" });
});
```

- [ ] **Step 3: Run route test**

Run:

```bash
vp run '@sakti-code/server#test' -- apps/server/src/__tests__/search-files.test.ts
```

Expected: PASS after Tasks 1 and 2. If this fails, fix `searchProjectFiles`; do not add route-specific ranking.

- [ ] **Step 4: Commit Task 3**

```bash
git add apps/server/src/__tests__/search-files.test.ts
git commit -m "test(server): cover context directories in file route"
```

---

### Task 4: Desktop Row Model Preserves Directory Results

**Files:**

- Modify: `apps/desktop/src/components/chat-input/context-rows.ts`
- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx`
- Test: `apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts`

**Interfaces:**

- Consumes: server response items shaped as `{ path: string; kind: "file" | "directory" }`
- Produces:
  - `FileItem` includes `kind`
  - directory rows use `group: "Directories"`
  - file rows keep `group: "Files"`
  - tokens remain `@${path}` for both files and directories

- [ ] **Step 1: Add failing row model test**

In `apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts`, change:

```ts
const files: FileItem[] = [{ path: "src/a.ts" }, { path: "src/b.ts" }];
```

to:

```ts
const files: FileItem[] = [
  { kind: "file", path: "src/a.ts" },
  { kind: "file", path: "src/b.ts" },
];
```

Append this test under `describe("buildRows (@ mode)", () => { ... })`:

```ts
it("keeps directory results distinct from files", () => {
  const rows = buildRows({
    mode: "@",
    query: "components",
    commands: [],
    skills: [],
    files: [
      { kind: "directory", path: "src/components" },
      { kind: "file", path: "src/components/button.tsx" },
    ],
  });

  expect(rows.map((r) => r.group)).toEqual(["Directories", "Files"]);
  expect(rows.map((r) => r.token)).toEqual(["@src/components", "@src/components/button.tsx"]);
  expect(rows[0]).toMatchObject({
    id: "dir:src/components",
    label: "src/components",
    description: "Directory",
  });
});
```

- [ ] **Step 2: Run row test to verify RED**

Run:

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts
```

Expected: TypeScript or assertion failure because `FileItem` currently has only `path`, and every row uses `group: "Files"` plus `id: file:...`.

- [ ] **Step 3: Update `FileItem` and row mapping**

In `apps/desktop/src/components/chat-input/context-rows.ts`, replace:

```ts
export interface FileItem {
  path: string;
}
```

with:

```ts
export interface FileItem {
  kind: "file" | "directory";
  path: string;
}
```

Replace the `fileRows` mapping with:

```ts
const fileRows: Row[] = files.map((f) => ({
  group: f.kind === "directory" ? "Directories" : "Files",
  id: `${f.kind === "directory" ? "dir" : "file"}:${f.path}`,
  label: f.path,
  token: `@${f.path}`,
  ...(f.kind === "directory" ? { description: "Directory" } : {}),
}));
```

- [ ] **Step 4: Preserve `kind` in `ChatInput` API casting**

In `apps/desktop/src/components/chat-input/chat-input.tsx`, replace:

```ts
return body.files as { path: string }[];
```

with:

```ts
return body.files as { kind: "file" | "directory"; path: string }[];
```

- [ ] **Step 5: Run row tests to verify GREEN**

Run:

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts
```

Expected: all context row tests pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add apps/desktop/src/components/chat-input/context-rows.ts apps/desktop/src/components/chat-input/chat-input.tsx apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts
git commit -m "feat(desktop): preserve directory rows in context menu"
```

---

### Task 5: Desktop `@` Integration Coverage

**Files:**

- Modify: `apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx`

**Interfaces:**

- Consumes: `ChatInput` and its mocked `api.api.projects[":id"].files.$get`
- Produces: test coverage that `@` still sends only `{ query }` and renders directory results from the same endpoint

- [ ] **Step 1: Add a directory-rendering test**

Append this test to `apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx`:

```tsx
it("renders directory results from the same @ files endpoint", async () => {
  mockFilesGet.mockReturnValue({
    ok: true,
    json: async () => ({
      files: [
        { kind: "directory", path: "src/components" },
        { kind: "file", path: "src/components/button.tsx" },
      ],
    }),
  });

  render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
  const editor = screen.getByRole("textbox") as HTMLElement;

  caretAtStart(editor);
  fireEvent.keyDown(editor, { key: "@" });
  typeText(editor, "components");

  await waitFor(() => {
    expect(mockFilesGet).toHaveBeenCalledWith({
      param: { id: "proj1" },
      query: { query: "components" },
    });
    expect(screen.getByText("Directories")).toBeTruthy();
    expect(screen.getByText("src/components")).toBeTruthy();
    expect(screen.getByText("Directory")).toBeTruthy();
    expect(screen.getByText("src/components/button.tsx")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run integration test to verify RED or GREEN**

Run:

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx
```

Expected after Task 4: PASS. If run before Task 4, this fails because directory rows are not grouped or described.

- [ ] **Step 3: Commit Task 5**

```bash
git add apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx
git commit -m "test(desktop): cover directory results in at menu"
```

---

### Task 6: Final Verification

**Files:**

- Reads all modified files
- No production edits unless verification exposes a concrete defect

**Interfaces:**

- Consumes: all tasks above
- Produces: verified behavior ready for review

- [ ] **Step 1: Run focused server tests**

```bash
vp run '@sakti-code/server#test' -- apps/server/src/lib/__tests__/file-search.test.ts apps/server/src/__tests__/search-files.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused desktop tests**

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run project checks**

```bash
vp check
```

Expected: PASS with no formatter, lint, or typecheck errors.

- [ ] **Step 4: Run relevant package test suites if time permits**

```bash
vp run '@sakti-code/server#test'
vp run desktop#test
```

Expected: PASS. If these are too slow or fail for unrelated known issues, capture the exact failure output and include it in the handoff.

- [ ] **Step 5: Manual smoke test in the desktop app**

Run:

```bash
vp run desktop#dev
```

Open a project with nested directories, focus the chat input, type `@components`, and verify:

- `src/components` or the best matching directory appears above files inside it.
- `@components/` narrows to directory results.
- Selecting a directory inserts `@src/components`.
- Selecting a file still inserts `@src/components/button.tsx`.

- [ ] **Step 6: Commit verification fixes if any**

Only if verification required code changes:

```bash
git add apps/server/src/lib/file-search.ts apps/server/src/lib/__tests__/file-search.test.ts apps/server/src/__tests__/search-files.test.ts apps/desktop/src/components/chat-input/context-rows.ts apps/desktop/src/components/chat-input/chat-input.tsx apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx
git commit -m "fix: polish context-aware file search"
```

---

## Self-Review

- Spec coverage: The plan keeps the endpoint unchanged, makes `@` smarter by default, prioritizes directories for context selection, preserves file results, honors trailing slash directory intent, and covers fallbacks.
- Placeholder scan: No unresolved placeholders, no `TODO`, and no “implement later” steps remain.
- Type consistency: Server `FileEntry` remains `{ kind: "file" | "directory"; path: string }`; desktop `FileItem` is aligned to the same shape; row tokens remain `@${path}`.
- Scope check: This is one bounded behavior change across server ranking and desktop row display. It does not add new context attachment semantics, provider logic, database state, or user-facing config.
