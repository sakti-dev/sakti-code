# Ekacode Plans Cohesion Summary (2026-01-28)

## Source of Truth Decisions

### Orchestration & Agent Topology
- **Primary workflow**: XState Plan/Build agent state machine is the main orchestrator.
- **HybridAgent**: Plan/Build agents **extend/use HybridAgent** for multimodal routing (images) and prompt intent routing.
- **Sub-agents**: Allowed, but controlled by XState (e.g. Explore/DRA). HybridAgent is provider-level, not an orchestrator.

### UI & Streaming
- **Renderer**: Solid.js UI.
- **Streaming protocol**: Use **AI SDK UIMessage stream protocol end-to-end** (no raw-text SSE). Custom state is emitted via `data-*` parts.

### Providers
- **Z.ai-first** for now (glm-4.7 for text, glm-4.6v/4.5v for vision).
- **Provider-agnostic**: keep AI SDK v6 compatible abstractions so OpenAI/Anthropic/Google can be plugged later.
- Model lists in plans are **illustrative only** unless explicitly marked “canonical.”

### Session & Identity
- **sessionId** is **UUIDv7**, generated **server-side** and returned to UI on first request.
- **threadId == sessionId** for memory.
- **resourceId == userId** (or "local" for single-user desktop).

### Storage Strategy
- **Mastra Memory** (`@mastra/memory` + `@mastra/libsql`) is used **only for memory/semantic recall/working memory**.
- **Drizzle + libsql** is used for **general app tables**: sessions, tool_sessions, repo_cache, etc.
- Same SQLite/libsql file is allowed; schemas are separate.
- **App paths (canonical)**:
  - Resolve a single **Ekacode home** directory (self-contained) for **config/state/db/logs**.
  - **Resolution order**: `EKACODE_HOME` override → **dev** repo-local `./.ekacode/` (Option A) → **prod** OS user-data (Electron `app.getPath("userData")` or OS defaults via `env-paths`).
  - **Repo caches live in cache**: OS cache dir in prod (Electron `app.getPath("cache")`) or `./.ekacode/cache/` in dev.
  - **DB URLs must be absolute** (`file:/abs/path/...`) to avoid split DBs when cwd differs; server + core must use the same resolver.

### Monorepo Mapping (Current Structure)
- `packages/core`: agents, tools, HybridAgent, policies.
- `packages/server`: Hono sidecar, UIMessage stream, session storage, DB.
- `packages/desktop`: Electron main + preload + Solid renderer.
- `packages/shared`: shared types/utilities.
- `packages/zai`: Z.ai provider implementation.

## Data Flow (Canonical)
1) UI sends prompt without `sessionId` on first request.
2) Server generates UUIDv7, persists session, emits `data-session` in UIMessage stream.
3) UI persists `sessionId` and includes it on all requests.
4) XState loads messages + tool sessions from storage.
5) Mastra Memory recall is called before model invocation; messages are saved after each turn.

## Drizzle (libsql) Standard Setup
- Use `drizzle-orm` + `@libsql/client` + `drizzle-kit`.
- `db/index.ts` creates the client and `drizzle()` with schema.
- `drizzle.config.ts` uses `dialect: 'sqlite'` and `dbCredentials.url`.

## Tables (App-Owned)
- `sessions`: sessionId, resourceId, createdAt, lastAccessed.
- `tool_sessions`: sessionId + toolName + toolKey → toolSessionId.
- `repo_cache`: resourceKey → localPath/commit metadata.

## Notes
- Where plans conflict, **this summary and each plan’s Cohesion Addendum take precedence**.
