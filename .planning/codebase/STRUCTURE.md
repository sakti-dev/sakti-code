# Codebase Structure

**Analysis Date:** 2026-02-22

## Directory Layout

```
ekacode/
├── apps/                          # Applications
│   ├── desktop/                   # Solid.js desktop UI
│   ├── electron/                  # Electron main process
│   └── preload/                   # Electron preload scripts
├── packages/                      # Shared packages
│   ├── core/                      # Mastra agents & tools
│   ├── server/                   # Hono API server
│   ├── shared/                   # Shared utilities
│   ├── zai/                      # Custom AI provider
│   └── memorable-name/            # Name utility
├── scripts/                       # Build/dev scripts
├── docs/                          # Documentation
├── logs/                          # Runtime logs
├── .github/                       # CI/CD configuration
├── turbo.json                     # Turbo build config
├── tsconfig.json                  # TypeScript config
├── pnpm-workspace.yaml            # pnpm workspaces
└── package.json                   # Root package
```

## Directory Purposes

**apps/desktop:**

- Purpose: Main UI application (Solid.js + Electron)
- Contains: Views, components, routes, state management
- Key files: `src/main.tsx`, `src/routes.tsx`, `vite.config.ts`

**apps/electron:**

- Purpose: Electron main process
- Contains: IPC handlers, window management
- Key files: `src/ipc.ts`

**apps/preload:**

- Purpose: Electron preload bridge
- Contains: Context bridge API
- Key files: `src/index.ts`

**packages/server:**

- Purpose: Backend API server
- Contains: Routes, middleware, database, auth
- Key files: `src/index.ts`, `db/schema.ts`, `src/routes/`

**packages/core:**

- Purpose: AI agents and tools
- Contains: Mastra setup, tools, memory system
- Key files: `src/index.ts`, `src/agent/`, `src/tools/`, `src/memory/`

**packages/shared:**

- Purpose: Shared utilities across packages
- Contains: Logger, event types, event guards, shutdown
- Key files: `src/logger/index.ts`, `src/event-types.ts`

**packages/zai:**

- Purpose: Custom ZAI provider SDK
- Contains: AI SDK implementation
- Key files: `src/index.ts`

## Key File Locations

**Entry Points:**

- Server: `packages/server/src/index.ts` - startServer() function
- Desktop: `apps/desktop/src/main.tsx` - Solid.js render
- Core: `packages/core/src/index.ts` - Exports all agents/tools

**Configuration:**

- Root tsconfig: `tsconfig.json`
- Vite configs: `apps/*/vite.config.ts`
- Database: `packages/server/drizzle.config.ts`

**Core Logic:**

- Agents: `packages/core/src/agent/`
- Tools: `packages/core/src/tools/`
- Memory: `packages/core/src/memory/`
- Routes: `packages/server/src/routes/`
- Database: `packages/server/db/`

**Testing:**

- Desktop tests: `apps/desktop/tests/`
- Server tests: `packages/server/tests/`
- Core tests: `packages/core/tests/`
- ZAI tests: `packages/zai/tests/`

## Naming Conventions

**Files:**

- Components: `kebab-case.tsx` (e.g., `chat-input.tsx`)
- Utilities: `kebab-case.ts` (e.g., `event-guards.ts`)
- Tests: `*.test.ts` or `*.spec.ts`
- Config: `kebab-case.config.ts`

**Directories:**

- All lowercase, kebab-case (e.g., `chat-area`, `event-bus`)

**Exports:**

- Barrel files: `index.ts` per directory

## Where to Add New Code

**New Feature in Desktop:**

- UI Components: `apps/desktop/src/components/`
- Views: `apps/desktop/src/views/`
- State: `apps/desktop/src/core/state/`
- Tests: `apps/desktop/tests/`

**New API Endpoint:**

- Route: `packages/server/src/routes/<name>.ts`
- Tests: `packages/server/tests/routes/`

**New Tool:**

- Implementation: `packages/core/src/tools/<category>/`
- Registration: `packages/core/src/tools/registry.ts`

**New Agent:**

- Implementation: `packages/core/src/agent/`
- Registration: `packages/core/src/agent/registry.ts`

**Database Schema:**

- Tables: `packages/server/db/schema.ts`
- Queries: `packages/server/db/`
- Migrations: `packages/server/db/migrations/`

## Special Directories

**db/ (packages/server):**

- Purpose: Database schema and queries
- Generated: Yes (via Drizzle)
- Committed: Schema yes, data no

**logs/:**

- Purpose: Runtime log files
- Generated: Yes (at runtime)
- Committed: No (.gitignored)

**node_modules/:**

- Purpose: Dependencies
- Generated: Yes (via pnpm install)
- Committed: No

---

_Structure analysis: 2026-02-22_
