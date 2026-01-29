# Tech Stack

## Frontend

### Electron (Desktop Shell)

- **Version**: Latest stable
- **Rationale**: Cross-platform desktop app (Win/macOS/Linux) with native file dialogs, system tray, notifications; secure sandboxed renderer with `contextIsolation`.
- **Alternatives considered**: Tauri (Rust) — rejected due to TypeScript ecosystem preference and Electron maturity in dev tools.

### SolidJS (UI Framework)

- **Version**: ^1.x with Vite
- **Rationale**: React-like components with fine-grained reactivity; smaller bundle, better performance for streaming UI; integrates well with Vercel AI SDK v6.
- **Alternatives considered**: React — fine-grained reactivity and Solid MotionOne for animations.

### Tailwind CSS (Styling)

- **Version**: ^4.x
- **Rationale**: Utility-first CSS, rapid UI development, consistent design system; easy to maintain with components.
- **Alternatives considered**: CSS Modules — Tailwind offers faster iteration for complex layouts.

### Solid MotionOne (Animations)

- **Version**: ^1.x
- **Rationale**: Performant, declarative animations built for Solid; reduces boilerplate for transitions, loading states, and micro-interactions.
- **Alternatives considered**: Framer Motion (React) — not Solid-compatible; raw CSS — more manual work.

## Backend

### Hono (HTTP API Gateway)

- **Version**: Latest (Node adapter)
- **Rationale**: Lightweight, fast web framework for internal loopback server; native streaming (SSE helpers), Fetch/Request/Response-native; minimal overhead.
- **Alternatives considered**: Express — heavier; Fastify — fine, but Hono’s streaming focus aligns better with SSE.

### Electron IPC (Main-Renderer Communication)

- **Rationale**: Secure `invoke/handle` for request/response and `contextBridge` to expose minimal, typed API; no raw `ipcRenderer` in renderer; structured clone-safe payloads.
- **Best practices**: Centralize channel constants in `shared/ipc.ts`, validate with Zod, avoid sync IPC.

### Vercel AI SDK v6 (Headless Chat + Streaming Consumer)

- **Version**: ^6.x
- **Rationale**: UIMessage stream protocol, `streamText` pipeline, tool streaming, custom `data-*` parts; used with Solid renderer and Hono server.
- **Alternatives considered**: TanStack AI — rejected in favor of direct AI SDK v6 for better Mastra compatibility and simpler streaming patterns.

### Mastra (Agent Orchestration)

- **Version**: Latest (vNext workflow engine)
- **Rationale**: TypeScript-first framework; **Mastra Memory** used for semantic recall + working memory, while orchestration is handled by custom XState Plan/Build agents.
- **Alternatives considered**: LangChain (Python) — TypeScript ecosystem, Mastra’s workflow primitives are more deterministic for engineering.

## Database

### libSQL (Storage + Memory)

- **Version**: Latest (`@libsql/client`)
- **Rationale**: Local-first SQLite-compatible DB with HTTP mode; used by Drizzle for app tables and by Mastra Memory for recall + embeddings.
- **Alternatives considered**:
  - Chroma (vector DB) — pure vector store, lacks structured queries; rejected in favor of SQL + embeddings.
  - PostgreSQL — heavier for local desktop app; libSQL is embedded.

### Drizzle ORM (App Tables)

- **Version**: Latest (`drizzle-orm`, `drizzle-kit`)
- **Rationale**: Type-safe schema + migrations for sessions/tool_sessions/repo_cache; runs against libSQL.
- **Alternatives considered**: Prisma — heavier for local-first SQLite.

### JSON (Per-Project Plans)

- **Rationale**: Simple, human-readable storage for project-specific plans and configurations; git-friendly for version control.
- **Alternatives considered**: libSQL — JSON is easier for hand-editing and diffs.

## Other

### Tree-sitter (Multi-Language Parsing)

- **Version**: ^0.20.x
- **Rationale**: Language-agnostic AST parsing for code understanding; supports 40+ languages; query patterns for functions, classes, imports.
- **Alternatives considered**: TypeScript Compiler API only — TypeScript-only; Tree-sitter enables polyglot support.

### TypeScript Compiler API (Code Understanding)

- **Version**: ^5.x
- **Rationale**: 100% accurate type information, JSDoc extraction, import dependency graph; for TypeScript/JavaScript files.
- **Used alongside**: Tree-sitter for non-TS languages.

### Fast-Embed / ONNX (Embeddings)

- **Version**: Latest
- **Rationale**: Local embeddings model (BAAI/bge-small or e5-small); no external API calls; low latency for semantic search.
- **Alternatives considered**: OpenAI embeddings — requires network, adds cost; local models align with offline-first.

### XState (Agent Orchestration)

- **Version**: Latest
- **Rationale**: Primary Plan/Build orchestration; deterministic loops, explicit phases, and tool routing; integrates with HybridAgent for multimodal prompts.

### Chokidar (File Watching)

- **Version**: ^3.x
- **Rationale**: Cross-platform file watcher for workspace; IPC push events on external changes; debounced events.
- **Alternatives considered**: Node.js `fs.watch` — inconsistent across platforms.

### electron-builder (Packaging)

- **Version**: Latest
- **Rationale**: Bundle and package Electron apps for Win/macOS/Linux; code signing, auto-update, distribution (Homebrew, Scoop, AUR).
- **Alternatives considered**: Electron Forge — electron-builder has better auto-update integration.

### Vite (Build Tool)

- **Version**: ^5.x
- **Rationale**: Fast HMR for renderer (SolidJS); integrates with Electron-vite for main/preload builds; modern, plugin-rich.
- **Alternatives considered**: Webpack — slower; Rollup — lower-level; Vite is the sweet spot.

### Zod (Validation)

- **Version**: ^4.x
- **Rationale**: Runtime schema validation for tool inputs, IPC payloads, and API contracts; integrates with Mastra tools and TypeScript types.
- **Alternatives considered**: Joi — similar; Zod has better TS inference.
