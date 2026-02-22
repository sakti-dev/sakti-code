# LSP Diagnostics Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Language Server Protocol (LSP) diagnostics into @sakti-code/core tools so agents can receive code error/warning feedback after file modifications, similar to opencode's implementation.

**Architecture:**

- LSP client library in @sakti-code/core using vscode-jsonrpc for LSP communication
- LSP server management with auto-detection for TypeScript/JavaScript, Python, Go, Rust, and other common languages
- Diagnostics returned in tool output after edit/write operations
- Server-side route in @sakti-code/server for LSP status endpoints

**Tech Stack:** vscode-jsonrpc, vscode-languageserver-types, spawn for process management

---

## Task 1: LSP Types and Client Foundation

**Files:**

- Create: `packages/core/src/lsp/types.ts`
- Create: `packages/core/src/lsp/client.ts`
- Create: `packages/core/src/lsp/index.ts`
- Test: `packages/core/tests/lsp/types.test.ts`

### Step 1: Write the failing test

```typescript
// packages/core/tests/lsp/types.test.ts
import { describe, expect, it } from "vitest";
import type { LSPDiagnostic, LSPServerInfo } from "../../src/lsp/types";

describe("LSP Types", () => {
  describe("LSPDiagnostic", () => {
    it("should have required severity levels", () => {
      // Error = 1, Warning = 2, Information = 3, Hint = 4
      const diagnostic: LSPDiagnostic = {
        severity: 1,
        message: "Syntax error",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
      };
      expect(diagnostic.severity).toBe(1);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/lsp/types.test.ts`
Expected: FAIL with "Cannot find module '../../src/lsp/types'"

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/lsp/types.ts
export interface LSPRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LSPDiagnostic {
  severity: 1 | 2 | 3 | 4; // Error=1, Warning=2, Info=3, Hint=4
  message: string;
  range: LSPRange;
  source?: string;
}

export interface LSPServerInfo {
  id: string;
  name: string;
  extensions: string[];
  rootPatterns: string[];
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/lsp/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/lsp/types.ts tests/lsp/types.test.ts
git commit -m "feat(lsp): add LSP type definitions"
```

---

## Task 2: LSP Client with JSON-RPC Communication

**Files:**

- Modify: `packages/core/src/lsp/types.ts` - Add more types
- Modify: `packages/core/src/lsp/client.ts` - Add client implementation
- Modify: `packages/core/src/lsp/index.ts` - Add exports
- Test: `packages/core/tests/lsp/client.test.ts`

### Step 1: Write the failing test

```typescript
// packages/core/tests/lsp/client.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LSPClient } from "../../src/lsp/client";

describe("LSPClient", () => {
  describe("create", () => {
    it("should throw if server binary not found", async () => {
      await expect(
        LSPClient.create({
          serverId: "typescript",
          rootPath: "/test",
        })
      ).rejects.toThrow();
    });
  });

  describe("getDiagnostics", () => {
    it("should return empty map when no diagnostics", async () => {
      const client = await LSPClient.create({
        serverId: "typescript",
        rootPath: "/test",
      }).catch(() => null);

      if (!client) {
        // Skip if server not available
        return;
      }

      const diagnostics = client.getDiagnostics();
      expect(diagnostics).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/lsp/client.test.ts`
Expected: FAIL with "Cannot find module '../../src/lsp/client'"

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/lsp/client.ts
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import type { Diagnostic as VSCodeDiagnostic } from "vscode-languageserver-types";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import path from "node:path";
import type { LSPDiagnostic, LSPServerInfo, LSPRange } from "./types";

export interface LSPClientInstance {
  serverId: string;
  rootPath: string;
  getDiagnostics(): Map<string, LSPDiagnostic[]>;
  shutdown(): Promise<void>;
}

const DIAGNOSTICS_DEBOUNCE_MS = 150;

export const LSPClient = {
  async create(input: { serverId: string; rootPath: string }): Promise<LSPClientInstance> {
    // Simplified implementation for initial test
    const diagnostics = new Map<string, LSPDiagnostic[]>();

    return {
      serverId: input.serverId,
      rootPath: input.rootPath,
      getDiagnostics: () => diagnostics,
      shutdown: async () => {},
    };
  },
};
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/lsp/client.test.ts`
Expected: PASS (may skip some tests if server unavailable)

**Step 5: Commit**

```bash
cd packages/core
git add src/lsp/client.ts src/lsp/index.ts tests/lsp/client.test.ts
git commit -m "feat(lsp): add LSP client foundation"
```

---

## Task 3: LSP Server Registry with Auto-Detection

**Files:**

- Create: `packages/core/src/lsp/server.ts`
- Modify: `packages/core/src/lsp/index.ts`
- Test: `packages/core/tests/lsp/server.test.ts`

### Step 1: Write the failing test

```typescript
// packages/core/tests/lsp/server.test.ts
import { describe, expect, it } from "vitest";
import { LSPServerRegistry, type LSPServerDefinition } from "../../src/lsp/server";

describe("LSPServerRegistry", () => {
  describe("detectServer", () => {
    it("should detect TypeScript server for .ts files", async () => {
      const server = await LSPServerRegistry.detectServer("/project/src/file.ts");
      expect(server).toBeDefined();
    });

    it("should detect Python server for .py files", async () => {
      const server = await LSPServerRegistry.detectServer("/project/main.py");
      expect(server).toBeDefined();
    });

    it("should return undefined for unknown file types", async () => {
      const server = await LSPServerRegistry.detectServer("/project/file.xyz");
      expect(server).toBeUndefined();
    });
  });

  describe("getServer", () => {
    it("should return server by id", () => {
      const server = LSPServerRegistry.getServer("typescript");
      expect(server).toBeDefined();
      expect(server?.id).toBe("typescript");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/lsp/server.test.ts`
Expected: FAIL with "Cannot find module '../../src/lsp/server'"

**Step 3: Write minimal implementation**

```typescript
// packages/core/src/lsp/server.ts
import type { LSPServerInfo } from "./types";

export interface LSPServerDefinition extends LSPServerInfo {
  spawn(rootPath: string): Promise<{
    process: ReturnType<typeof import("child_process").spawn>;
    initializationOptions?: Record<string, unknown>;
  } | undefined>;
}

export const LSPServerRegistry = {
  servers: new Map<string, LSPServerDefinition>(),

  register(server: LSPServerDefinition): void {
    this.servers.set(server.id, server);
  },

  getServer(id: string): LSPServerDefinition | undefined {
    return this.servers.get(id);
  },

  async detectServer(filePath: string): Promise<LSPServerDefinition | undefined> {
    const ext = path.extname(filePath).toLowerCase();

    for (const server of this.servers.values()) {
      if (server.extensions.includes(ext)) {
        return server;
      }
    }

    return undefined;
  },
};

// Built-in server: TypeScript/JavaScript
LSPServerRegistry.register({
  id: "typescript",
  name: "TypeScript Language Server",
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  rootPatterns: ["package.json", "tsconfig.json"],
  async spawn(rootPath) {
    // Implementation spawns typescript-language-server
    return undefined; // Placeholder
  },
});

// Built-in server: Python
LSPServerRegistry.register({
  id: "pyright",
  name: "Pyright",
: [".py  extensions", ".pyi"],
  rootPatterns: ["pyproject.toml", "requirements.txt", "setup.py"],
  async spawn(rootPath) {
    // Implementation spawns pyright-langserver
    return undefined; // Placeholder
  },
});

// Add more servers as needed...
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/lsp/server.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/lsp/server.ts tests/lsp/server.test.ts
git commit -m "feat(lsp): add LSP server registry with auto-detection"
```

---

## Task 4: Integrate Diagnostics into Edit Tool

**Files:**

- Modify: `packages/core/src/tools/filesystem/edit.ts`
- Test: `packages/core/tests/tools/filesystem/edit-lsp.test.ts`

### Step 1: Write the failing test

```typescript
// packages/core/tests/tools/filesystem/edit-lsp.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Instance } from "../../../src/instance";
import { editTool } from "../../../src/tools/filesystem/edit";

// Mock LSP client
const mockGetDiagnostics = vi.fn(() => new Map());
const mockTouchFile = vi.fn();

vi.mock("../../../src/lsp", () => ({
  LSP: {
    touchFile: mockTouchFile,
    getDiagnostics: mockGetDiagnostics,
  },
}));

describe("editTool - LSP diagnostics integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return diagnostics in output after edit", async () => {
    mockGetDiagnostics.mockReturnValue(
      new Map([
        [
          "/workspace/test.ts",
          [
            {
              severity: 1,
              message: "Error: missing semicolon",
              range: { start: { line: 1, character: 10 }, end: { line: 1, character: 10 } },
            },
          ],
        ],
      ])
    );

    await Instance.provide({
      directory: "/workspace",
      sessionID: "test-session",
      async fn() {
        const result = await editTool.execute(
          { filePath: "/workspace/test.ts", oldString: "const x = 1", newString: "const x = 2" },
          {} as any
        );

        expect(result.diagnostics).toBeDefined();
        expect(result.diagnostics["/workspace/test.ts"]).toHaveLength(1);
      },
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/tools/filesystem/edit-lsp.test.ts`
Expected: FAIL with property diagnostics undefined

**Step 3: Write minimal implementation**

Update edit.ts to include diagnostics in output:

```typescript
// In packages/core/src/tools/filesystem/edit.ts, add:
// 1. Import LSP
import { LSP } from "../../lsp";

// 2. After file write, get diagnostics
await LSP.touchFile(absolutePath);
const diagnostics = LSP.getDiagnostics();

// 3. Add diagnostics to output
return {
  success: true,
  filePath: relativePath,
  replacements,
  diagnostics: Object.fromEntries(diagnostics),
};
```

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/tools/filesystem/edit-lsp.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/tools/filesystem/edit.ts tests/tools/filesystem/edit-lsp.test.ts
git commit -m "feat(edit): integrate LSP diagnostics into edit tool"
```

---

## Task 5: Integrate Diagnostics into Write Tool

**Files:**

- Modify: `packages/core/src/tools/filesystem/write.ts`
- Test: `packages/core/tests/tools/filesystem/write-lsp.test.ts`

### Step 1: Write the failing test

```typescript
// packages/core/tests/tools/filesystem/write-lsp.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Instance } from "../../../src/instance";
import { writeTool } from "../../../src/tools/filesystem/write";

const mockGetDiagnostics = vi.fn(() => new Map());

vi.mock("../../../src/lsp", () => ({
  LSP: {
    touchFile: vi.fn().mockResolvedValue(undefined),
    getDiagnostics: mockGetDiagnostics,
  },
}));

describe("writeTool - LSP diagnostics integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return diagnostics in output after write", async () => {
    mockGetDiagnostics.mockReturnValue(
      new Map([
        [
          "/workspace/new.ts",
          [
            {
              severity: 1,
              message: "Error: unused variable",
              range: { start: { line: 0, character: 5 }, end: { line: 0, character: 10 } },
            },
          ],
        ],
      ])
    );

    await Instance.provide({
      directory: "/workspace",
      sessionID: "test-session",
      async fn() {
        const result = await writeTool.execute(
          { filePath: "/workspace/new.ts", content: "const x = 1" },
          {} as any
        );

        expect(result.diagnostics).toBeDefined();
      },
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/core && npm test tests/tools/filesystem/write-lsp.test.ts`
Expected: FAIL with property diagnostics undefined

**Step 3: Write minimal implementation**

Add diagnostics to write.ts similar to edit.ts.

**Step 4: Run test to verify it passes**

Run: `cd packages/core && npm test tests/tools/filesystem/write-lsp.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd packages/core
git add src/tools/filesystem/write.ts tests/tools/filesystem/write-lsp.test.ts
git commit -m "feat(write): integrate LSP diagnostics into write tool"
```

---

## Task 6: Add LSP Server Route to @sakti-code/server

**Files:**

- Modify: `packages/server/src/routes/lsp.ts`
- Test: `packages/server/tests/routes/lsp.test.ts`

### Step 1: Write the failing test

```typescript
// packages/server/tests/routes/lsp.test.ts
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import lspRouter from "../../../src/routes/lsp";

describe("LSP Routes", () => {
  describe("GET /api/lsp/status", () => {
    it("should return server status", async () => {
      const app = new Hono();
      app.route("/", lspRouter);

      const res = await app.request("/api/lsp/status?directory=/test");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("servers");
      expect(json).toHaveProperty("directory");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/server && npm test tests/routes/lsp.test.ts`
Expected: May pass or fail depending on current state

**Step 3: Implement actual LSP status**

```typescript
// packages/server/src/routes/lsp.ts
import { Hono } from "hono";
import type { Env } from "../index";

const lspRouter = new Hono<Env>();

/**
 * Get LSP server status
 */
lspRouter.get("/api/lsp/status", async c => {
  const directory = c.req.query("directory") || c.get("instanceContext")?.directory;

  // TODO: Integrate with @sakti-code/core LSP to get actual server status
  // For now, return empty servers array
  return c.json({
    servers: [],
    directory,
  });
});

export default lspRouter;
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
cd packages/server
git add src/routes/lsp.ts tests/routes/lsp.test.ts
git commit -m "feat(lsp): enhance server LSP routes"
```

---

## Task 7: Add vscode-jsonrpc Dependency

**Files:**

- Modify: `packages/core/package.json`

### Step 1: Add dependency

```bash
cd packages/core
npm install vscode-jsonrpc vscode-languageserver-types
```

### Step 2: Verify tests still pass

Run: `cd packages/core && npm test`
Expected: All tests pass

### Step 3: Commit

```bash
cd packages/core
git add package.json package-lock.json
git commit -m "deps(core): add vscode-jsonrpc for LSP communication"
```

---

## Summary of Changes

| Task | Component              | Files                                                                       |
| ---- | ---------------------- | --------------------------------------------------------------------------- |
| 1    | LSP Types              | `src/lsp/types.ts`, `tests/lsp/types.test.ts`                               |
| 2    | LSP Client             | `src/lsp/client.ts`, `tests/lsp/client.test.ts`                             |
| 3    | LSP Server Registry    | `src/lsp/server.ts`, `tests/lsp/server.test.ts`                             |
| 4    | Edit Tool Integration  | `src/tools/filesystem/edit.ts`, `tests/tools/filesystem/edit-lsp.test.ts`   |
| 5    | Write Tool Integration | `src/tools/filesystem/write.ts`, `tests/tools/filesystem/write-lsp.test.ts` |
| 6    | Server Routes          | `src/routes/lsp.ts`, `tests/routes/lsp.test.ts`                             |
| 7    | Dependencies           | `package.json`                                                              |

---

## Plan complete and saved to `docs/plans/2026-02-17-lsp-diagnostics-integration.md`

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
