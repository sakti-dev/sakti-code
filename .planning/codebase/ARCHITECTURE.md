# Architecture

**Analysis Date:** 2026-02-22

## Pattern Overview

**Overall:** Layered Monorepo with Client-Server Architecture

**Key Characteristics:**

- Monorepo with pnpm workspaces and Turbo build orchestration
- Clear separation between server (Hono), core (Mastra agents), and desktop UI (Solid.js)
- Event-driven architecture with event bus for permission requests
- Database-backed session and memory system with SQLite

## Layers

**Apps Layer (Desktop UI):**

- Location: `apps/desktop/`
- Contains: Solid.js UI application
- Depends on: @ekacode/shared, @ekacode/server (via IPC)
- Used by: End users

**Packages Layer:**

- `@ekacode/server` - Backend API
  - Location: `packages/server/src/`
  - Contains: Hono routes, auth, database, event bus
  - Depends on: @ekacode/core, drizzle-orm

- `@ekacode/core` - Agent framework
  - Location: `packages/core/src/`
  - Contains: Mastra agents, tools, memory system
  - Depends on: @ai-sdk/\*, @mastra/core, zod

- `@ekacode/shared` - Shared utilities
  - Location: `packages/shared/src/`
  - Contains: Logger, event types, shutdown handler
  - Depends on: pino, zod

- `@ekacode/zai` - Custom AI provider
  - Location: `packages/zai/src/`
  - Contains: ZAI SDK implementation

- `@ekacode/memorable-name` - Utility
  - Location: `packages/memorable-name/`
  - Contains: Name generation utility

## Data Flow

**User Interaction Flow:**

1. User sends message in desktop app
2. Desktop app calls server via IPC/preload API
3. Server routes to chat handler in `packages/server/src/routes/chat.ts`
4. Chat handler invokes agent in `@ekacode/core`
5. Core processes with Mastra, calls tools as needed
6. Tools execute (filesystem, shell, search)
7. Results streamed back via SSE
8. Desktop app renders via Solid.js components

**Session Management Flow:**

1. Session created in `packages/server/src/routes/sessions.ts`
2. Session stored in SQLite via drizzle-orm
3. Messages stored in `db/messages` table
4. Events persisted to `db/events` for catch-up

**Permission Flow:**

1. Tool execution requires permission
2. PermissionManager emits "permission:request" event
3. Event bus publishes PermissionAsked event
4. Desktop app shows permission dialog
5. User approves/denies
6. Result propagated back to agent

## Key Abstractions

**Session:**

- Represents a conversation thread
- Examples: `packages/server/src/routes/sessions.ts`, `packages/server/db/sessions.ts`
- Pattern: Database-backed with UUIDv7 IDs

**Workspace:**

- Represents a git worktree/project
- Examples: `packages/server/db/workspaces.ts`
- Pattern: SQLite table with filesystem path

**Tools:**

- Executable actions (read/write files, run shell, search)
- Examples: `packages/core/src/tools/filesystem/read.ts`, `packages/core/src/tools/shell/bash.tool.ts`
- Pattern: Zod schema-defined input/output

**Memory System:**

- Observational, reflection, working memory
- Examples: `packages/core/src/memory/`
- Pattern: Database-backed with async buffering

## Entry Points

**Server Entry:**

- Location: `packages/server/src/index.ts`
- Triggers: `startServer()` function call
- Responsibilities: Initialize Hono app, middleware, routes, database

**Desktop Entry:**

- Location: `apps/desktop/src/main.tsx`
- Triggers: Vite dev server / Electron load
- Responsibilities: Render Solid.js app, register components

**Core Entry:**

- Location: `packages/core/src/index.ts`
- Exports: Agents, tools, memory system

## Error Handling

**Strategy:** Middleware-based with custom error handler

**Patterns:**

- Error handler middleware: `packages/server/src/middleware/error-handler.ts`
- Zod validation in routes
- PermissionDeniedError for security
- Error classification in `packages/core/src/session/error-classification.ts`

## Cross-Cutting Concerns

**Logging:** Pino logger via `@ekacode/shared/logger`

**Validation:** Zod schemas on all inputs

**Authentication:** Basic Auth middleware with session tokens

---

_Architecture analysis: 2026-02-22_
