## Context

The server currently has bash execution only via the agent tool (`createBashTool` in `@sakti-code/tools`), which is invoked by the LLM during a prompt. There is no mechanism for a user to run a command independently.

For interactive terminals, pibun uses `bun-pty` (Rust FFI) to spawn PTY shell sessions. bun-pty is a native addon that provides `spawn(shell, args, opts)` returning an `IPty` instance with `onData`, `onExit`, `write`, `resize`, `kill`, and `pid`.

The server already has a `runGit` helper using `Bun.spawn` with timeout handling in `apps/server/src/routes/git.ts`. User bash can reuse the same pattern but with different routing and session-scoping.

For the new PTY package, the plan is to create a lightweight `packages/pty/` package (or inline a service in `apps/server/src/`) that wraps bun-pty with lifecycle management. Given the native dependency complexity, a separate package is cleaner for testing and isolation.

Verified facts:
- `bun-pty` is NOT in the project (confirmed via `bun why bun-pty` → not found)
- bun-pty API: `spawn(shell, args, { cols, rows, cwd, env, name })` → `IPty` with `.onData(cb)`, `.onExit(cb)`, `.write(data)`, `.resize(cols, rows)`, `.kill()`, `.pid`
- The server's `ws.ts` already has per-connection store management; terminal lifecycle can hook into `open`/`close` events
- Bash output truncation at 100KB matches the agent tool's limit

## Goals / Non-Goals

**Goals:**
- `POST /api/sessions/:id/bash` — run a shell command, return `{ output, exitCode, cancelled, truncated }`
- `POST /api/sessions/:id/abort-bash` — abort a running user bash command
- Bash result injection into session context — optional `injectToContext` flag appends result as a message
- `POST /api/terminals` — create a PTY terminal, returns `{ terminalId, pid }`
- `POST /api/terminals/:id/write` — write data to terminal stdin
- `POST /api/terminals/:id/resize` — resize terminal dimensions
- `DELETE /api/terminals/:id` — close/kill terminal
- WS push channels for terminal data and exit events
- Terminal cleanup on connection disconnect
- All registered via route composition (no `apps/server/src/index.ts` edits)
- A `TerminalManager` service (in `apps/server/src/`) that wraps bun-pty lifecycle

**Non-Goals:**
- Terminal splits / tabs — one terminal per create call; the client manages tabs
- Terminal persistence across server restarts — terminals die with the server
- Terminal reconnect — if WS disconnects, the terminal is killed
- File upload to terminal — stdin-only for v1

## Decisions

### 1. Bash uses Bun.spawn (not bun-pty)

**Decision:** User bash commands use `Bun.spawn` with pipe'd stdio — the same pattern as `runGit` in `git.ts`. bun-pty is only for interactive terminals.

**Rationale:** Bash commands are one-shot: spawn → capture output → return. PTY is for persistent interactive sessions. Using `Bun.spawn` for bash avoids the native addon dependency for the simpler use case and keeps bash working even if bun-pty fails to compile.

### 2. TerminalManager as a server service

**Decision:** A `TerminalManager` class lives in `apps/server/src/terminal/terminal-manager.ts` (or as an inline service). It wraps bun-pty's `spawn`, manages a `Map<terminalId, ManagedTerminal>`, and provides callbacks for data/exit events.

```typescript
class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private onData?: (terminalId: string, connectionId: string, data: string) => void;
  private onExit?: (terminalId: string, connectionId: string, exitCode: number, signal?: number) => void;

  create(connectionId: string, opts: { cwd?, cols?, rows? }): { terminalId, pid }
  write(terminalId: string, data: string): void
  resize(terminalId: string, cols: number, rows: number): void
  close(terminalId: string): void
  closeByConnection(connectionId: string): void
  closeAll(): void
  get(terminalId: string): ManagedTerminal | undefined
}
```

**Alternative considered:** make it a standalone `packages/pty` package. **Rejected for v1:** a separate package adds overhead (package.json, tsconfig, workspace registration, build) for what's essentially a thin wrapper over bun-pty. If terminals grow complex features (splits, persistence), extract later.

**However**, if the preference is for clean package boundaries, a `packages/pty` package is fine too — it's the same code, just in a different location. Either way, the TerminalManager API is the same.

### 3. Active bash tracking via same registry as agent runs

**Decision:** Extend the existing `activeRuns` map in `runner.ts` to also track active bash processes. Or create a separate `activeBash` map. The bash abort route looks up the process and kills it.

```typescript
const activeBash = new Map<string, { process: Subprocess; startedAt: number }>();
```

**Rationale:** The pattern already exists for agent abort; reusing the same mental model (sessionId → abortable resource) keeps the codebase consistent.

### 4. Bash timeout defaults to 30 seconds

**Decision:** User bash commands have a default timeout of 30 seconds (matching the agent bash tool). The client can override via `timeout` in the request body.

### 5. Terminal data/exit pushed via WS, not polled

**Decision:** `TerminalManager.setData` and `TerminalManager.setExit` callbacks are wired to `ws.send(JSON.stringify({ type: "push", channel: "terminal.data", data: { terminalId, data } }))` in the WS handler. The client receives data in real-time without polling.

**Alternative considered:** client polls via REST. **Rejected:** terminals produce continuous output; polling would be wasteful and laggy. WS push is the natural pattern for streaming data.

### 6. Terminal ownership by WebSocket connection

**Decision:** Each terminal is tagged with the `wsConnectionId` that created it. On WS close, all terminals owned by that connection are cleaned up (killed). This prevents orphaned PTY processes.

## Risks / Trade-offs

- **[bun-pty native addon]** may fail to compile on certain platforms or Bun versions. **Mitigation:** the bash feature works independently; terminal creation returns 500 with a clear "terminal unavailable" error if bun-pty can't load. Document this in AGENTS.md.
- **[Orphaned terminals on server crash]** if the server crashes, terminal processes are orphaned. **Mitigation:** this is an OS-level concern; the shell process's parent dies, and the shell typically exits. Not a critical risk for a development tool.
- **[Bash output truncation]** at 100KB may be too small for some commands (e.g., `ls -la` on a large repo). **Mitigation:** the response includes `truncated: true` so the client knows. The user can use `grep`/`head`/`tail` to narrow output.
- **[Terminal resize race condition]** if a resize and write arrive in quick succession, the PTY may process them out of order. **Mitigation:** bun-pty handles this internally; no application-level sequencing needed.
