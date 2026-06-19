## Why

sakti-code is a desktop coding agent app built with Electrobun + SolidJS. Currently it's a starter scaffold with no agent logic. We need to build the core packages that power the agent: an agent loop that runs LLM conversations with tool execution, a SQLite persistence layer backed by Drizzle ORM, and a set of coding tools. These packages form the foundation for everything else — the UI, the server, multi-project support — all depend on them.

## What Changes

- Create `packages/agent` — a pure agent loop that accepts messages, streams LLM responses via `@earendil-works/pi-ai`, executes tools (read/write/edit/bash), and loops until completion. Defines the `SessionStore` interface for persistence. Handles compaction (context window management) and retry (exponential backoff on retryable errors) internally.
- Create `packages/db` — SQLite persistence layer using `bun:sqlite` + Drizzle ORM. Defines the database schema (projects, sessions, messages, tool_executions, costs, settings, model_configs). Implements `SqliteSessionStore` from the agent's `SessionStore` interface. Provides typed repo classes for all entities.
- Create `packages/tools` — cwd-scoped coding tool definitions (read, write, edit, bash, grep, find, ls). Each tool is constructed with a fixed working directory. Tools are pure functions — no knowledge of the agent loop or database.
- Update root monorepo configuration to include `packages/*` workspace glob and shared TypeScript config.

## Capabilities

### New Capabilities

- `agent-loop`: The core agent loop — accepts messages, streams LLM responses, executes tools, handles compaction and retry. Defines the `SessionStore` interface and all agent types (`AgentMessage`, `AgentTool`, `AgentEvent`, `AgentConfig`).
- `agent-session-store`: The `SessionStore` interface contract — what the agent needs from any persistence backend (load messages, append messages, replace messages for compaction). Implemented by `packages/db`.
- `database-schema`: Drizzle schema definitions for all tables (projects, sessions, messages, tool_executions, costs, settings, model_configs). Migrations via Drizzle Kit.
- `database-repos`: Typed repository classes for each entity — `ProjectRepo`, `SessionRepo`, `MessageRepo`, `CostRepo`, `SettingsRepo`, `ModelConfigRepo`. Query and mutation operations.
- `session-store-sqlite`: Concrete implementation of `SessionStore` using Drizzle + bun:sqlite. Handles append-as-we-go message writes, compaction message replacement, and partial turn detection.
- `coding-tools`: Cwd-scoped tool definitions — read (file reading with truncation), write (file writing with mutation queue), edit (exact-text replacement with fuzzy fallback), bash (subprocess execution with streaming output and timeout), grep (ripgrep-backed search), find (fd-backed file search), ls (directory listing).

### Modified Capabilities

_(none — this is the first change, no existing specs)_

## Impact

- **Dependencies**: Adds `@earendil-works/pi-ai` (LLM streaming), `drizzle-orm` + `drizzle-kit` (ORM/migrations), `bun:sqlite` (built-in), `sqlite-vec` (vector search, loaded later).
- **Monorepo config**: Root `package.json` workspaces expand from `["apps/*"]` to `["apps/*", "packages/*"]`. New shared `tsconfig.base.json` with strict settings.
- **Build system**: Turbo pipeline needs `build` task for packages. Each package gets its own `tsconfig.json` extending the base.
- **Future work**: These packages unblock the Elysia server (wiring agent + db + tools), the SolidJS UI (chat interface), multi-project management, embedding/vector search, and the terminal integration.
