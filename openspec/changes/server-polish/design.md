## Context

The server (`apps/server`) currently has a small WS protocol (prompt/abort in, event/error out), REST CRUD over all repos, git status/branch/diff/log, session stats, and compaction. Six small features remain to reach parity with pibun for the server layer. Each is a standalone endpoint or WS behavior with no cross-feature dependencies.

Existing patterns to reuse:
- Git routes in `apps/server/src/routes/git.ts` use `Bun.spawn` with timeout — turn-diff and file-search can reuse the same pattern
- WS handler in `apps/server/src/agent/ws.ts` has `open`/`close` lifecycle hooks — welcome push hooks into `open`
- Settings routes in `apps/server/src/routes/settings.ts` use the `settings` table — workspace persistence uses the same table with a key convention
- Route composition via `buildServer` array pattern — all new routes follow this

## Goals / Non-Goals

**Goals:**
- WS welcome push on connect (version + cwd)
- Structured turn diff (`git diff HEAD` with numstat parsing)
- Last assistant text retrieval
- File search via `fd` (fallback to `find`)
- Workspace session path persistence
- Session slash commands listing
- All registered via route composition (no `apps/server/src/index.ts` edits)

**Non-Goals:**
- Advanced file search (regex, glob patterns) — basic query-only for v1
- Semantic search — this is file-name search, not content search
- Rich slash command extensibility — hardcoded list for v1; extensibility later
- Persistent workspace across server installs — handled by the settings table

## Decisions

### 1. Welcome push uses existing WS lifecycle hook

**Decision:** In `apps/server/src/agent/ws.ts`, the `open(ws)` handler already exists (currently stores `wsId`). Add a `ws.send(JSON.stringify({ type: "welcome", version: pkg.version, cwd: process.cwd() }))` call. Version is read from `apps/server/package.json`.

**Rationale:** The `open` handler is the natural place — the client just connected and hasn't sent any messages yet. No new routes or WS message types needed.

### 2. Turn diff reuses git route patterns

**Decision:** `GET /api/sessions/:id/turn-diff?files[]=...` runs `git diff HEAD --numstat` in the session's project cwd, parses the output into structured file summaries (additions, deletions per file), and also returns the full unified diff body.

```typescript
interface TurnDiffResult {
  files: Array<{ path: string; additions: number; deletions: number }>;
  diff: string;
  cwd: string;
}
```

**Alternative considered:** parse `git diff HEAD --stat` output. **Rejected:** `--numstat` is machine-parseable (tab-separated), while `--stat` is human-readable and harder to parse reliably.

### 3. File search shells to fd with find fallback

**Decision:** `GET /api/projects/:id/search-files?query=&limit=` tries `fd` first (fast, respects .gitignore by default). If `fd` is not available, falls back to `find` with manual ignore patterns (`node_modules`, `.git`, `dist`).

**Pattern** (from pibun's `appHandlers.ts`):
```
fd --type f --type d --max-results 50 --color never <query>
// fallback:
find . -not -path '*/node_modules/*' -not -path '*/.git/*' -iname '*<query>*'
```

### 4. Workspace uses settings table with key convention

**Decision:** Workspace session paths are stored in the `settings` table with key `workspace:sessions` and value as a JSON array: `'["path1", "path2"]'`.

**Routes:**
- `GET /api/workspace/sessions` — reads and parses the JSON array
- `POST /api/workspace/sessions` with body `{ sessionPath }` — adds path (idempotent)
- `DELETE /api/workspace/sessions/:encodedPath` — removes path

### 5. Last assistant text is a simple DB query

**Decision:** `GET /api/sessions/:id/last-assistant-text` queries messages where `role = "assistant"`, orders by `createdAt DESC`, returns the text content of the first one. Returns `{ text: null }` if no assistant messages exist.

### 6. Session commands returns a static list

**Decision:** `GET /api/sessions/:id/commands` returns a hardcoded array of slash commands. Extensible in the future by reading from a config or the agent package.

```json
{ "commands": [
  { "name": "search", "description": "Search files in the project" },
  { "name": "clear", "description": "Clear the conversation" },
  { "name": "compact", "description": "Compact the conversation context" },
  { "name": "help", "description": "Show available commands" }
]}
```

## Risks / Trade-offs

- **[fd not installed]** `fd` is not guaranteed to be on every system. **Mitigation:** clean fallback to `find` with reasonable ignore patterns. The agent already uses `find`/`grep` tools that don't depend on `fd`.
- **[Turn diff on empty repo]** if there's no HEAD commit, `git diff HEAD` fails. **Mitigation:** check `git rev-parse HEAD` first; if no HEAD exists, return empty diff.
- **[Workspace JSON array grows unbounded]** if the user loads many sessions, the settings value becomes large. **Mitigation:** the `settings` table stores arbitrary text; a JSON array of paths is unlikely to exceed a few KB.
