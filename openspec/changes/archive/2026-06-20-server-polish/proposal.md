## Why

Four v1.5 changes are planned, and the three larger ones (agent-loop-controls, session-forking, user-bash-and-terminals) have been proposed. This change collects the remaining small-but-valuable server-side features that didn't fit neatly into any of the other changes. They're all pure server additions — no agent package changes, no schema migrations — making them quick wins that can be done in any order.

Pibun supports all of these features natively via its WS RPC protocol. Without them, sakti-code's server feels incomplete:

- No welcome push on WS connect means clients don't know the server version or capabilities until they make a REST call
- No structured turn diff means the UI can't show per-file change summaries inline in the conversation
- No `lastAssistantText` means the "Copy Last Response" action requires the client to track message state
- No file search means users can't quickly find files in a project from the UI
- No workspace persistence means the sidebar doesn't remember which sessions were loaded across restarts
- No commands endpoint means the UI can't show available slash commands to the user

## What Changes

### Additions

- **WS welcome push** — send `{ type: "welcome", version: string, cwd: string }` when a WebSocket client connects
- **Structured turn diff** — `GET /api/sessions/:id/turn-diff?files[]=...` returns per-file git diff summaries (parsed from `git diff HEAD --numstat`) with `{ files: [{ path, additions, deletions }], diff: string }`
- **Last assistant text** — `GET /api/sessions/:id/last-assistant-text` returns `{ text: string | null }` with the text of the most recent assistant message
- **File search** — `GET /api/projects/:id/search-files?query=&limit=` shells to `fd` (with `find` fallback) and returns `{ files: [{ path, kind }] }`
- **Workspace persistence** — `GET /api/workspace/sessions` lists loaded session paths; `POST /api/workspace/sessions` adds a path; `DELETE /api/workspace/sessions/:path` removes one. Stored in the `settings` table using a key convention.
- **Session commands** — `GET /api/sessions/:id/commands` returns a list of available slash commands currently hardcoded to a basic set (`/search`, `/clear`, `/compact`, `/help`); extensible in the future

### No Breaking Changes

All additions are new endpoints. No existing routes or WS protocol types are modified.

## Capabilities

### New Capabilities

- **ws-welcome-push**: Server sends a welcome frame on WS connect with version and server info
- **turn-diff**: Structured per-file git diff summary for a session
- **last-assistant-text**: Retrieve the text of the last assistant message
- **file-search**: Search files in a project directory via fd/find
- **workspace-persistence**: Remember which sessions are loaded in the sidebar across restarts
- **session-commands**: List available slash commands for a session

## Impact

### Packages

- **`apps/server`** — new route files; WS handler updated to send welcome push; no index.ts edits
- **`packages/db`** — no changes (workspace uses existing `settings` table with key convention `workspace:sessions`)

### Tests

- Each new endpoint gets tests (mock subprocess for git/fd; mock DB for workspace)
- Existing tests remain unchanged
