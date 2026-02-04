# Ekacode New Architecture Implementation Plan

## Cohesion Addendum (2026-01-28)
This plan is aligned to `00-cohesion-summary.md`. If any section conflicts, this addendum and the summary take precedence.

Key overrides:
- Orchestration: **XState Plan/Build** is primary; ToolLoopAgent is a building block used by those agents.
- HybridAgent: Plan/Build agents **use HybridAgent** for multimodal routing.
- UI: **Solid.js + UIMessage stream**; any React/plain-SSE examples are superseded.
- Providers: **Z.ai-first**, but keep provider-agnostic AI SDK v6 support.
- Sessions: **UUIDv7** server-generated; `threadId == sessionId`, `resourceId == userId|local`.
- Storage: **Mastra Memory + libsql** for recall; **Drizzle + libsql** for app tables.
- App data paths: **single resolved Ekacode home** for config/state/db/logs; **dev uses `./.ekacode/`**; **prod uses OS user-data**; **repo caches live in OS cache**.

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Phase 1: Core Instance System](#phase-1-core-instance-system)
4. [Phase 2: Server Integration](#phase-2-server-integration)
5. [Phase 3: Tools & Workspace](#phase-3-tools--workspace)
6. [Phase 4: Agent System](#phase-4-agent-system)
7. [Phase 5: Electron Desktop](#phase-5-electron-desktop)
8. [Phase 6: Renderer UI](#phase-6-renderer-ui)
9. [Testing Strategy](#testing-strategy)
10. [Deployment & Release](#deployment--release)

---

## Executive Summary

### Objective
Transform ekacode from a monolithic structure to a **context-aware, multi-project AI coding agent** with a desktop application wrapper, following OpenCode's proven architecture patterns while leveraging Hono, Electron, and AI SDK v6.

### Current State
```
ekacode/ [new]
├── packages/ [new]
│   ├── core/ [new]          # Agents, tools, security (needs instance context)
│   ├── server/ [new]        # Hono server (needs directory middleware)
│   ├── desktop/ [new]       # Electron shell (needs complete implementation)
│   └── shared/ [new]        # Shared types and utilities
```

### Target State
```
┌─────────────────────────────────────────────────────────────────────┐
│                         ELECTRON DESKTOP APP                         │
│  ┌───────────────┐  ┌──────────────────────────────────────────┐   │
│  │ MAIN PROCESS  │  │ RENDERER PROCESS (UI)                    │   │
│  │ ├─ Server     │  │ ├─ Project Selection                     │   │
│  │ ├─ Agent      │  │ ├─ Chat Interface                        │   │
│  │ └─ Workspace  │  │ ├─ Permission Dialogs                    │   │
│  └───────────────┘  │ └─ Settings                              │   │
│                     └───────────────────┬──────────────────────┘   │
└─────────────────────────────────────────┼─────────────────────────┘
                                          │ IPC
                                          │ HTTP (localhost)
                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         HONO SERVER                                  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Directory Context Middleware                                  │  │
│  │ ├─ Extract directory from query/header                        │  │
│  │ └─ Instance.provide({ directory, ... })                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                         │                            │
│                                         ▼                            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Routes (all wrapped in directory context)                     │  │
│  │ ├─ GET  /api/health                                          │  │
│  │ ├─ POST /api/prompt          ← Main agent endpoint            │  │
│  │ ├─ GET  /api/permissions     ← Permission status              │  │
│  │ ├─ POST /api/permissions     ← Permission approval            │  │
│  │ ├─ GET  /api/events          ← SSE for real-time updates      │  │
│  │ ├─ GET  /api/rules           ← Permission rules CRUD          │  │
│  │ └─ GET  /api/workspace       ← Workspace info                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CORE (AGENT & TOOLS)                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Instance.provide({ directory, fn })                           │  │
│  │   └─ AsyncLocalStorage stores directory context               │  │
│  │      └─ Tools access via Instance.directory                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                         │                            │
│                                         ▼                            │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ AI SDK v6 ToolLoopAgent                                       │  │
│  │ ├─ receive tools with directory context                       │  │
│  │ ├─ execute tools (read, write, bash, etc.)                    │  │
│  │ └─ stream responses via SSE                                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

| Decision | Rationale | Alternative Considered |
|----------|-----------|------------------------|
| **AsyncLocalStorage** for directory context | Clean async propagation, no explicit threading | Query params on every call (tedious) |
| **Per-request directory** via middleware | Stateless, supports multiple projects | Global directory (single-project only) |
| **In-process server + agent** | Simplified IPC, direct tool access | Separate agent service (complexity) |
| **Electron over Tauri** | Team familiarity, ecosystem | Tauri (smaller bundle) |
| **Hono for HTTP** | Lightweight, Edge-compatible | Express (heavier) |
| **Resolved app paths** (home + cache) | Prevent split DBs; self-contained data | Relative DB paths (fragile) |

---

## Architecture Overview

### App Data Paths (Canonical)
- Use a shared **path resolver** (in `packages/shared`) to compute absolute `home/config/state/db/logs/cache` paths.
- **Resolution order**: `EKACODE_HOME` → dev `./.ekacode/` → prod OS user-data (`app.getPath("userData")` or `env-paths`).
- **Repo cache** lives under cache (`<cache>/repos/`) to keep clones disposable.
- DB URLs must be **absolute** (`file:/abs/path/...`) so server + core never diverge.

### Data Flow: Single Request

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Step 1: User selects project directory in UI                             │
│ ┌────────────────────────────────────────────────────────────────────┐  │
│ │ Renderer: window.ekacodeAPI.openProjectDialog()                    │  │
│ │   ↓ IPC                                                            │  │
│ │ Main: dialog.showOpenDialog({ properties: ['openDirectory'] })    │  │
│ │   ↓ Returns path                                                   │  │
│ │ Renderer: setProjectPath('/home/user/my-project')                  │  │
│ └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Step 2: User sends message                                              │
│ ┌────────────────────────────────────────────────────────────────────┐  │
│ │ Renderer: fetch('/api/prompt?directory=%2Fhome%2Fuser%2Fmy-project' │  │
│ │   headers: { Authorization: 'Basic ...' }                          │  │
│ │   body: { message: 'Read package.json' }                           │  │
│ └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Step 3: Server processes request                                         │
│ ┌────────────────────────────────────────────────────────────────────┐  │
│ │ Hono Middleware: directoryContextMiddleware()                       │  │
│ │   ├─ const directory = c.req.query("directory")                    │  │
│ │   ├─ const decoded = decodeURIComponent(directory)                 │  │
│ │   └─ return Instance.provide({ directory, async fn() { ... } })    │  │
│ └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│ ┌────────────────────────────────────────────────────────────────────┐  │
│ │ Route Handler: POST /api/prompt                                     │  │
│ │   ├─ const agent = new ToolLoopAgent({ ... })                      │  │
│ │   ├─ const tools = createToolsWithDirectory(Instance.directory)    │  │
│ │   ├─ const response = await agent.stream(message, tools)           │  │
│ │   └─ streamText(response, return c)                                │  │
│ └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Step 4: Tools execute with directory context                             │
│ ┌────────────────────────────────────────────────────────────────────┐  │
│ │ Tool: readFile('package.json')                                     │  │
│ │   ├─ const directory = Instance.directory  // '/home/user/my-project'│
│ │   ├─ const fullPath = path.join(directory, 'package.json')          │  │
│ │   └─ return fs.readFile(fullPath, 'utf-8')                          │  │
│ └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Directory Context Propagation

```typescript
// Context flows through entire request lifecycle
Request → Middleware → Instance.provide({ directory })
  → Agent (AI SDK) → Tools (use Instance.directory)
```

**Critical Property**: Directory context is **async-local**, meaning it:
- Persists through async operations (promises, async/await)
- Is isolated per request (no cross-contamination)
- Requires no explicit passing (accessed via `Instance.directory`)

---

## Phase 1: Core Instance System

### Objective
Implement `Instance.provide()` pattern using AsyncLocalStorage for directory context propagation.

### Files to Create/Modify

```
packages/core/src/ [existing]
├── instance/ [new]
│   ├── index.ts [new]           # Main Instance export
│   ├── context.ts [new]         # AsyncLocalStorage setup
│   ├── bootstrap.ts [new]       # Project initialization
│   └── state.ts [new]           # Instance-level state management
└── workspace/ [existing]
    ├── index.ts [existing]           # Workspace interface
    ├── project.ts [new]         # Project detection/info
    └── vcs.ts [new]             # Git/VCS integration
```

### 1.1 Context Store

**File: `packages/core/src/instance/context.ts`** [new]

```typescript
/**
 * Async Context Store for Directory Propagation
 * Uses AsyncLocalStorage to maintain directory context throughout async operations
 */

import { AsyncLocalStorage } from "node:async_hooks"

export interface InstanceContext {
  directory: string
  project?: ProjectInfo
  vcs?: VCSInfo
  createdAt: number
}

export interface ProjectInfo {
  name: string
  root: string
  worktree?: string
  packageJson?: Record<string, unknown>
}

export interface VCSInfo {
  type: "git" | "hg" | "svn" | "none"
  branch?: string
  commit?: string
  remote?: string
}

/**
 * AsyncLocalStorage instance for context propagation
 * Each request gets its own isolated context
 */
const contextStorage = new AsyncLocalStorage<InstanceContext>()

/**
 * Get current context
 * @returns Current context or throws if not in Instance.provide()
 */
export function getContext(): InstanceContext {
  const context = contextStorage.getStore()
  if (!context) {
    throw new Error(
      "Instance context accessed outside of Instance.provide(). " +
      "Tools and operations must be called within Instance.provide({ directory, fn })"
    )
  }
  return context
}

/**
 * Run function with context
 * @internal Used by Instance.provide()
 */
export function runWithContext<R>(
  context: InstanceContext,
  fn: () => Promise<R>
): Promise<R> {
  return contextStorage.run(context, fn)
}

/**
 * Check if currently in context
 */
export function hasContext(): boolean {
  return contextStorage.getStore() !== undefined
}
```

### 1.2 Instance Main Export

**File: `packages/core/src/instance/index.ts`** [new]

```typescript
/**
 * Instance Context Manager
 * Provides directory-aware execution context for agents and tools
 *
 * @example
 * ```ts
 * await Instance.provide({
 *   directory: '/home/user/project',
 *   async fn() {
 *     console.log(Instance.directory) // '/home/user/project'
 *     const files = await listFiles('.') // Reads from project directory
 *   }
 * })
 * ```
 */

import { createContext, getContext, hasContext, runWithContext, type InstanceContext } from "./context"
import { bootstrapProject } from "./bootstrap"
import { getState } from "./state"
import { detectProject, getVCSInfo } from "../workspace"

export { InstanceContext }

export const Instance = {
  /**
   * Execute function with directory context
   *
   * @param input.directory - Project directory path
   * @param input.fn - Async function to execute with context
   * @param input.init - Optional initialization function
   * @returns Result of fn()
   *
   * @example
   * ```ts
   * const result = await Instance.provide({
   *   directory: '/home/user/my-project',
   *   async fn() {
   *     // Tools can now use Instance.directory
   *     return await readFile('package.json')
   *   }
   * })
   * ```
   */
  async provide<R>(input: {
    directory: string
    fn: () => Promise<R>
    init?: (context: InstanceContext) => Promise<void>
  }): Promise<R> {
    const { directory, fn, init } = input

    // Resolve to absolute path
    const resolvedDirectory = resolveDirectory(directory)

    // Check if context already exists with same directory
    if (hasContext()) {
      const existing = getContext()
      if (existing.directory === resolvedDirectory) {
        // Reuse existing context
        return fn()
      }
    }

    // Create new context
    const context: InstanceContext = {
      directory: resolvedDirectory,
      createdAt: Date.now()
    }

    // Initialize project info if init not provided
    if (init) {
      await init(context)
    } else {
      // Auto-initialize with default bootstrap
      await Instance.provide({
        directory: resolvedDirectory,
        async fn() {
          context.project = await detectProject()
          context.vcs = await getVCSInfo()
        }
      })
    }

    // Run function with context
    return runWithContext(context, fn)
  },

  /**
   * Get current directory from context
   * @throws Error if called outside Instance.provide()
   */
  get directory(): string {
    return getContext().directory
  },

  /**
   * Get current project info
   * @throws Error if called outside Instance.provide()
   */
  get project() {
    return getContext().project
  },

  /**
   * Get current VCS info
   * @throws Error if called outside Instance.provide()
   */
  get vcs() {
    return getContext().vcs
  },

  /**
   * Check if currently in context
   */
  get inContext(): boolean {
    return hasContext()
  },

  /**
   * Get instance-level state (persisted across provides)
   * Useful for caching, connection pools, etc.
   */
  state: getState,

  /**
   * Bootstrap project (default initialization)
   * @internal
   */
  bootstrap: bootstrapProject
}

/**
 * Resolve directory to absolute path
 */
function resolveDirectory(directory: string): string {
  const { resolve } = require("path")
  if (path.isAbsolute(directory)) {
    return directory
  }
  return resolve(process.cwd(), directory)
}

// Re-export types
export type { InstanceContext, ProjectInfo, VCSInfo } from "./context"
```

### 1.3 Bootstrap

**File: `packages/core/src/instance/bootstrap.ts`** [new]

```typescript
/**
 * Instance Bootstrap
 * Automatic project initialization when Instance.provide() is called
 */

import { detectProject } from "../workspace/project"
import { getVCSInfo } from "../workspace/vcs"
import type { InstanceContext } from "./context"

/**
 * Bootstrap project with default initialization
 * - Detects project type (node, python, rust, etc.)
 * - Gets VCS info (git branch, etc.)
 * - Reads package.json/pyproject.toml/Cargo.toml
 */
export async function bootstrapProject(context: InstanceContext): Promise<void> {
  // Detect project info
  context.project = await detectProject(context.directory)

  // Get VCS info
  context.vcs = await getVCSInfo(context.directory)
}

/**
 * Re-export for convenience
 */
export { detectProject, getVCSInfo }
```

### 1.4 State Management

**File: `packages/core/src/instance/state.ts`** [new]

```typescript
/**
 * Instance State Management
 * Persists state across Instance.provide() calls
 * Useful for caching, connection pools, etc.
 */

import { LRUCache } from "lru-cache"

interface StateEntry {
  project: {
    info?: any
    vcs?: any
  }
  cache: Map<string, unknown>
}

const globalState = new Map<string, StateEntry>()

/**
 * Get or create state for directory
 */
export function getState(directory?: string) {
  const key = directory ?? "default"

  if (!globalState.has(key)) {
    globalState.set(key, {
      project: {},
      cache: new Map()
    })
  }

  const entry = globalState.get(key)!

  return {
    get project() {
      return entry.project
    },
    get cache() {
      return entry.cache
    },
    clear() {
      globalState.delete(key)
    }
  }
}

/**
 * Global LRU cache for expensive operations
 */
export const globalCache = new LRUCache<string, unknown>({
  max: 500,
  ttl: 1000 * 60 * 5, // 5 minutes
})
```

### 1.5 Workspace Detection

**File: `packages/core/src/workspace/project.ts`** [new]

```typescript
/**
 * Project Detection
 * Detects project type, name, and metadata from directory
 */

import { readFile } from "fs/promises"
import { join } from "path"
import type { ProjectInfo } from "../instance/context"

/**
 * Detect project information from directory
 */
export async function detectProject(directory?: string): Promise<ProjectInfo | undefined> {
  const dir = directory ?? process.cwd()

  // Try package.json (Node.js)
  const pkgPath = join(dir, "package.json")
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"))
    return {
      name: pkg.name ?? getNameFromPath(dir),
      root: dir,
      packageJson: pkg
    }
  } catch {
    // Not a Node.js project
  }

  // Try pyproject.toml (Python)
  const pyprojectPath = join(dir, "pyproject.toml")
  try {
    const content = await readFile(pyprojectPath, "utf-8")
    const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/)
    return {
      name: nameMatch?.[1] ?? getNameFromPath(dir),
      root: dir
    }
  } catch {
    // Not a Python project
  }

  // Try Cargo.toml (Rust)
  const cargoPath = join(dir, "Cargo.toml")
  try {
    const content = await readFile(cargoPath, "utf-8")
    const nameMatch = content.match(/name\s*=\s*"([^"]+)"/)
    return {
      name: nameMatch?.[1] ?? getNameFromPath(dir),
      root: dir
    }
  } catch {
    // Not a Rust project
  }

  // Default: use directory name
  return {
    name: getNameFromPath(dir),
    root: dir
  }
}

function getNameFromPath(dir: string): string {
  return dir.split("/").pop() ?? dir.split("\\").pop() ?? "unknown"
}
```

**File: `packages/core/src/workspace/vcs.ts`** [new]

```typescript
/**
 * VCS Detection
 * Detects version control system and current branch
 */

import { exec } from "child_process"
import { promisify } from "util"
import type { VCSInfo } from "../instance/context"

const execAsync = promisify(exec)

/**
 * Get VCS information from directory
 */
export async function getVCSInfo(directory?: string): Promise<VCSInfo> {
  const dir = directory ?? process.cwd()

  // Check for .git
  try {
    const { stdout: branch } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir,
      timeout: 5000
    })

    const { stdout: commit } = await execAsync("git rev-parse HEAD", {
      cwd: dir,
      timeout: 5000
    })

    const { stdout: remote } = await execAsync("git config --get remote.origin.url", {
      cwd: dir,
      timeout: 5000
    }).catch(() => ({ stdout: "" }))

    return {
      type: "git",
      branch: branch.trim(),
      commit: commit.trim().slice(0, 8),
      remote: remote.trim() || undefined
    }
  } catch {
    // Not a git repo
  }

  return { type: "none" }
}
```

### 1.6 Index Export

**File: `packages/core/src/instance/index.ts`** [new] (Final export structure)

```typescript
/**
 * Instance Module
 * Main export for directory context management
 */

export { Instance } from "./instance"
export type {
  InstanceContext,
  ProjectInfo,
  VCSInfo
} from "./context"

export { createContext, getContext, hasContext } from "./context"
export { bootstrapProject } from "./bootstrap"
export { getState, globalCache } from "./state"
```

### Testing Phase 1

**File: `packages/core/src/instance/index.test.ts`** [new]

```typescript
import { describe, it, expect } from "vitest"
import { Instance } from "./index"
import { mkdir, writeFile, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("Instance", () => {
  const testDir = join(tmpdir(), "ekacode-test-" + Date.now())

  it("should provide directory context", async () => {
    await mkdir(testDir, { recursive: true })

    const result = await Instance.provide({
      directory: testDir,
      async fn() {
        return Instance.directory
      }
    })

    expect(result).toBe(testDir)
  })

  it("should throw outside of provide", () => {
    expect(() => Instance.directory).toThrow()
  })

  it("should nest provides correctly", async () => {
    const dir1 = join(testDir, "project1")
    const dir2 = join(testDir, "project2")

    await mkdir(dir1, { recursive: true })
    await mkdir(dir2, { recursive: true })

    const result = await Instance.provide({
      directory: dir1,
      async fn() {
        const outer = Instance.directory
        await Instance.provide({
          directory: dir2,
          async fn() {
            const inner = Instance.directory
            return { outer, inner }
          }
        })
      }
    })

    expect(result.outer).toBe(dir1)
    expect(result.inner).toBe(dir2)
  })

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true })
  })
})
```

---

## Phase 2: Server Integration

### Objective
Add directory context middleware to Hono server and create prompt endpoint.

### Files to Create/Modify

```
packages/server/src/ [existing]
├── middleware/ [new]
│   ├── directory-context.ts [new]    # Directory context middleware
│   ├── auth.ts [new]                 # Authentication middleware
│   └── error.ts [new]                # Error handling middleware
├── routes/ [existing]
│   ├── permissions.ts [existing]          # Existing: permission status/approval
│   ├── events.ts [existing]               # Existing: SSE events
│   ├── rules.ts [existing]                # Existing: rules CRUD
│   ├── prompt.ts [new]               # Main prompt endpoint (to add)
│   ├── health.ts [new]               # Health check (to add)
│   └── index.ts [new]                # Route aggregation
└── index.ts [existing]                    # Main server file
```

### 2.1 Directory Context Middleware

**File: `packages/server/src/middleware/directory-context.ts`** [new]

```typescript
/**
 * Directory Context Middleware
 * Extracts directory from request and wraps handler in Instance.provide()
 */

import type { Context, Next } from "hono"
import { Instance } from "@ekacode/core/instance"
import { createLogger } from "@ekacode/shared/logger"

const logger = createLogger("server:middleware")

/**
 * Directory context middleware options
 */
export interface DirectoryContextOptions {
  /**
   * Query parameter name for directory
   * @default "directory"
   */
  queryParam?: string

  /**
   * Header name for directory
   * @default "x-ekacode-directory"
   */
  headerName?: string

  /**
   * Default directory if none provided
   * @default process.cwd()
   */
  defaultDirectory?: string
}

/**
 * Create directory context middleware
 *
 * Extracts directory from query parameter or header, then wraps
 * the request handler in Instance.provide() for context propagation.
 *
 * @example
 * ```ts
 * app.use(directoryContextMiddleware())
 *
 * // Now all routes have directory context
 * app.get("/api/files", async (c) => {
 *   const dir = Instance.directory
 *   return c.json({ directory: dir })
 * })
 * ```
 */
export function directoryContextMiddleware(options: DirectoryContextOptions = {}) {
  const {
    queryParam = "directory",
    headerName = "x-ekacode-directory",
    defaultDirectory = process.cwd()
  } = options

  return async (c: Context, next: Next) => {
    // Extract directory from query parameter or header
    const directoryFromQuery = c.req.query(queryParam)
    const directoryFromHeader = c.req.header(headerName)
    const directory = directoryFromQuery ?? directoryFromHeader ?? defaultDirectory

    let decodedDirectory: string
    try {
      decodedDirectory = decodeURIComponent(directory)
    } catch (error) {
      logger.warn("Failed to decode directory path", {
        directory,
        error: error instanceof Error ? error.message : String(error)
      })
      decodedDirectory = directory
    }

    // Resolve to absolute path
    const { resolve } = require("path")
    const resolvedDirectory = resolve(
      defaultDirectory,
      decodedDirectory
    )

    // Wrap request in directory context
    return Instance.provide({
      directory: resolvedDirectory,
      async fn() {
        // Add directory to request context for logging
        c.set("directory", resolvedDirectory)

        logger.debug("Request with directory context", {
          path: c.req.path,
          directory: resolvedDirectory
        })

        return next()
      }
    })
  }
}
```

### 2.2 Authentication Middleware

**File: `packages/server/src/middleware/auth.ts`** [new]

```typescript
/**
 * Authentication Middleware
 * Basic Auth for server security
 */

import type { Context, Next } from "hono"
import { basicAuth } from "hono/basic-auth"
import { createLogger } from "@ekacode/shared/logger"

const logger = createLogger("server:auth")

/**
 * Auth middleware options
 */
export interface AuthOptions {
  /**
   * Username for basic auth
   * @default "ekacode"
   */
  username?: string

  /**
   * Password for basic auth
   * If not provided, auth is disabled
   */
  password?: string

  /**
   * Skip auth for these paths
   */
  skipPaths?: string[]
}

/**
 * Create auth middleware
 *
 * @example
 * ```ts
 * app.use(authMiddleware({
 *   username: "ekacode",
 *   password: process.env.EKACODE_SERVER_PASSWORD
 * }))
 * ```
 */
export function authMiddleware(options: AuthOptions = {}) {
  const {
    username = "ekacode",
    password,
    skipPaths = ["/health", "/api/health"]
  } = options

  // If no password, skip auth
  if (!password) {
    logger.warn("No password set, auth disabled")
    return async (_c: Context, next: Next) => next()
  }

  const basicAuthMiddleware = basicAuth({
    username,
    password
  })

  return async (c: Context, next: Next) => {
    // Skip auth for specified paths
    if (skipPaths.includes(c.req.path)) {
      return next()
    }

    return basicAuthMiddleware(c, next)
  }
}
```

### 2.3 Error Handling Middleware

**File: `packages/server/src/middleware/error.ts`** [new]

```typescript
/**
 * Error Handling Middleware
 * Centralized error handling for all routes
 */

import type { ErrorHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { createLogger } from "@ekacode/shared/logger"
import { ZodError } from "zod"

const logger = createLogger("server:error")

/**
 * Global error handler
 *
 * Catches all errors and returns consistent JSON responses
 */
export const errorHandler: ErrorHandler = (err, c) => {
  // Log error
  logger.error("Request error", {
    path: c.req.path,
    method: c.req.method,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  })

  // Hono HTTP exceptions
  if (err instanceof HTTPException) {
    return c.json(
      {
        error: err.message,
        status: err.status
      },
      err.status
    )
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    return c.json(
      {
        error: "Validation error",
        details: err.errors
      },
      400
    )
  }

  // Permission errors
  if (err instanceof Error && err.name === "PermissionDeniedError") {
    return c.json(
      {
        error: "Permission denied",
        message: err.message
      },
      403
    )
  }

  // Default error response
  return c.json(
    {
      error: "Internal server error",
      message: err instanceof Error ? err.message : String(err)
    },
    500
  )
}
```

### 2.4 Prompt Route

**File: `packages/server/src/routes/prompt.ts`** [new]

```typescript
/**
 * Prompt Route
 * Main endpoint for AI agent interactions
 */

import { Hono } from "hono"
import { streamText } from "ai"
import { z } from "zod"
import { Instance } from "@ekacode/core/instance"
import { createLogger } from "@ekacode/shared/logger"
import { createToolLoopAgent } from "@ekacode/core/agents"
import { createTools } from "@ekacode/core/tools"

const logger = createLogger("server:prompt")

const app = new Hono()

/**
 * Request schema for /api/prompt
 */
const promptRequestSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  model: z.object({
    provider: z.enum(["anthropic", "openai", "google"]),
    model: z.string()
  }).optional(),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().positive().optional().default(8192)
})

/**
 * POST /api/prompt
 *
 * Main endpoint for sending messages to the AI agent.
 * Directory context is automatically set by middleware.
 *
 * @example
 * ```bash
 * curl -X POST http://localhost:4096/api/prompt?directory=%2Fhome%2Fuser%2Fproject \
 *   -H "Authorization: Basic ..." \
 *   -H "Content-Type: application/json" \
 *   -d '{"message": "Read package.json and list dependencies"}'
 * ```
 */
app.post("/api/prompt", async (c) => {
  const directory = Instance.directory
  const requestId = crypto.randomUUID()

  logger.info("Prompt request", {
    requestId,
    directory
  })

  try {
    // Parse and validate request
    const body = await c.req.json()
    const input = promptRequestSchema.parse(body)

    // Create agent with directory-aware tools
    const tools = await createTools()

    const agent = createToolLoopAgent({
      model: getModel(input.model),
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      tools,
      sessionId: input.sessionId ?? crypto.randomUUID()
    })

    // Stream response
    return streamText(agent, {
      prompt: input.message,
      onFinish: () => {
        logger.info("Prompt completed", {
          requestId,
          directory
        })
      }
    }).toAIStreamResponse()

  } catch (error) {
    logger.error("Prompt error", {
      requestId,
      directory,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
})

/**
 * POST /api/prompt/stream
 *
 * Alternative endpoint that uses Server-Sent Events
 */
app.post("/api/prompt/stream", async (c) => {
  const body = await c.req.json()
  const input = promptRequestSchema.parse(body)

  const tools = await createTools()
  const agent = createToolLoopAgent({
    model: getModel(input.model),
    tools,
    sessionId: input.sessionId
  })

  const result = await streamText(agent, {
    prompt: input.message
  })

  // Convert to SSE stream
  return c.streamText(async (stream) => {
    for await (const chunk of result.textStream) {
      await stream.write(chunk)
    }
  })
})

/**
 * Get model configuration
 */
function getModel(input?: { provider: string; model: string }) {
  if (!input) {
    return {
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022"
    }
  }

  return {
    provider: input.provider,
    model: input.model
  }
}

export default app
```

### 2.5 Health Check Route

**File: `packages/server/src/routes/health.ts`** [new]

```typescript
/**
 * Health Check Route
 */

import { Hono } from "hono"
import { Instance } from "@ekacode/core/instance"

const app = new Hono()

/**
 * GET /health
 * GET /api/health
 *
 * Health check endpoint
 */
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: Date.now(),
    version: process.env.npm_package_version ?? "0.0.0"
  })
})

/**
 * GET /api/workspace
 *
 * Get current workspace information
 */
app.get("/api/workspace", (c) => {
  return c.json({
    directory: Instance.directory,
    project: Instance.project,
    vcs: Instance.vcs,
    inContext: Instance.inContext
  })
})

export default app
```

### 2.6 Main Server File

**File: `packages/server/src/index.ts`** [existing] (Modified)

```typescript
/**
 * Ekacode Server
 * Main HTTP server with directory context middleware
 */

import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { createLogger } from "@ekacode/shared/logger"

// Middleware
import { directoryContextMiddleware } from "./middleware/directory-context"
import { authMiddleware } from "./middleware/auth"
import { errorHandler } from "./middleware/error"

// Routes
import promptRoutes from "./routes/prompt"
import healthRoutes from "./routes/health"
import permissionsRoutes from "./routes/permissions"
import rulesRoutes from "./routes/rules"
import eventsRoutes from "./routes/events"

const log = createLogger("server")

// Create Hono app
const app = new Hono()

// Error handler (must be first)
app.onError(errorHandler)

// CORS
app.use("*", cors({
  origin: ["http://localhost:5173", "http://localhost:4096", "tauri://localhost"],
  credentials: true
}))

// Request logging
app.use("*", logger())

// Health check (before auth)
app.route("/", healthRoutes)

// Auth middleware
app.use("*", authMiddleware({
  username: process.env.EKACODE_SERVER_USERNAME ?? "ekacode",
  password: process.env.EKACODE_SERVER_PASSWORD
}))

// Directory context middleware (applies to all routes below)
app.use("*", directoryContextMiddleware())

// API routes
app.route("/", promptRoutes)
app.route("/", permissionsRoutes)
app.route("/", rulesRoutes)
app.route("/", eventsRoutes)

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404)
})

/**
 * Start server
 */
export interface ServerOptions {
  port?: number
  hostname?: string
  password?: string
}

export async function startServer(options: ServerOptions = {}) {
  const {
    port = 4096,
    hostname = "localhost"
  } = options

  const server = serve({
    fetch: app.fetch,
    port,
    hostname
  })

  log.info(`Server started on http://${hostname}:${port}`)

  return server
}

// Export app for testing
export { app }

// Start server if running directly
if (require.main === module) {
  startServer({
    port: parseInt(process.env.PORT ?? "4096", 10),
    password: process.env.EKACODE_SERVER_PASSWORD
  })
}
```

### 2.7 Package Dependencies

**File: `packages/server/package.json`** [existing] (Add dependencies)

```json
{
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.8.0",
    "ai": "^3.4.0",
    "zod": "^3.22.0",
    "@ekacode/core": "workspace:*",
    "@ekacode/shared": "workspace:*",
    "@ekacode/shared/logger": "workspace:*"
  }
}
```

### Testing Phase 2

**File: `packages/server/src/middleware/directory-context.test.ts`** [new]

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Hono } from "hono"
import { directoryContextMiddleware } from "./directory-context"
import { Instance } from "@ekacode/core/instance"
import { mkdir, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("directoryContextMiddleware", () => {
  const testDir = join(tmpdir(), "ekacode-test-" + Date.now())
  let app: Hono

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true })

    app = new Hono()
    app.use("*", directoryContextMiddleware())
    app.get("/test", (c) => {
      return c.json({ directory: Instance.directory })
    })
  })

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it("should extract directory from query parameter", async () => {
    const res = await app.request(`/test?directory=${encodeURIComponent(testDir)}`)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.directory).toBe(testDir)
  })

  it("should extract directory from header", async () => {
    const res = await app.request("/test", {
      headers: {
        "x-ekacode-directory": testDir
      }
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.directory).toBe(testDir)
  })

  it("should decode URL-encoded directory", async () => {
    const encoded = encodeURIComponent(testDir)
    const res = await app.request(`/test?directory=${encoded}`)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.directory).toBe(testDir)
  })
})
```

---

## Phase 3: Tools & Workspace

### Objective
Update tools to use `Instance.directory` for path resolution.

### Files to Modify

```
packages/core/src/tools/ [existing]
├── filesystem/ [existing]
│   ├── read.ts [existing]          # Use Instance.directory
│   ├── write.ts [existing]         # Use Instance.directory
│   ├── edit.ts [existing]          # Use Instance.directory
│   ├── glob.ts [existing]          # Use Instance.directory
├── shell/ [existing]
│   └── bash.tool.ts [existing]     # Execute in Instance.directory
└── index.ts [existing]             # Tool registry
```

### 3.1 Filesystem Tools

**File: `packages/core/src/tools/filesystem/read.ts`** [existing]

```typescript
/**
 * Read File Tool
 * Reads file content relative to Instance.directory
 */

import { readFile } from "fs/promises"
import { join } from "path"
import { Instance } from "../../instance"
import { tool } from "ai"

/**
 * Read file content
 * @param relativePath - Path relative to Instance.directory
 * @returns File content
 */
export async function readFileContent(relativePath: string): Promise<string> {
  const directory = Instance.directory
  const fullPath = join(directory, relativePath)

  try {
    return await readFile(fullPath, "utf-8")
  } catch (error) {
    throw new Error(
      `Failed to read file: ${relativePath}\n${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * AI SDK tool definition
 */
export const readTool = tool({
  description: "Read the contents of a file",
  parameters: z.object({
    path: z.string().describe("Path to the file, relative to the project directory")
  }),
  execute: async ({ path }) => {
    return {
      path,
      content: await readFileContent(path)
    }
  }
})
```

**File: `packages/core/src/tools/filesystem/write.ts`** [existing]

```typescript
/**
 * Write File Tool
 * Writes file content relative to Instance.directory
 */

import { writeFile, mkdir } from "fs/promises"
import { join, dirname } from "path"
import { Instance } from "../../instance"
import { tool } from "ai"
import { z } from "zod"

/**
 * Write file content
 * @param relativePath - Path relative to Instance.directory
 * @param content - File content
 */
export async function writeFileContent(
  relativePath: string,
  content: string
): Promise<void> {
  const directory = Instance.directory
  const fullPath = join(directory, relativePath)

  try {
    // Create directory if it doesn't exist
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, "utf-8")
  } catch (error) {
    throw new Error(
      `Failed to write file: ${relativePath}\n${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * AI SDK tool definition
 */
export const writeTool = tool({
  description: "Write content to a file, creating directories if needed",
  parameters: z.object({
    path: z.string().describe("Path to the file, relative to the project directory"),
    content: z.string().describe("Content to write to the file")
  }),
  execute: async ({ path, content }) => {
    await writeFileContent(path, content)
    return {
      path,
      success: true
    }
  }
})
```

**File: `packages/core/src/tools/filesystem/edit.ts`** [existing]

```typescript
/**
 * Edit File Tool
 * Performs string replacements in files
 */

import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import { Instance } from "../../instance"
import { tool } from "ai"
import { z } from "zod"

/**
 * Edit file with string replacement
 */
export async function editFile(
  relativePath: string,
  oldText: string,
  newText: string
): Promise<void> {
  const directory = Instance.directory
  const fullPath = join(directory, relativePath)

  try {
    const content = await readFile(fullPath, "utf-8")

    if (!content.includes(oldText)) {
      throw new Error(`Text not found in file: ${oldText}`)
    }

    const newContent = content.replace(oldText, newText)
    await writeFile(fullPath, newContent, "utf-8")
  } catch (error) {
    throw new Error(
      `Failed to edit file: ${relativePath}\n${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * AI SDK tool definition
 */
export const editTool = tool({
  description: "Replace text in a file. Both oldText and newText must match exactly.",
  parameters: z.object({
    path: z.string().describe("Path to the file, relative to the project directory"),
    oldText: z.string().describe("Exact text to replace"),
    newText: z.string().describe("New text to insert")
  }),
  execute: async ({ path, oldText, newText }) => {
    await editFile(path, oldText, newText)
    return {
      path,
      success: true
    }
  }
})
```

**File: `packages/core/src/tools/filesystem/glob.ts`** [existing]

```typescript
/**
 * Glob Tool
 * Find files matching patterns
 */

import { glob } from "glob"
import { join } from "path"
import { Instance } from "../../instance"
import { tool } from "ai"
import { z } from "zod"

/**
 * Find files matching pattern
 */
export async function globFiles(pattern: string): Promise<string[]> {
  const directory = Instance.directory

  // Ensure pattern is relative to directory
  const fullPattern = join(directory, pattern)

  try {
    const files = await glob(fullPattern, {
      windowsPathsNoEscape: true,
      absolute: false
    })

    // Return relative paths
    return files.map(f => f.replace(directory + "/", ""))
  } catch (error) {
    throw new Error(
      `Failed to glob files: ${pattern}\n${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * AI SDK tool definition
 */
export const globTool = tool({
  description: "Find files matching a pattern (e.g., '**/*.ts', 'src/**/*.tsx')",
  parameters: z.object({
    pattern: z.string().describe("Glob pattern (e.g., '**/*.ts', 'src/**/*.test.ts')")
  }),
  execute: async ({ pattern }) => {
    const files = await globFiles(pattern)
    return {
      pattern,
      files
    }
  }
})
```

**File: `packages/core/src/tools/index.ts`** [existing]

```typescript
/**
 * Filesystem Tools Export
 */

export { readTool, readFileContent } from "./filesystem/read"
export { writeTool, writeFileContent } from "./filesystem/write"
export { editTool, editFile } from "./filesystem/edit"
export { globTool, globFiles } from "./filesystem/glob"
```

### 3.2 Shell Tools

**File: `packages/core/src/tools/shell/bash.tool.ts`** [existing]

```typescript
/**
 * Bash Tool
 * Execute shell commands in Instance.directory
 */

import { exec } from "child_process"
import { promisify } from "util"
import { Instance } from "../../instance"
import { tool } from "ai"
import { z } from "zod"

const execAsync = promisify(exec)

/**
 * Execute shell command
 */
export async function executeCommand(
  command: string,
  options?: {
    timeout?: number
    env?: Record<string, string>
  }
): Promise<{
  stdout: string
  stderr: string
  exitCode: number
}> {
  const directory = Instance.directory

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: directory,
      timeout: options?.timeout ?? 30000,
      env: { ...process.env, ...options?.env }
    })

    return {
      stdout,
      stderr,
      exitCode: 0
    }
  } catch (error: any) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? String(error),
      exitCode: error.code ?? 1
    }
  }
}

/**
 * AI SDK tool definition
 */
export const bashTool = tool({
  description: "Execute a shell command in the project directory",
  parameters: z.object({
    command: z.string().describe("Shell command to execute"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)")
  }),
  execute: async ({ command, timeout }) => {
    const result = await executeCommand(command, { timeout })
    return {
      command,
      ...result
    }
  }
})
```

### 3.3 Tool Registry

**File: `packages/core/src/tools/index.ts`** [existing]

```typescript
/**
 * Tool Registry
 * Creates and manages all AI SDK tools with directory context
 */

import { readTool } from "./filesystem/read"
import { writeTool } from "./filesystem/write"
import { editTool } from "./filesystem/edit"
import { globTool } from "./filesystem/glob"
import { bashTool } from "./shell/bash"
import type { Tool } from "ai"

/**
 * All available tools
 */
export const TOOL_REGISTRY = {
  read: readTool,
  write: writeTool,
  edit: editTool,
  glob: globTool,
  bash: bashTool
} as const

export type ToolName = keyof typeof TOOL_REGISTRY

/**
 * Create tools object for AI SDK
 */
export function createTools(toolNames?: ToolName[]): Record<string, Tool> {
  const tools = toolNames ?? Object.keys(TOOL_REGISTRY) as ToolName[]

  return tools.reduce((acc, name) => {
    acc[name] = TOOL_REGISTRY[name]
    return acc
  }, {} as Record<string, Tool>)
}

/**
 * Get default tools
 */
export function getDefaultTools(): Record<string, Tool> {
  return createTools(["read", "write", "edit", "bash"])
}
```

---

## Phase 4: Agent System

### Objective
Implement XState Plan/Build agents (planner/coder) that use HybridAgent for multimodal routing and directory-aware tools.

### Files to Create/Modify

```
packages/core/src/agents/ [existing]
├── planner.ts [existing]            # Plan agent (XState actor)
├── coder.ts [existing]              # Build agent (XState actor)
├── core/ [existing]
│   └── tool-loop-agent.ts [new]    # Optional/legacy ToolLoopAgent reference
├── hybrid-agent/ [existing]         # HybridAgent (multimodal routing)
├── prompts.ts [new]            # System prompts
└── index.ts [existing]              # Export
```

### 4.1 Plan/Build Agents (Current Structure)

**Note**: The primary entry points are `packages/core/src/agents/planner.ts` and
`packages/core/src/agents/coder.ts`, which orchestrate XState loops and delegate
model execution to HybridAgent. The ToolLoopAgent below is retained as a
reference implementation only.

**File: `packages/core/src/agents/core/tool-loop-agent.ts`** [new]

```typescript
/**
 * Tool Loop Agent
 * AI SDK v6 based agent with directory-aware tools
 */

import {
  streamText,
  type CoreMessage,
  type Tool,
  type ToolCallOptions
} from "ai"
import { createTools } from "../tools"
import { Instance } from "../instance"
import { getDefaultSystemPrompt } from "./prompts"
import { createAnthropicProvider } from "@ai-sdk/anthropic"
import { createOpenAIProvider } from "@ai-sdk/openai"
import { createGoogleGenerativeAIProvider } from "@ai-sdk/google"

/**
 * Agent configuration
 */
export interface AgentConfig {
  /**
   * Model to use
   */
  model: {
    provider: "anthropic" | "openai" | "google"
    model: string
  }

  /**
   * Tools to use
   */
  tools?: Record<string, Tool>

  /**
   * System prompt
   */
  systemPrompt?: string

  /**
   * Temperature
   */
  temperature?: number

  /**
   * Max tokens
   */
  maxTokens?: number

  /**
   * Session ID for conversation history
   */
  sessionId?: string
}

/**
 * Create agent with AI SDK
 */
export function createToolLoopAgent(config: AgentConfig) {
  const {
    model,
    tools = createTools(),
    systemPrompt = getDefaultSystemPrompt(),
    temperature = 0.7,
    maxTokens = 8192
  } = config

  // Get model provider
  const provider = getModelProvider(model.provider)

  return {
    /**
     * Stream text with tool execution
     */
    async stream(message: string, options?: ToolCallOptions) {
      // Check we're in directory context
      if (!Instance.inContext) {
        throw new Error(
          "Agent must be called within Instance.provide({ directory, fn })"
        )
      }

      // Build messages
      const messages: CoreMessage[] = [
        {
          role: "system",
          content: systemPrompt
            .replace("{{directory}}", Instance.directory)
            .replace("{{project}}", Instance.project?.name ?? "unknown")
        },
        {
          role: "user",
          content: message
        }
      ]

      // Stream with tools
      return streamText({
        model: provider(model.model),
        messages,
        tools,
        temperature,
        maxTokens,
        ...options
      })
    }
  }
}

/**
 * Get model provider
 */
function getModelProvider(provider: string) {
  switch (provider) {
    case "anthropic":
      return createAnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY
      })
    case "openai":
      return createOpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY
      })
    case "google":
      return createGoogleGenerativeAIProvider({
        apiKey: process.env.GOOGLE_API_KEY
      })
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}
```

### 4.2 System Prompts

**File: `packages/core/src/agents/prompts.ts`** [new]

```typescript
/**
 * System Prompts
 * Default system prompt for the AI agent
 */

/**
 * Get default system prompt
 */
export function getDefaultSystemPrompt(): string {
  return `You are Ekacode, an AI coding assistant powered by Claude.

## Current Context
- Working directory: {{directory}}
- Project: {{project}}

## Your Capabilities
You can help with:
- Reading and writing files
- Editing code with precise replacements
- Running shell commands (git, npm, tests, etc.)
- Searching for files with glob patterns
- Explaining code and architecture

## Your Guidelines
1. **Be precise**: Use edit tool for exact text replacements
2. **Show your work**: Read files before editing them
3. **Think step by step**: Break complex tasks into smaller steps
4. **Respect permissions**: Some operations may require user approval
5. **Stay in scope**: Work within the current project directory

## Tool Usage
- **read**: Read file contents before editing
- **write**: Create new files or completely replace existing ones
- **edit**: Replace specific text in files (preferred for small changes)
- **bash**: Run commands (git, npm, test, etc.)
- **glob**: Find files by pattern

## Security
- Never bypass permission checks
- Don't execute commands without user understanding
- Report suspicious activity to the user`
}
```

### 4.3 Agent Export

**File: `packages/core/src/agents/index.ts`** [existing]

```typescript
/**
 * Agents Module
 */

export { createToolLoopAgent } from "./tool-loop-agent"
export { getDefaultSystemPrompt } from "./prompts"
export type { AgentConfig } from "./tool-loop-agent"
```

---

## Phase 5: Electron Desktop

### Objective
Implement Electron main process with server integration and IPC bridge.

### Files to Create/Modify

```
packages/desktop/ [existing]
├── src/ [existing]
│   ├── main/ [existing]
│   │   ├── index.ts [existing]           # Main process entry
│   │   ├── server.ts [new]          # Server management
│   │   └── ipc.ts [new]             # IPC handlers
│   ├── preload/ [existing]
│   │   └── index.ts [existing]           # Preload script
│   └── package.json [new]
└── electron-builder.json [new]      # Build config
```

### 5.1 Main Process

**File: `packages/desktop/src/main/index.ts`** [existing]

```typescript
/**
 * Electron Main Process
 */

import { app, BrowserWindow, ipcMain } from "electron"
import { join } from "path"
import { startServer } from "@ekacode/server"
import { setupIPCHandlers } from "./ipc"
import { createLogger } from "@ekacode/shared/logger"

const logger = createLogger("desktop:main")

let mainWindow: BrowserWindow | null = null
let serverPort = 4096
let serverPassword: string

/**
 * Create main window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: "#1e1e1e",
    titleBarStyle: "hiddenInset"
  })

  // Load renderer
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173")
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

/**
 * Initialize server
 */
async function initServer() {
  // Generate random password
  serverPassword = generatePassword()

  try {
    await startServer({
      port: serverPort,
      password: serverPassword
    })

    logger.info("Server started", {
      port: serverPort,
      hasPassword: !!serverPassword
    })
  } catch (error) {
    logger.error("Failed to start server", error)
    throw error
  }
}

/**
 * Generate random password
 */
function generatePassword(length = 32): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let result = ""
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * App ready
 */
app.whenReady().then(async () => {
  logger.info("Application starting")

  // Start server
  await initServer()

  // Setup IPC handlers
  setupIPCHandlers({ serverPort, serverPassword })

  // Create window
  createWindow()

  logger.info("Application ready")
})

/**
 * Quit when all windows closed (except macOS)
 */
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

/**
 * Create window on activate (macOS)
 */
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

/**
 * Cleanup before quit
 */
app.on("before-quit", () => {
  logger.info("Application quitting")
})
```

### 5.2 IPC Handlers

**File: `packages/desktop/src/main/ipc.ts`** [new]

```typescript
/**
 * IPC Handlers
 * Bridge between renderer and main process
 */

import { ipcMain, dialog, shell } from "electron"
import { open } from "fs/promises"
import { createLogger } from "@ekacode/shared/logger"

const logger = createLogger("desktop:ipc")

interface IPCHandlersOptions {
  serverPort: number
  serverPassword: string
}

/**
 * Setup IPC handlers
 */
export function setupIPCHandlers(options: IPCHandlersOptions) {
  /**
   * Get server info
   */
  ipcMain.handle("server:getInfo", () => ({
    url: `http://localhost:${options.serverPort}`,
    password: options.serverPassword
  }))

  /**
   * Open project directory dialog
   */
  ipcMain.handle("dialog:openDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Project Directory"
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  /**
   * Open file dialog
   */
  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      title: "Select File"
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  /**
   * Save file dialog
   */
  ipcMain.handle("dialog:saveFile", async (event, options?: { defaultPath?: string }) => {
    const result = await dialog.showSaveDialog({
      title: "Save File",
      defaultPath: options?.defaultPath
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    return result.filePath
  })

  /**
   * Open external URL
   */
  ipcMain.handle("shell:openExternal", async (event, url: string) => {
    await shell.openExternal(url)
  })

  /**
   * Show item in folder
   */
  ipcMain.handle("shell:showItemInFolder", async (event, fullPath: string) => {
    shell.showItemInFolder(fullPath)
  })

  /**
   * Get app version
   */
  ipcMain.handle("app:getVersion", () => {
    return process.env.npm_package_version ?? "0.0.0"
  })

  /**
   * Get app platform
   */
  ipcMain.handle("app:getPlatform", () => {
    return process.platform
  })

  logger.info("IPC handlers registered")
}
```

### 5.3 Preload Script

**File: `packages/desktop/src/preload/index.ts`** [existing]

```typescript
/**
 * Preload Script
 * Exposes safe IPC API to renderer
 */

import { contextBridge, ipcRenderer } from "electron"

/**
 * Ekacode API exposed to renderer
 */
const ekacodeAPI = {
  // Server
  server: {
    getInfo: () => ipcRenderer.invoke("server:getInfo")
  },

  // Dialogs
  dialog: {
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
    openFile: () => ipcRenderer.invoke("dialog:openFile"),
    saveFile: (options?: { defaultPath?: string }) =>
      ipcRenderer.invoke("dialog:saveFile", options)
  },

  // Shell
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
    showItemInFolder: (fullPath: string) =>
      ipcRenderer.invoke("shell:showItemInFolder", fullPath)
  },

  // App
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    getPlatform: () => ipcRenderer.invoke("app:getPlatform")
  },

  // Events (renderer → main)
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = ["permission:request", "server:error"]
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    }
  },

  // Remove listener
  removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback as any)
  }
}

// Expose to window
contextBridge.exposeInMainWorld("ekacodeAPI", ekacodeAPI)

// Type definitions for TypeScript
export type EkacodeAPI = typeof ekacodeAPI

declare global {
  interface Window {
    ekacodeAPI: EkacodeAPI
  }
}
```

### 5.4 Package.json

**File: `packages/desktop/package.json`** [existing]

```json
{
  "name": "@ekacode/desktop",
  "version": "0.0.1",
  "main": "dist/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "electron:dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
    "electron:build": "npm run build && electron-builder"
  },
  "dependencies": {
    "@ekacode/server": "workspace:*",
    "@ekacode/shared/logger": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@vitejs/plugin-react": "^4.2.0",
    "concurrently": "^8.2.0",
    "electron": "^28.0.0",
    "electron-builder": "^24.9.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "wait-on": "^7.2.0"
  },
  "build": {
    "appId": "com.ekacode.app",
    "productName": "Ekacode",
    "directories": {
      "output": "dist-electron"
    },
    "files": [
      "dist/**/*"
    ],
    "mac": {
      "category": "public.app-category.developer-tools"
    },
    "win": {
      "target": ["nsis"]
    },
    "linux": {
      "target": ["AppImage", "deb"]
    }
  }
}
```

### 5.5 TypeScript Config

**File: `packages/desktop/tsconfig.json`** [existing]

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "lib": ["ESNext"],
    "moduleResolution": "bundler",
    "types": ["node", "vite/client"],
    "skipLibCheck": true,
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

---

## Phase 6: Renderer UI

### Objective
Build React UI for project selection, chat interface, and permission dialogs.

### Files to Create

```
packages/desktop/src/renderer/src/ [existing]
├── main.tsx [existing]               # Entry point
├── App.tsx [existing]                # Main app
├── components/ [new]
│   ├── ProjectSelector.tsx [new]
│   ├── ChatInterface.tsx [new]
│   ├── PermissionDialog.tsx [new]
│   └── Settings.tsx [new]
├── hooks/ [new]
│   ├── useServer.ts [new]       # Server connection
│   └── usePrompt.ts [new]       # Prompt API
├── lib/ [new]
│   └── api.ts [new]             # API client
└── assets/ [existing]
    └── main.css [existing]
```

### 6.1 API Client

**File: `packages/desktop/src/renderer/src/lib/api.ts`** [new]

```typescript
/**
 * API Client
 * HTTP client with auth and directory context
 */

interface ServerInfo {
  url: string
  password: string
}

class APIClient {
  private serverInfo: ServerInfo | null = null

  /**
   * Initialize with server info
   */
  async init() {
    this.serverInfo = await window.ekacodeAPI.server.getInfo()
  }

  /**
   * Get auth headers
   */
  private getHeaders(): HeadersInit {
    if (!this.serverInfo) {
      throw new Error("Server not initialized")
    }

    const auth = btoa(`ekacode:${this.serverInfo.password}`)

    return {
      "Content-Type": "application/json",
      "Authorization": `Basic ${auth}`
    }
  }

  /**
   * Send prompt
   */
  async prompt(directory: string, message: string, signal?: AbortSignal) {
    if (!this.serverInfo) {
      throw new Error("Server not initialized")
    }

    const url = new URL(`${this.serverInfo.url}/api/prompt`)
    url.searchParams.set("directory", encodeURIComponent(directory))

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ message }),
      signal
    })

    if (!response.ok) {
      throw new Error(`Prompt failed: ${response.statusText}`)
    }

    return response.body
  }

  /**
   * Get workspace info
   */
  async getWorkspace(directory: string) {
    if (!this.serverInfo) {
      throw new Error("Server not initialized")
    }

    const url = new URL(`${this.serverInfo.url}/api/workspace`)
    url.searchParams.set("directory", encodeURIComponent(directory))

    const response = await fetch(url.toString(), {
      headers: this.getHeaders()
    })

    if (!response.ok) {
      throw new Error(`Get workspace failed: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Health check
   */
  async healthCheck() {
    if (!this.serverInfo) {
      throw new Error("Server not initialized")
    }

    const response = await fetch(`${this.serverInfo.url}/health`, {
      headers: this.getHeaders()
    })

    return response.ok
  }
}

export const api = new APIClient()
```

### 6.2 Server Hook

**File: `packages/desktop/src/renderer/src/hooks/useServer.ts`** [new]

```typescript
/**
 * useServer Hook
 * Manage server connection state
 */

import { useState, useEffect } from "react"
import { api } from "../lib/api"

export function useServer() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        await api.init()

        const healthy = await api.healthCheck()
        if (mounted && healthy) {
          setReady(true)
          setError(null)
        } else if (mounted) {
          setError("Server health check failed")
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }

    init()

    return () => {
      mounted = false
    }
  }, [])

  return { ready, error }
}
```

### 6.3 Prompt Hook

**File: `packages/desktop/src/renderer/src/hooks/usePrompt.ts`** [new]

```typescript
/**
 * usePrompt Hook
 * Send prompts and stream responses
 */

import { useState, useRef, useCallback } from "react"
import { api } from "../lib/api"

export function usePrompt() {
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState("")
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const prompt = useCallback(async (directory: string, message: string) => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setLoading(true)
    setResponse("")
    setError(null)

    try {
      const stream = await api.prompt(directory, message, abortController.signal)

      if (!stream) {
        throw new Error("No response stream")
      }

      const reader = stream.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        const chunk = decoder.decode(value)
        setResponse(prev => prev + chunk)
      }

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Request was cancelled, ignore
        return
      }
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      abortControllerRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setLoading(false)
    }
  }, [])

  return { prompt, loading, response, error, cancel }
}
```

### 6.4 Project Selector

**File: `packages/desktop/src/renderer/src/components/ProjectSelector.tsx`** [new]

```typescript
/**
 * Project Selector Component
 */

import { useState } from "react"

interface ProjectSelectorProps {
  onProjectChange: (directory: string | null) => void
}

export function ProjectSelector({ onProjectChange }: ProjectSelectorProps) {
  const [projectPath, setProjectPath] = useState<string | null>(null)

  const handleSelectProject = async () => {
    const path = await window.ekacodeAPI.dialog.openDirectory()
    if (path) {
      setProjectPath(path)
      onProjectChange(path)
    }
  }

  return (
    <div className="project-selector">
      {projectPath ? (
        <div className="project-info">
          <span className="project-path">{projectPath}</span>
          <button onClick={() => {
            setProjectPath(null)
            onProjectChange(null)
          }}>
            Change
          </button>
        </div>
      ) : (
        <button onClick={handleSelectProject}>
          Open Project
        </button>
      )}
    </div>
  )
}
```

### 6.5 Chat Interface

**File: `packages/desktop/src/renderer/src/components/ChatInterface.tsx`** [new]

```typescript
/**
 * Chat Interface Component
 */

import { useState } from "react"
import { usePrompt } from "../hooks/usePrompt"

interface ChatInterfaceProps {
  projectPath: string | null
}

export function ChatInterface({ projectPath }: ChatInterfaceProps) {
  const [message, setMessage] = useState("")
  const { prompt, loading, response, error, cancel } = usePrompt()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!message.trim() || !projectPath || loading) return

    await prompt(projectPath, message)
    setMessage("")
  }

  if (!projectPath) {
    return (
      <div className="chat-interface disabled">
        <p>Please select a project first</p>
      </div>
    )
  }

  return (
    <div className="chat-interface">
      <div className="messages">
        {error && <div className="error">{error}</div>}
        {response && <div className="response">{response}</div>}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Ask me to do something..."
          disabled={loading}
        />
        {loading ? (
          <button type="button" onClick={cancel}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!message.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  )
}
```

### 6.6 Main App

**File: `packages/desktop/src/renderer/src/App.tsx`** [existing]

```typescript
/**
 * Main App Component
 */

import { useState } from "react"
import { useServer } from "./hooks/useServer"
import { ProjectSelector } from "./components/ProjectSelector"
import { ChatInterface } from "./components/ChatInterface"
import "./assets/main.css"

export function App() {
  const { ready, error: serverError } = useServer()
  const [projectPath, setProjectPath] = useState<string | null>(null)

  if (!ready) {
    return (
      <div className="app loading">
        <p>Loading Ekacode...</p>
        {serverError && <p className="error">{serverError}</p>}
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <h1>Ekacode</h1>
        <ProjectSelector onProjectChange={setProjectPath} />
      </header>

      <main>
        <ChatInterface projectPath={projectPath} />
      </main>
    </div>
  )
}
```

### 6.7 Entry Point

**File: `packages/desktop/src/renderer/src/main.tsx`** [existing]

```typescript
/**
 * Renderer Entry Point
 */

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

### 6.8 Styles

**File: `packages/desktop/src/renderer/src/assets/main.css`** [existing]

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #1e1e1e;
  color: #e0e0e0;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app.loading {
  display: flex;
  align-items: center;
  justify-content: center;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 2rem;
  border-bottom: 1px solid #333;
}

header h1 {
  font-size: 1.25rem;
}

main {
  flex: 1;
  overflow: auto;
}

.project-selector {
  display: flex;
  gap: 0.5rem;
}

.project-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.project-path {
  font-size: 0.875rem;
  opacity: 0.8;
}

button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  background: #3b82f6;
  color: white;
  cursor: pointer;
  font-size: 0.875rem;
}

button:hover {
  background: #2563eb;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-interface {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1rem;
}

.chat-interface.disabled {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
}

.messages {
  flex: 1;
  overflow: auto;
  margin-bottom: 1rem;
}

.response {
  white-space: pre-wrap;
  line-height: 1.6;
}

.error {
  color: #ef4444;
  margin-bottom: 1rem;
}

form {
  display: flex;
  gap: 0.5rem;
}

input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #333;
  border-radius: 4px;
  background: #2d2d2d;
  color: #e0e0e0;
}

input:focus {
  outline: none;
  border-color: #3b82f6;
}

input:disabled {
  opacity: 0.5;
}
```

---

## Testing Strategy

### Unit Tests

```bash
# Core
pnpm test --filter @ekacode/core

# Server
pnpm test --filter @ekacode/server

# Individual files
pnpm test packages/core/src/instance/index.test.ts
```

### Integration Tests

**File: `packages/server/src/index.test.ts`** [new]

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { app } from "./index"
import { mkdir, rm, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

describe("Server Integration", () => {
  const testDir = join(tmpdir(), "ekacode-integration-" + Date.now())

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true })
    await writeFile(join(testDir, "test.txt"), "Hello, World!")
  })

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it("should handle prompt with directory context", async () => {
    const response = await app.request(`/api/prompt?directory=${encodeURIComponent(testDir)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "List files in the current directory"
      })
    })

    expect(response.status).toBe(200)
  })
})
```

### E2E Tests

**File: `packages/desktop/e2e/main.spec.ts`** [new]

```typescript
import { test, expect } from "@playwright/test"

test.describe("Ekacode Desktop", () => {
  test("should open and select project", async () => {
    const app = await electron.launch()
    const window = await app.firstWindow()

    await expect(window).toHaveTitle(/Ekacode/)

    // Wait for ready
    await expect(window.locator(".app")).not.toHaveClass(/loading/)

    // Click open project (this would need actual file dialog handling)
    // For now, just verify button exists
    await expect(window.locator("text=Open Project")).toBeVisible()

    await app.close()
  })
})
```

---

## Deployment & Release

### Build Commands

```bash
# Build all packages
pnpm build

# Build desktop app
pnpm --filter @ekacode/desktop build

# Package for distribution
pnpm --filter @ekacode/desktop electron:build
```

### Release Checklist

- [ ] Update version in all package.json files
- [ ] Run full test suite
- [ ] Build desktop app for all platforms
- [ ] Test installed app
- [ ] Create GitHub release
- [ ] Upload artifacts

### Environment Variables

```bash
# Development
EKACODE_SERVER_PASSWORD=dev
ANTHROPIC_API_KEY=sk-ant-...

# Production
EKACODE_SERVER_PASSWORD=generated-random
ANTHROPIC_API_KEY=from-user-config
```

---

## Appendix: Quick Reference

### Directory Context Pattern

```typescript
// Middleware extracts directory
app.use("*", directoryContextMiddleware())

// All routes now have context
app.post("/api/prompt", async (c) => {
  const directory = Instance.directory  // Available!
  // ... agent logic
})
```

### Tool Implementation

```typescript
// Tool uses Instance.directory
export const readTool = tool({
  description: "Read file",
  parameters: z.object({
    path: z.string()
  }),
  execute: async ({ path }) => {
    const directory = Instance.directory  // Context-aware!
    const fullPath = join(directory, path)
    return readFile(fullPath, "utf-8")
  }
})
```

### Renderer API Call

```typescript
// Get server info
const { url, password } = await window.ekacodeAPI.server.getInfo()

// Send prompt with directory
const response = await fetch(`${url}/api/prompt?directory=${encodeURIComponent(projectPath)}`, {
  headers: {
    "Authorization": `Basic ${btoa(`ekacode:${password}`)}`
  },
  body: JSON.stringify({ message: "Read package.json" })
})
```

---

## Conclusion

This architecture provides:

1. **Clean Separation**: Core, server, and desktop are decoupled
2. **Directory Context**: Per-request directory handling
3. **Scalability**: Easy to add new tools, routes, and features
4. **Type Safety**: Full TypeScript support
5. **Testing**: Unit, integration, and E2E tests

Implementation order: Phase 1 → 2 → 3 → 4 → 5 → 6
