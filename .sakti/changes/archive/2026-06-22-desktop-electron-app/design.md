## Context

sakti-code's desktop shell today is Electrobun (`apps/app`) — a CEF-based runtime whose development has stalled. The rewrite already produced a clean Hono server (`apps/server`) on `@hono/node-server` with REST + WebSocket, and — critically — that server already exposes `createServer(options)` (in `apps/server/src/create-server.ts`) which binds a port, sets up the DB via `initDatabase(new DatabaseSync(dbPath))`, wires the `onOpenFolderDialog` hook, builds the Hono app, attaches the `ws` WebSocketServer, and resolves `{ hostname, port, url, stop }`. It accepts `port?: number` (pass `0` for an OS-assigned ephemeral port), `hostname?`, `dbPath?`, `migrationsFolder?`, and `hooks?`. This is exactly the shape an Electron main process needs to host the server in-process with zero changes.

The renderer (`apps/app/src`) is already a SolidJS + Vite + Tailwind app that talks to the server over real `fetch` + WebSocket (currently via a Vite dev proxy to `:3001`, and an Eden client slated for migration to Hono RPC). It carries stores, components, a WS client, and an event reducer. None of that is Electrobun-specific except a thin `src/lib/bun/` shim.

Constraints carried from the codebase: SolidJS is mandatory (not React); `exactOptionalPropertyTypes: true` is on (use conditional spread); TS 6.0, Bun runtime for dev tooling; Ultracite/Biome for lint+format; TDD with tests in `__tests__/`; `@hono/node-server` is the server runtime. The server's DB driver is Node's built-in `node:sqlite` (`DatabaseSync`), **not** `better-sqlite3` and **not** `bun:sqlite`.

## Goals / Non-Goals

**Goals:**
- A single `apps/desktop` package that is, to the daily editor, indistinguishable from a plain Vite SolidJS app: open `src/`, code the UI.
- Electron main hosts the existing Hono server in-process on an ephemeral localhost port, reusing `createServer` verbatim — no server logic is copied or forked.
- The renderer remains process-agnostic (real `fetch` + WS), so it runs under Electron in production **and** standalone against `apps/server :3001` in dev.
- A hardened preload (sandbox + contextIsolation + contextBridge) with a minimal, security-scoped IPC surface.
- A reproducible cross-platform build via electron-vite + electron-builder.

**Non-Goals:**
- Auto-updater, code signing, notarization, and release publishing — the build pipeline produces installers, but the release/distribution workflow is a separate change.
- macOS/Windows as v1 targets — Linux first (matches the PRD); other platforms are configuration-only follow-ups.
- Changing any `apps/server` requirement. `createServer` is consumed as-is.
- Migrating the Eden client to Hono RPC (`hc`) — that is the already-planned follow-up; this change only requires the renderer's `lib/api.ts` to target the embedded port.
- Multi-window, system tray, native notifications — out of scope; the shell exists to host the renderer and the server.

## Decisions

### 1. Electron + electron-vite + electron-builder (not Electrobun, not Forge)
**Decision:** Migrate off Electrobun to Electron, built with `electron-vite` (the standalone Vite tool, *not* Forge's plugin) and packaged with `electron-builder`. **Alternatives considered:** (a) stay on Electrobun — rejected, stalled upstream and fragile CEF story; (b) Electron Forge — rejected, its `@electron-forge/plugin-vite` is finicky (main/preload hot-restart needs glue like `process.stdin.emit("data","rs")`), moves slowly, and has weaker packaging/signing than electron-builder. **Rationale:** electron-vite is purpose-built for the three-entry Vite problem and feeds electron-builder's expected layout directly; electron-builder gives the strongest installer/code-sign/auto-update story. The old sakti-code already used alex8088's `@electron-toolkit/*` (the companion runtime helpers to electron-vite), so this is familiar territory.

### 2. Single package, `src/` renderer + `electron/` shell
**Decision:** One `apps/desktop` package. The renderer lives in `src/` (Vite root); main/preload/shared live in a sibling `electron/` directory. **Alternative:** split into three workspace packages (`apps/{desktop,electron,preload}`) like the old code. **Rejected:** the three processes never ship or version independently; splitting forces type-sharing gymnastics across package boundaries and re-couples them by implicit filesystem paths (`../../preload/dist/index.cjs`). **Rationale:** the user's stated goal — "when I code, it should feel like a Vite app" — is maximally served by keeping `src/` pure. electron-vite supports overriding each entry's path, so `renderer.root = "src"` and `main`/`preload` inputs point at `electron/`.

### 3. Embedded Hono server via the existing `createServer`
**Decision:** Electron main imports `createServer({ port: 0, hostname: "127.0.0.1", hooks: { onOpenFolderDialog } })` from `@sakti-code/server`, gets `{ port, url, stop }`, and passes `port` to the renderer. **Alternative:** an in-process IPC `fetch` shim that calls `app.request()` directly (the electron-hono reference's pattern). **Rejected:** that shim buffers the whole body as a string and cannot carry the WebSocket streaming the agent loop depends on; it also duplicates route logic. **Rationale:** `createServer` already supports embedding — ephemeral port, graceful `stop()`, and a `hooks.onOpenFolderDialog` seam. Embedding a real localhost server means the renderer's existing `fetch` + WS code paths are reused unchanged, including streaming.

### 4. Dialogs stay on the server REST route (via the hook), not new IPC
**Decision:** The server's existing `/api/dialog` route invokes `hooks.onOpenFolderDialog`; in main, that hook is implemented with Electron's native `dialog.showOpenDialog`. The renderer keeps calling the REST route it already calls. **Alternative:** a separate `dialog:openDirectory` IPC channel. **Rejected:** redundant — the server already owns this concern and the hook is the documented seam. **Rationale:** fewer IPC channels, one dialog path, no renderer change.

### 5. Minimal IPC surface, hardened preload
**Decision:** IPC carries only what HTTP cannot: `get-server-config` (returns `{ baseUrl, port }` so the renderer never hardcodes a port), `shell:openExternal` (with a URL-protocol allowlist blocking `file:`/`javascript:`/`data:`/`shell:`), and `log:message` (renderer → main pino). Preload is `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`, `contextBridge`-only. **Rationale:** smallest trust boundary; matches the old code's proven posture.

### 6. `shared/` is type-only
**Decision:** The IPC contract (`SaktiDesktopAPI`, channel-name constants, `{ baseUrl, port }`) lives in `electron/shared/` and is imported by the renderer via `import type` only. **Rationale:** type-only imports are erased at build, so no Node-targeted code ever crosses into the renderer bundle. Tiny pure-value constants (channel name strings) are also safe to bundle.

### 7. DB driver: verify `node:sqlite` in Electron, else `better-sqlite3`
**Decision:** Attempt to run the server's existing `node:sqlite` (`DatabaseSync`) driver unchanged inside Electron's bundled Node. **Fallback:** if the `experimental-sqlite` flag is unavailable/unstable in the target Electron's Node, switch `packages/db` to `better-sqlite3` and rebuild natives via `@electron/rebuild`. **Rationale:** `node:sqlite` is built into Node 22.5+ and needs **no** native rebuild — strictly better if it works. This is the single highest-uncertainty item and is verified first (task 1).

## Risks / Trade-offs

- **[`node:sqlite` in Electron]** The server uses Node's built-in `DatabaseSync`; Electron bundles its own Node and may require enabling the experimental flag (`app.commandLine.appendSwitch` or a runtime flag). → **Mitigation:** a spike in task 1 boots Electron main, calls `createServer`, and hits `/health` + a DB write. If it fails, fall back to `better-sqlite3` in `packages/db` (Decision 7) — note this may already be a known migration ("bun:sqlite→better-sqlite3 re-wire" is mentioned in AGENTS.md).
- **[Native module rebuilds]** If any workspace dependency (e.g. tokenizers/tree-sitter pulled by `packages/agent` or `pi-ai`) is native, it must rebuild against Electron's ABI. → **Mitigation:** audit the dependency tree (`pnpm why` / `bun pm ls`) before packaging; add `@electron/rebuild` to the build step and list offenders in `electron-builder.yml` `asarUnpack`.
- **[Port-in-use on main HMR restart]** When `electron/main/` changes, electron-vite restarts the main process; the embedded server must release its port or the next bind fails. → **Mitigation:** wire `server.stop()` into a `before-quit`/shutdown handler (the old code's `shutdown` manager pattern); ephemeral port `0` makes collisions vanishingly rare anyway.
- **[electron-vite custom entry paths]** Overriding `renderer.root = "src"` and pointing main/preload at `electron/` is supported but less common than the default `src/{main,preload,renderer}` layout. → **Mitigation:** verify in the task-1 spike; if a path is unsupported, the fallback is the default layout with the renderer at `src/renderer/` (still one package).
- **[Localhost server has no auth]** The embedded server is reachable by any local process. → **Mitigation:** bind to `127.0.0.1` (not `0.0.0.0`) on an ephemeral port; for v1 this matches the server's existing "localhost-only" assumption. If multi-user or untrusted-local-process matters later, add a bootstrap token validated by the server in a separate change (would modify `server-rest-api`).
- **[Electrobun `src/lib/bun/` shim]** The renderer has Electrobun-specific glue (`window-state`). → **Mitigation:** replace with Electron equivalents (window-state persistence via `electron-store` or a tiny main-side IPC) during the renderer migration; non-blocking.

## Open Questions

- **Q1.** Does the target Electron's bundled Node run `node:sqlite` unflagged? (Resolved by the task-1 spike; determines Decision 7.)
- **Q2.** Linux-only for v1, or configure mac/win targets in `electron-builder.yml` from the start (even if untested)? Lean: ship Linux config now, leave mac/win stubbed.
- **Q3.** Window-state persistence: adopt `electron-store`, or hand-roll a small IPC + JSON file? Lean: hand-roll to avoid a new dependency for a trivial concern.
