## Why

Sakti-code currently has bash execution as an **agent tool** — the LLM decides when to run commands, not the user. This is a significant gap from pibun, which supports both:

- **`session.bash`** — the user can execute a shell command independently, see the output, and optionally inject it into the session context for the LLM to reference
- **`terminal.*`** — full interactive PTY sessions (bun-pty) where users can run dev servers, file browsers, or any interactive shell workflow

Without user bash, users have no way to run a quick command (check git status, inspect a file, run a build) without prompting the LLM to do it. Without interactive terminals, users need a separate terminal app alongside sakti-code.

Both features are listed as deferred to v1.5 in the original plan, and both are essential for a productive coding agent experience.

## What Changes

### Additions

- **User bash route** — `POST /api/sessions/:id/bash` with body `{ command: string, timeout?: number }`. Runs the command on the server's filesystem (scoped to the session's project cwd) and returns `{ output, exitCode, cancelled, truncated }`.
- **User bash abort** — `POST /api/sessions/:id/abort-bash` aborts a running user bash command for the session.
- **Bash result injection** — A new `POST /api/sessions/:id/bash` option `{ injectToContext: true }` that appends the bash result as a tool-result-like message to the session history, so the LLM can see it on the next prompt.
- **Interactive terminal CRUD** — `POST /api/terminals` (create), `POST /api/terminals/:id/write`, `POST /api/terminals/:id/resize`, `DELETE /api/terminals/:id`. Uses bun-pty for cross-platform PTY support.
- **Terminal data push** — When a terminal produces output, the server pushes it to the owning WebSocket connection via `{ type: "push", channel: "terminal.data", data: { terminalId, data } }`.
- **Terminal exit push** — When a terminal process exits, the server pushes `{ type: "push", channel: "terminal.exit", data: { terminalId, exitCode, signal? } }`.
- **New `packages/pty` package** (or inline service in server) — wraps bun-pty spawn + lifecycle management, testable with a mock PTY interface.
- **WS protocol expansion** — new inbound types: `bash`, `abortBash`, `terminal.create`, `terminal.write`, `terminal.resize`, `terminal.close`. New outbound push channels: `terminal.data`, `terminal.exit`.

### No Breaking Changes

All existing routes and WS message types are unchanged. The new WS message types are additive. bun-pty is a new dependency that does not affect existing functionality.

## Capabilities

### New Capabilities

- **user-bash**: Users can execute shell commands independently from the agent loop, view output, and optionally inject results into session context
- **interactive-terminals**: Users can create, interact with, and manage full PTY shell sessions from within the app

## Impact

### Packages

- **`packages/pty` (new)** — wraps bun-pty with a `TerminalManager` class (create, write, resize, close, cleanup). Provides a testable abstraction over the native PTY.
- **`apps/server`** — new bash routes, terminal routes, expanded WS handler with new message types and push channels. Terminal manager instance wired into server context.
- **`packages/tools`** — no changes (agent bash tool is separate from user bash)

### Dependencies

- **bun-pty** — new native dependency for PTY support. Must be added to `apps/server/package.json`. Requires `bun install` to compile native addon.

### Tests

- New PTY package unit tests with mock PTY interface
- New server tests for bash and terminal routes (bash tests use real `Bun.spawn`; terminal tests use mocks)
- New WS handler tests for bash/abortBash/terminal message types

### Risks

- **bun-pty native addon** — native modules can fail to compile on certain platforms or Bun versions. Mitigation: fall back to an error message if bun-pty fails to load; the bash feature (which uses `Bun.spawn`) works independently.
- **Terminal lifecycle on disconnect** — if a WS connection closes, its terminals must be cleaned up. Mitigation: track terminal-to-connection mapping, close all on disconnect.
- **Bash output size** — unbounded command output could exhaust memory. Mitigation: truncate at 100KB (matching the agent bash tool's limit).
