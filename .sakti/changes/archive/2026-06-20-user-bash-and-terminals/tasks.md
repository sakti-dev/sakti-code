## 1. Install bun-pty dependency

- [x] 1.1 Add `bun-pty` to `apps/server/package.json` dependencies
- [x] 1.2 Run `bun install` in the server package to compile the native addon
- [x] 1.3 Verify bun-pty loads: `bun -e "require('bun-pty')"` — no native addon errors

## 2. Server: User bash route (Bun.spawn, not bun-pty)

- [x] 2.1 Write failing test `apps/server/src/__tests__/bash.test.ts`
- [x] 2.2 Create `apps/server/src/routes/bash.ts` with bash route — reuse `runGit`-style `Bun.spawn` pattern from git.ts, scoped to project cwd
- [x] 2.3 Add active bash tracking (`Map<sessionId, { process, startedAt }>`) alongside the existing abort registry
- [x] 2.4 Implement bash result injection: when `injectToContext: true`, append a tool-like message via `MessageRepo.append`
- [x] 2.5 Register routes via route composition (no index.ts edits)
- [x] 2.6 Run → GREEN. Typecheck + lint.

## 3. Server: TerminalManager service

- [x] 3.1 Create `apps/server/src/terminal/terminal-manager.ts` with `TerminalManager` class wrapping bun-pty
- [x] 3.2 Wire data/exit callbacks: `onData`, `onExit`
- [x] 3.3 Write unit tests for TerminalManager with mock IPty interface
- [x] 3.4 Wire TerminalManager into the server via `ServerContext` (add `terminalManager` field)

## 4. Server: Terminal REST routes

- [x] 4.1 Write failing test `apps/server/src/__tests__/terminal.test.ts`
- [x] 4.2 Create `apps/server/src/routes/terminals.ts` with terminal CRUD routes
- [x] 4.3 Register routes via route composition
- [x] 4.4 Run → GREEN. Typecheck + lint.

## 5. Server: Terminal WS push channels

- [x] 5.1 Wire `TerminalManager.onData` callback to WS push: send `{ type: "push", channel: "terminal.data", data: { terminalId, data } }` to the owning connection
- [x] 5.2 Wire `TerminalManager.onExit` callback to WS push: send `{ type: "push", channel: "terminal.exit", data: { terminalId, exitCode, signal? } }`
- [x] 5.3 Add terminal cleanup on WS close: in the `close` handler of `buildWsApp()`, call `terminalManager.closeByConnection(connectionId)`
- [x] 5.4 Write WS handler test: create terminal via WS message, verify `terminal.data` push is received on data callback

## 6. Server: Wire TerminalManager into buildServer

- [x] 6.1 Add `terminalManager` to `ServerContext` in `apps/server/src/context.ts`
- [x] 6.2 Construct `TerminalManager` in `buildServer` (or lazily in context)
- [x] 6.3 Wire terminal routes and WS push channels in the server composition
- [x] 6.4 Typecheck + lint.

## 7. Verification

- [x] 7.1 Run full server suite: `bun test apps/server/` — all tests pass (80/80)
- [x] 7.2 `bun typecheck` — 0 errors
- [x] 7.3 `bun x ultracite fix` — 0 remaining diagnostics
- [x] **Post-review fixes (2026-06-20):**
  - **bash.ts**: True async abort with `activeBash` + `cancelledFlags`
  - **terminal-manager.ts**: Eager bun-pty init, `readonly` map, safe closeByConnection/closeAll
  - **terminals.ts**: 503 on bun-pty unavailable, UUID connectionId
  - **terminal-manager.test.ts**: Error path unit tests
  - **terminal-push.test.ts**: Format-level push structure tests
  - **ws.ts**: `Map<string, any>` → `Map<string, WsHandle>` (lint fix)
