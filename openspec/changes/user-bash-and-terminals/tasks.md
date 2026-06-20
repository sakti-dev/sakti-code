## 1. Install bun-pty dependency

- [ ] 1.1 Add `bun-pty` to `apps/server/package.json` dependencies
- [ ] 1.2 Run `bun install` in the server package to compile the native addon
- [ ] 1.3 Verify bun-pty loads: `bun -e "require('bun-pty')"` — no native addon errors

## 2. Server: User bash route (Bun.spawn, not bun-pty)

- [ ] 2.1 Write failing test `apps/server/src/__tests__/bash.test.ts`:
  - `POST /api/sessions/:id/bash` with `{ command: "echo hello" }` → 200, output contains "hello", exitCode 0
  - `POST /api/sessions/nope/bash` → 404
  - `POST /api/sessions/:id/abort-bash` → 200, { ok: true }
  - Bash result injection with `injectToContext: true` appends message to session
  - Run → RED.
- [ ] 2.2 Create `apps/server/src/routes/bash.ts` with bash route — reuse `runGit`-style `Bun.spawn` pattern from git.ts, scoped to project cwd
- [ ] 2.3 Add active bash tracking (`Map<sessionId, { process, startedAt }>`) alongside the existing abort registry
- [ ] 2.4 Implement bash result injection: when `injectToContext: true`, append a tool-like message via `MessageRepo.append`
- [ ] 2.5 Register routes via route composition (no index.ts edits)
- [ ] 2.6 Run → GREEN. Typecheck + lint.

## 3. Server: TerminalManager service

- [ ] 3.1 Create `apps/server/src/terminal/terminal-manager.ts` with `TerminalManager` class wrapping bun-pty
  - `create(connectionId, opts)` → `{ terminalId, pid }`
  - `write(terminalId, data)` → void
  - `resize(terminalId, cols, rows)` → void
  - `close(terminalId)` → void
  - `closeByConnection(connectionId)` → void
  - `closeAll()` → void
  - `get(terminalId)` → ManagedTerminal | undefined
- [ ] 3.2 Wire data/exit callbacks: `onData`, `onExit`
- [ ] 3.3 Write unit tests for TerminalManager with mock IPty interface
- [ ] 3.4 Wire TerminalManager into the server via `ServerContext` (add `terminalManager` field)

## 4. Server: Terminal REST routes

- [ ] 4.1 Write failing test `apps/server/src/__tests__/terminal.test.ts`:
  - `POST /api/terminals` → 200, returns terminalId and pid
  - `POST /api/terminals/:id/write` → 200
  - `POST /api/terminals/:id/resize` → 200
  - `DELETE /api/terminals/:id` → 200
  - Unknown terminal returns 404
  - Run → RED.
- [ ] 4.2 Create `apps/server/src/routes/terminals.ts` with terminal CRUD routes
  - Routes call `serverContext.terminalManager` methods
  - Connection ID extracted from WS connection data (or a request header for REST)
- [ ] 4.3 Register routes via route composition
- [ ] 4.4 Run → GREEN. Typecheck + lint.

## 5. Server: Terminal WS push channels

- [ ] 5.1 Wire `TerminalManager.onData` callback to WS push: send `{ type: "push", channel: "terminal.data", data: { terminalId, data } }` to the owning connection
- [ ] 5.2 Wire `TerminalManager.onExit` callback to WS push: send `{ type: "push", channel: "terminal.exit", data: { terminalId, exitCode, signal? } }`
- [ ] 5.3 Add terminal cleanup on WS close: in the `close` handler of `buildWsApp()`, call `terminalManager.closeByConnection(connectionId)`
- [ ] 5.4 Write WS handler test: create terminal via WS message, verify `terminal.data` push is received on data callback

## 6. Server: Wire TerminalManager into buildServer

- [ ] 6.1 Add `terminalManager` to `ServerContext` in `apps/server/src/context.ts`
- [ ] 6.2 Construct `TerminalManager` in `buildServer` (or lazily in context)
- [ ] 6.3 Wire terminal routes and WS push channels in the server composition
- [ ] 6.4 Typecheck + lint.

## 7. Verification

- [ ] 7.1 Run full server suite: `bun vitest run apps/server/` — all tests pass
- [ ] 7.2 `bun typecheck` — 0 errors
- [ ] 7.3 `bun x ultracite fix` — 0 remaining diagnostics
