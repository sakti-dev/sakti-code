# File Indexing & Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add file indexing and search API using chokidar + minisearch in @packages/server for @ mention autocomplete in desktop app

**Architecture:**

- Server-side file index using chokidar (file watching) and minisearch (fuzzy search)
- Per-project index keyed by directory path
- Blocklist-based filtering (not gitignore) for what NOT to index
- REST API endpoint for search queries

**Tech Stack:**

- chokidar (file watching)
- minisearch (fuzzy search)
- Hono (existing server framework)

---

## Dependencies

Install required packages in @packages/server:

```bash
cd packages/server
pnpm add chokidar minisearch
pnpm add -D @types/chokidar
```

---

## Task 1: Create File Index Service

**Files:**

- Create: `packages/server/src/services/file-index.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/services/__tests__/file-index.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FileIndex } from "../file-index";

describe("FileIndex", () => {
  let index: FileIndex;

  beforeEach(() => {
    index = new FileIndex();
  });

  it("should add a file to the index", () => {
    index.add("/test-project/src/index.ts");
    const results = index.search("index");
    expect(results.length).toBeGreaterThan(0);
  });

  it("should remove a file from the index", () => {
    index.add("/test-project/src/index.ts");
    index.remove("/test-project/src/index.ts");
    const results = index.search("index");
    expect(results.length).toBe(0);
  });

  it("should search with fuzzy matching", () => {
    index.add("/test-project/src/components/UserAuth.tsx");
    const results = index.search("user auth");
    expect(results.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test src/services/__tests__/file-index.test.ts`
Expected: FAIL (file doesn't exist yet)

**Step 3: Write implementation**

```typescript
// packages/server/src/services/file-index.ts
import Minisearch from "minisearch";

export interface FileEntry {
  path: string;
  name: string;
  directory: string;
}

export interface SearchResult {
  path: string;
  name: string;
  score: number;
}

const BLOCKLIST_PATTERNS = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
  "*.log",
  ".env",
  ".env.local",
  ".env.*.local",
];

function matchesBlocklist(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  return BLOCKLIST_PATTERNS.some(pattern => {
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1);
      return normalizedPath.endsWith(ext);
    }
    return normalizedPath.includes(`/${pattern}/`) || normalizedPath.endsWith(`/${pattern}`);
  });
}

export class FileIndex {
  private indexes: Map<string, Minisearch> = new Map();

  add(directory: string, filePath: string): void {
    if (matchesBlocklist(filePath)) return;

    let index = this.indexes.get(directory);
    if (!index) {
      index = new Minisearch({
        fields: ["name", "path", "directory"],
        storeFields: ["path", "name", "directory"],
        searchOptions: {
          boost: { name: 2, path: 1 },
          fuzzy: 0.2,
          prefix: true,
        },
      });
      this.indexes.set(directory, index);
    }

    const normalizedPath = filePath.replace(/\\/g, "/");
    const parts = normalizedPath.split("/");
    const name = parts[parts.length - 1] || "";
    const dir = parts.slice(0, -1).join("/") || "";

    index.add({
      path: normalizedPath,
      name,
      directory: dir,
    });
  }

  remove(directory: string, filePath: string): void {
    const index = this.indexes.get(directory);
    if (!index) return;

    const normalizedPath = filePath.replace(/\\/g, "/");
    index.discard(normalizedPath);
  }

  search(directory: string, query: string, limit = 20): SearchResult[] {
    const index = this.indexes.get(directory);
    if (!index) return [];

    const results = index.search(query, {
      limit,
      boost: { name: 2 },
    });

    return results.map(r => ({
      path: r.path as string,
      name: r.name as string,
      score: r.score,
    }));
  }

  clear(directory: string): void {
    this.indexes.delete(directory);
  }

  hasIndex(directory: string): boolean {
    return this.indexes.has(directory);
  }
}

export const fileIndex = new FileIndex();
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test src/services/__tests__/file-index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/services/file-index.ts packages/server/src/services/__tests__/file-index.test.ts
git commit -m "feat: add FileIndex service with minisearch"
```

---

## Task 2: Create File Watcher Service

**Files:**

- Create: `packages/server/src/services/file-watcher.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/services/__tests__/file-watcher.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FileWatcherService } from "../file-watcher";

describe("FileWatcherService", () => {
  it("should initialize watcher for a directory", async () => {
    const watcher = new FileWatcherService();
    await watcher.watch("/tmp/test-project");
    expect(watcher.isWatching("/tmp/test-project")).toBe(true);
    await watcher.unwatch("/tmp/test-project");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test src/services/__tests__/file-watcher.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/server/src/services/file-watcher.ts
import chokidar, { FSWatcher } from "chokidar";
import { fileIndex, FileEntry } from "./file-index";
import { createLogger } from "@sakti-code/shared/logger";

const logger = createLogger("file-watcher");

export type FileEventCallback = (event: "add" | "change" | "unlink", path: string) => void;

export class FileWatcherService {
  private watchers: Map<string, FSWatcher> = new Map();
  private callbacks: Set<FileEventCallback> = new Set();

  async watch(directory: string): Promise<void> {
    if (this.watchers.has(directory)) {
      logger.debug("Already watching directory", { directory });
      return;
    }

    logger.info("Starting file watcher", { directory });

    const watcher = chokidar.watch(directory, {
      ignored: [
        /(^|[\/\\])\../, // dotfiles except .env
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/coverage/**",
        "**/.cache/**",
        "**/*.log",
      ],
      persistent: true,
      ignoreInitial: false,
      depth: 10,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    watcher.on("add", path => {
      logger.debug("File added", { path });
      fileIndex.add(directory, path);
      this.notifyCallbacks("add", path);
    });

    watcher.on("change", path => {
      logger.debug("File changed", { path });
      fileIndex.remove(directory, path);
      fileIndex.add(directory, path);
      this.notifyCallbacks("change", path);
    });

    watcher.on("unlink", path => {
      logger.debug("File removed", { path });
      fileIndex.remove(directory, path);
      this.notifyCallbacks("unlink", path);
    });

    watcher.on("error", error => {
      logger.error("Watcher error", { error, directory });
    });

    this.watchers.set(directory, watcher);
    logger.info("File watcher started", { directory });
  }

  async unwatch(directory: string): Promise<void> {
    const watcher = this.watchers.get(directory);
    if (!watcher) return;

    await watcher.close();
    this.watchers.delete(directory);
    fileIndex.clear(directory);
    logger.info("File watcher stopped", { directory });
  }

  isWatching(directory: string): boolean {
    return this.watchers.has(directory);
  }

  onFileEvent(callback: FileEventCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  private notifyCallbacks(event: "add" | "change" | "unlink", path: string): void {
    this.callbacks.forEach(cb => cb(event, path));
  }

  async unwatchAll(): Promise<void> {
    await Promise.all(Array.from(this.watchers.keys()).map(dir => this.unwatch(dir)));
  }
}

export const fileWatcher = new FileWatcherService();
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test src/services/__tests__/file-watcher.test.ts`
Expected: PASS (or skip for now since it requires filesystem)

**Step 5: Commit**

```bash
git add packages/server/src/services/file-watcher.ts
git commit -m "feat: add FileWatcherService with chokidar"
```

---

## Task 3: Create Files API Routes

**Files:**

- Create: `packages/server/src/routes/files.ts`

**Step 1: Write the failing test**

```typescript
// packages/server/src/routes/__tests__/files.test.ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import filesRouter from "../files";

describe("files router", () => {
  const app = new Hono().route("/", filesRouter);

  it("should search files", async () => {
    const res = await app.request("/api/files/search?directory=/test&query=index");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("files");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && pnpm test src/routes/__tests__/files.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/server/src/routes/files.ts
/**
 * Files API Routes
 *
 * GET /api/files/search - Search files in project index
 * GET /api/files/status - Get file watcher status
 * POST /api/files/watch - Start watching a directory
 * DELETE /api/files/watch - Stop watching a directory
 */

import { Hono } from "hono";
import { fileIndex } from "../services/file-index";
import { fileWatcher } from "../services/file-watcher";
import type { Env } from "../index";

const filesRouter = new Hono<Env>();

/**
 * Search files in project index
 */
filesRouter.get("/api/files/search", async c => {
  const directory = c.req.query("directory");
  const query = c.req.query("query") || "";
  const limit = parseInt(c.req.query("limit") || "20");

  if (!directory) {
    return c.json({ error: "directory parameter required" }, 400);
  }

  const results = fileIndex.search(directory, query, limit);

  return c.json({
    files: results,
    query,
    directory,
    count: results.length,
  });
});

/**
 * Get file watcher status
 */
filesRouter.get("/api/files/status", async c => {
  const directory = c.req.query("directory");

  if (!directory) {
    return c.json({
      watchers: Array.from(
        Array.from({ length: 1 }).map(() => ({
          directory,
          watching: fileWatcher.isWatching(directory),
        }))
      ),
    });
  }

  return c.json({
    directory,
    watching: fileWatcher.isWatching(directory),
    indexed: fileIndex.hasIndex(directory),
  });
});

/**
 * Start watching a directory
 */
filesRouter.post("/api/files/watch", async c => {
  const { directory } = await c.req.json().catch(() => ({}));

  if (!directory) {
    return c.json({ error: "directory required in body" }, 400);
  }

  try {
    await fileWatcher.watch(directory);
    return c.json({
      success: true,
      directory,
      message: "Now watching for file changes",
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to start watcher",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * Stop watching a directory
 */
filesRouter.delete("/api/files/watch", async c => {
  const { directory } = await c.req.json().catch(() => ({}));

  if (!directory) {
    return c.json({ error: "directory required in body" }, 400);
  }

  try {
    await fileWatcher.unwatch(directory);
    return c.json({
      success: true,
      directory,
      message: "Stopped watching",
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to stop watcher",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default filesRouter;
```

**Step 4: Run test to verify it passes**

Run: `cd packages/server && pnpm test src/routes/__tests__/files.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/server/src/routes/files.ts
git commit -m "feat: add files API routes"
```

---

## Task 4: Register Files Router in Server

**Files:**

- Modify: `packages/server/src/index.ts`

**Step 1: Add import and mount router**

Add to imports:

```typescript
import filesRouter from "./routes/files";
```

Add to mount section (around line 181):

```typescript
app.route("/", filesRouter);
```

**Step 2: Verify server starts**

Run: `cd packages/server && pnpm dev`
Expected: Server starts without errors

**Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: register files router in server"
```

---

## Task 5: Frontend - Add API Client Method

**Files:**

- Modify: `apps/desktop/src/core/services/api/api-client.ts`

**Step 1: Add search method**

```typescript
// In ApiClient class, add:
async searchFiles(params: {
  directory: string;
  query: string;
  limit?: number;
}): Promise<{
  files: Array<{ path: string; name: string; score: number }>;
  query: string;
  directory: string;
  count: number;
}> {
  const searchParams = new URLSearchParams({
    directory: params.directory,
    query: params.query,
  });
  if (params.limit) {
    searchParams.set("limit", params.limit.toString());
  }

  const response = await this.fetch(`/api/files/search?${searchParams}`);
  return response.json();
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/core/services/api/api-client.ts
git commit -m "feat: add searchFiles API method"
```

---

## Task 6: Frontend - Create Use File Search Hook

**Files:**

- Create: `apps/desktop/src/core/chat/hooks/use-file-search.ts`

**Step 1: Write the hook**

```typescript
import { createSignal, createResource, Resource } from "solid-js";
import { useApi } from "@/core/services/api";

export interface FileSearchResult {
  path: string;
  name: string;
  score: number;
}

export function useFileSearch(directory: () => string | undefined) {
  const api = useApi();

  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<FileSearchResult[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);

  const search = async (searchQuery: string) => {
    const dir = directory();
    if (!dir || !searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await api.searchFiles({
        directory: dir,
        query: searchQuery,
        limit: 20,
      });
      setResults(response.files);
    } catch (error) {
      console.error("File search failed:", error);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    query,
    setQuery,
    results,
    isLoading,
    search,
  };
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/core/chat/hooks/use-file-search.ts
git commit -m "feat: add useFileSearch hook"
```

---

## Task 7: Frontend - Integrate @ Mention in Chat Input

**Files:**

- Modify: `apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx`

**Step 1: Add state for mention search**

Add to the component (around line 75):

```typescript
const [mentionSearch, setMentionSearch] = createSignal("");
const [mentionResults, setMentionResults] = createSignal<FileSearchResult[]>([]);
const [isMentionOpen, setIsMentionOpen] = createSignal(false);
```

**Step 2: Add search on @ trigger**

In `handleInput` function (around line 170-174), update the @ mention handling:

```typescript
if (/(^|\s)@[\w/-]*$/.test(value)) {
  setCommandMode("context");
  const searchQuery = value.split("@").pop()?.trim() ?? "";
  setMentionSearch(searchQuery);
  setIsMentionOpen(true);

  // Call search API
  const dir = /* get current directory somehow */;
  if (dir && searchQuery) {
    const response = await fetch(`/api/files/search?directory=${encodeURIComponent(dir)}&query=${encodeURIComponent(searchQuery)}`);
    const data = await response.json();
    setMentionResults(data.files);
  }
  return;
}
```

Note: You'll need to get the current workspace directory from context. Check how other hooks get the directory.

**Step 3: Add mention results popover UI**

Add a popover component to display mention results (similar to model selector):

```typescript
<Show when={isMentionOpen()}>
  <div class="mention-popover">
    <For each={mentionResults()}>
      {(file) => (
        <button
          onClick={() => selectMentionFile(file)}
          class="mention-item"
        >
          {file.path}
        </button>
      )}
    </For>
  </div>
</Show>
```

**Step 4: Commit**

```bash
git add apps/desktop/src/views/workspace-view/chat-area/chat-input.tsx
git commit -m "feat: integrate @ mention file search in chat input"
```

---

## Task 8: Test End-to-End Flow

**Step 1: Start server**

Run: `cd packages/server && pnpm dev`

**Step 2: Start file watcher for a test project**

```bash
curl -X POST http://localhost:3000/api/files/watch \
  -H "Content-Type: application/json" \
  -d '{"directory": "/path/to/your/test/project"}'
```

**Step 3: Search files**

```bash
curl "http://localhost:3000/api/files/search?directory=/path/to/your/test/project&query=user"
```

Expected: JSON with matching files

**Step 4: Test in desktop app**

- Open desktop app
- Type "@" in chat input
- See autocomplete with files

---

## Summary

| Task | Description                       | Files                      |
| ---- | --------------------------------- | -------------------------- |
| 1    | FileIndex service with minisearch | `services/file-index.ts`   |
| 2    | FileWatcher service with chokidar | `services/file-watcher.ts` |
| 3    | Files API routes                  | `routes/files.ts`          |
| 4    | Register router in server         | `index.ts`                 |
| 5    | Frontend API client               | `api-client.ts`            |
| 6    | Frontend useFileSearch hook       | `hooks/use-file-search.ts` |
| 7    | Frontend @ mention UI             | `chat-input.tsx`           |
| 8    | End-to-end testing                | Manual                     |

---

**Plan complete and saved to `docs/plans/2026-02-17-file-indexing-search.md`.**

Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
