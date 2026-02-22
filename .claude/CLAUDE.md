# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sakti-code is a privacy-focused, offline-first AI coding agent that runs locally as an Electron application. It uses a monorepo architecture with **apps/** (Electron tiers) and **packages/** (business logic) coordinated by pnpm workspaces and Turbo for build orchestration.

**Architecture:** Migrated from `electron-vite` to **plain Vite** with custom watch orchestration (`scripts/watch.ts`). Packages build to `dist/` and are consumed by apps via `workspace:*` protocol.

## Development Commands

### Root Commands (run from project root)

```bash
pnpm dev              # Start Electron desktop app in dev mode
pnpm build            # Build all packages with Turbo
pnpm test             # Run all tests across packages
pnpm lint             # Lint all packages
pnpm typecheck        # Typecheck all packages
pnpm format           # Format with Prettier
pnpm format:check     # Check formatting
```

### Package-Specific Commands

**Desktop (Renderer - SolidJS):**

```bash
pnpm --filter @sakti-code/desktop dev      # Vite dev server (HMR on port 5173)
pnpm --filter @sakti-code/desktop build    # Build renderer only
pnpm --filter @sakti-code/desktop typecheck
```

**Electron (Main Process):**

```bash
pnpm --filter @sakti-code/electron build   # Build main process
```

**Preload (Context Bridge):**

```bash
pnpm --filter @sakti-code/preload build    # Build preload scripts
```

**Server (Hono API):**

```bash
pnpm --filter @sakti-code/server test              # Run tests
pnpm --filter @sakti-code/server test:run          # CI mode
pnpm --filter @sakti-code/server test:coverage     # Coverage report
pnpm --filter @sakti-code/server drizzle:generate  # Generate migrations
pnpm --filter @sakti-code/server drizzle:push      # Push schema to DB
```

**Core (Agents, Tools, Security):**

```bash
pnpm --filter @sakti-code/core test
pnpm --filter @sakti-code/core test:run
pnpm --filter @sakti-code/core test:coverage
```

### Single Test Execution

Use Vitest's `--testNamePattern` or `--testNamePattern` flag:

```bash
# Run a specific test file
pnpm --filter @sakti-code/core test tests/agents/hybrid-agent/e2e.test.ts

# Run tests matching a pattern
pnpm --filter @sakti-code/core test --testNamePattern "permission"
```

## Architecture

### Directory Structure (Post-Migration)

```
sakti-code/
├── apps/                    # Electron application tier
│   ├── electron/           # Main process (Node.js)
│   ├── preload/            # Preload scripts (context bridge)
│   └── desktop/            # Renderer process (SolidJS UI)
├── packages/                # Shared business logic tier
│   ├── core/               # Core agents, tools, security, Instance context
│   ├── server/             # Hono REST API server
│   ├── shared/             # Shared types, logger, utilities
│   └── zai/                # Z.ai provider integration
├── scripts/                 # Build orchestration scripts
│   └── watch.ts            # Dev watch script (multi-process coordination)
└── docs/                    # Documentation
```

### Three-Tier Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Electron App (Desktop)                     │
│  Main Process ↔ Preload (Context Bridge) ↔ Renderer (SolidJS UI)   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ IPC
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Hono REST API (Server)                      │
│  Chat / Events / Permissions / Rules routes                        │
│  Session Bridge Middleware (UUIDv7 session management)              │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
            ┌──────────┐ ┌──────────┐ ┌──────────┐
            │  libsql  │ │ Sessions │ │  Mastra  │
            │  (DB)    │ │   (DB)   │ │ Memory   │
            └──────────┘ └──────────┘ └──────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Core Logic (Core)                          │
│  Agents (Hybrid) │ Tools (FS, Shell, Search) │ Permissions         │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Patterns

**1. Monorepo Structure (pnpm workspaces)**

- **apps/** and **packages/** reference each other via `workspace:*` protocol
- Turbo orchestrates builds with caching and dependency ordering (`turbo.json`)
- Packages build to `dist/` before apps can consume them
- Native modules handled via regex externals at every level
- Version catalog in `pnpm-workspace.yaml` manages shared versions

**2. Plain Vite Architecture (migrated from electron-vite)**

- Separate Vite configs: `apps/electron/vite.config.ts`, `apps/preload/vite.config.ts`, `apps/desktop/vite.config.ts`
- Custom watch script (`scripts/watch.ts`) orchestrates multi-process dev mode:
  - Renderer: Vite dev server with HMR (port 5173)
  - Preload: Vite build watcher → triggers full renderer reload on change
  - Main: Vite build watcher → kills/restarts Electron on change
- Electron starts with Wayland optimizations: `--ozone-platform=wayland`

**3. IPC Communication (Electron)**

- Main → Preload → Renderer with context isolation
- Key IPC channels: `get-server-config`, `permission:response`, `fs:watch-*`
- Preload scripts expose safe APIs to renderer via context bridge

**4. Session Management**

- Session Bridge middleware manages sessions via `X-Session-ID` header
- UUIDv7 identifiers for time-ordered session IDs
- Database persistence in libsql (sessions table)
- Mastra memory integration for long-term context storage

**5. Permission System**

- Rule-based: `allow` > `deny` > `ask` (default)
- Configuration sources (priority order): env vars → `sakti-code.config.json` → `package.json` → defaults
- Glob pattern matching for file paths
- Event-driven approval flow with 30s timeout
- Git tools are auto-allowed, all others require permission

**6. Tool System**

- Tools wrapped in `ai.tool()` for AI SDK integration
- Registry exports all available tools for agent access
- Permission checks on every tool execution
- Workspace validation ensures operations stay within allowed directories

**7. Instance Context System (AsyncLocalStorage)**

- Replaces singleton `WorkspaceInstance` pattern
- Automatic context propagation through async call stacks
- `Instance.provide({ directory, fn })` establishes context boundary
- `Instance.context` provides `{ directory, sessionID, messageID, agent, abort }`
- `Instance.state.get/set()` for state management keyed by directory
- `Instance.bootstrap()` detects project info and VCS (git branch, etc.)
- Session Bridge middleware injects context for automatic workspace propagation

**8. Workspace Management**

- Path resolution with relative/absolute conversion
- External directory protection prevents escaping workspace
- Workspace detection from query/header/body in Session Bridge

**9. XState RLM Workflow (Recursive Language Model)**

- Hierarchical state machine for Plan/Build agent orchestration
- **Plan phase**: `analyze_code` → `research` → `design` (linear progression)
  - `analyze_code`: spawns Explore subagent for codebase analysis
  - `research`: multi-turn for web search + docs lookup
  - `design`: multi-turn for sequential thinking
- **Build phase**: `implement` ⇄ `validate` (recursive loop)
  - `implement`: runs Build agent for code changes
  - `validate`: runs Build agent with LSP tools for validation
  - Doom loop detection monitors oscillations and prevents infinite loops
- **Terminal states**: `done` (success) or `failed` (doom loop detected)

**10. Z.ai Provider Integration**

- Custom provider for Z.ai models (chat + vision)
- Hybrid Agent uses both text and vision models
- Integrated via AI SDK 6 with Mastra agent framework

### Data Flow Patterns

**Tool Execution:**

```
User Input → Tool Registry → AI Model → Tool Execute
  → Permission Check → Workspace Validation → FS Operation → Response
```

**Permission Request:**

```
Tool Request → PermissionManager → Rule Evaluation
  → (if ask) → Event Emission → Renderer IPC → User Response
    → handleResponse() → Cache Approval
```

**Session Handling:**

```
Request → Session Bridge (X-Session-ID header)
  → getSession/createSession → DB Persist → Instance.provide() → Handler
```

**Retry Rendering + Policy (Chat Parity):**

```
Transient upstream error
  → core emits "retry" event (attempt, message, next)
  → server publishPartEvent upserts ONE stable retry part per assistant message
  → desktop renders a single inline retry card (updates attempt/countdown, no stacking)
```

- Retry part must be **updated in-place** (same part ID), not appended per attempt.
- Countdown text states:
  - `retrying in Xm Ys` (future `next`)
  - `retrying now` (stale/past `next`)
  - `retrying shortly` (missing/invalid `next`)
- Retry backoff policy in core processor:
  - exponential `3s, 6s, 12s, ...`
  - max `10` retries for retryable transient failures.
- Do not add duplicate turn-footer actions for copy/retry/delete; markdown copy is already provided in markdown UI.

**Instance Context Propagation:**

```
Instance.provide({ directory, sessionID, fn })
  → AsyncLocalStorage context set
  → Tool executes with Instance.context available
  → { directory, sessionID, messageID, project, vcs } accessible
```

## Code Organization

### App Structure (Electron Tiers)

```
apps/
├── electron/             # Main process
│   ├── src/
│   │   └── index.ts      # Electron main entry
│   └── vite.config.ts    # SSR build config
├── preload/              # Preload scripts
│   ├── src/
│   │   └── index.ts      # Context bridge (saktiCodeAPI)
│   └── vite.config.ts    # CJS build config
└── desktop/              # Renderer (UI)
    ├── src/              # SolidJS components
    │   ├── assets/       # Global styles
    │   ├── components/   # Presentational components
    │   │   ├── permissions/
    │   │   └── shared/   # Shared UI primitives
    │   ├── core/         # Domain logic
    │   │   ├── chat/     # Chat domain
    │   │   │   ├── domain/   # Events, queries, commands
    │   │   │   ├── hooks/    # Chat hooks
    │   │   │   ├── services/ # Stream parsing
    │   │   │   └── types/    # Chat types
    │   │   ├── permissions/  # Permission hooks
    │   │   │   └── hooks/
    │   │   ├── services/     # External integrations
    │   │   │   ├── api/
    │   │   │   └── sse/
    │   │   ├── shared/       # Cross-domain utilities
    │   │   │   ├── logger/
    │   │   │   └── utils/
    │   │   └── state/        # State management
    │   │       ├── contexts/
    │   │       ├── hooks/
    │   │       ├── providers/
    │   │       └── stores/
    │   ├── utils/        # Utility functions
    │   └── views/        # Page components
    │       ├── home-view/
    │       │   └── components/
    │       ├── workspace-view/
    │       │   ├── left-side/
    │       │   └── right-side/
    │       └── settings-view.tsx
    ├── index.html
    └── vite.config.ts    # Client build config
```

### Package Structure

```
packages/
├── core/                 # Core business logic
│   ├── agents/           # AI agents (Hybrid, Coder, Planner)
│   ├── tools/            # Filesystem, shell, search, sequential-thinking
│   ├── security/         # Permission system (PermissionManager)
│   ├── instance/         # Instance context system (AsyncLocalStorage)
│   ├── state/            # XState RLM workflow machine
│   └── memory/           # Mastra memory integration
├── server/               # Hono REST API
│   ├── db/               # libsql database (sessions, tool_sessions, sequential-thinking)
│   ├── lib/              # Sequential-thinking DB helpers
│   ├── middleware/       # Session bridge, CORS, rate-limit, cache
│   └── routes/           # Chat, permissions, events, rules, workspace
├── shared/               # Shared types & utilities
│   ├── logger/           # Pino structured logger
│   ├── paths.ts          # App path resolution
│   └── types.ts          # Shared type definitions
└── zai/                  # Z.ai provider integration
    ├── chat/             # Chat API adaptations
    └── zai-provider.ts   # Provider factory
```

### Naming Conventions

- Packages: `@sakti-code/<name>` (scoped npm packages)
- Files: kebab-case (`bash.tool.ts`, `session-bridge.ts`)
- Test files: `<name>.test.ts` or `<name>.spec.ts`
- Tests located in `tests/` directory within each package

### Desktop Import Paths (tsconfig aliases)

The desktop app uses path aliases for cleaner imports:

| Alias             | Maps To                  |
| ----------------- | ------------------------ |
| `@/chat/*`        | `src/core/chat/*`        |
| `@/session/*`     | `src/core/session/*`     |
| `@/permissions/*` | `src/core/permissions/*` |
| `@/services/*`    | `src/core/services/*`    |
| `@/shared/*`      | `src/core/shared/*`      |
| `@/core/*`        | `src/core/*`             |
| `@/components`    | `src/components`         |
| `@/views`         | `src/views`              |

Example: `import { useChat } from "@/chat/hooks"` instead of relative imports

## Technologies

**Frontend:** Electron 39, SolidJS 1.9, Vite 7.2, Tailwind CSS 4
**Backend:** Hono 4.11, @hono/node-server, libsql, Drizzle ORM 0.45, Zod 4.3
**AI:** AI SDK 6, Mastra Core, Mastra Memory, XState 5, @mastra/fastembed
**Tools:** Vitest 4, Pino 9, Turbo 2, UUID v7, diff 8, tree-sitter, Glob 13
**Runtime:** Node.js 22, pnpm 10

## Quality Tools

**ESLint:** `@typescript-eslint/eslint-plugin`, targets ES2022
**Prettier:** 2-space tabs, 100 char width, import organization plugins
**Pre-commit:** lint-staged runs eslint and prettier on staged files
**Test Framework:** Vitest with setup files for database initialization

## Database

**libsql (SQLite):**

- Tables: `sessions` (UUIDv7, thread_id, resource_id), `tool_sessions`, `sequential-thinking`
- Drizzle ORM with schema in `packages/server/src/db/schema.ts`
- Migrations via `drizzle:generate` and `drizzle:push`

**Sequential Thinking Storage:**

- Session-based storage with UUIDv7 identifiers
- Session limits enforced (max sessions per user)
- Database persistence in `sequential-thinking` table

**Mastra Storage:**

- `sakti-code-store` - Message storage
- `sakti-code-vector` - Vector embeddings for semantic search

## Important Notes

- **Migration completed:** Plain Vite architecture (not electron-vite)
- **Privacy-focused:** All operations are local-only by default
- **Git tools** are automatically allowed; all other tools require permission approval
- **External directories** are protected via workspace validation
- **Wayland optimizations:** Electron starts with `--ozone-platform=wayland` flag
- **UUIDv7 identifiers:** Time-ordered, sortable session and message IDs
- **Instance context:** Use `Instance.provide()` for context-aware operations, not singleton pattern
- **Doom loop detection:** XState guards prevent infinite build-validate oscillations
- **Sequential thinking:** Tool with session-based storage and database persistence
