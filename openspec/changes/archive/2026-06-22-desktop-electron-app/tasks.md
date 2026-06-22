## 1. Spike — verify `node:sqlite` + embedded server in Electron

- [x] 1.1 Create a throwaway `apps/desktop` skeleton: `package.json` with `electron`, `electron-vite`, `@sakti-code/server` (workspace), and a minimal main calling `createServer({ port: 0, hostname: "127.0.0.1" })`. `bun install`.
- [x] 1.2 Launch Electron; hit `GET /api/health` and confirm `node:sqlite` (`DatabaseSync`) works unflagged inside Electron's bundled Node.
- [x] 1.3 **Decision gate:** `node:sqlite` works unflagged under Electron 42's bundled Node — **no `better-sqlite3` fallback, no native DB rebuild.** Verified via `apps/desktop/spike.mjs` (`:memory:` write + `createServer` boot + `/api/health` 200 + `server.stop()`).
- [x] 1.4 Verify `server.stop()` releases the port on `before-quit`.

## 2. Scaffold `apps/desktop` (single-package structure)

- [x] 2.1 `apps/desktop/package.json` — scripts `dev`/`build`/`package`/`rebuild`/`spike`/`typecheck`; deps `electron@^42`, `electron-vite@^5`, `electron-builder@^26`, `@electron-toolkit/{utils,preload}`, `@sakti-code/server`, `@swc/core`, `vite@^7`, `@types/node`.
- [x] 2.2 `electron.vite.config.ts` — three entries with custom paths (`main`/`preload` → `electron/`, `renderer.root = "src"`); preload `externalizeDeps:false` for sandbox.
- [x] 2.3 Single `tsconfig.json` (no project refs) including `src`+`electron`, jsx=solid, types `[node,bun]`. (The build enforces process separation; typecheck just needs to pass.)
- [x] 2.4 `electron-builder.yml` — Linux target, `asar:true`, `asarUnpack` for `node-pty`/`*.node`.
- [x] 2.5 Verified `electron-vite build` emits `out/main/index.js`, `out/preload/index.mjs`, `out/renderer/index.html`.

## 3. Main process — embedded server + lifecycle

- [x] 3.1 `electron/main/index.ts` — `whenReady` → `createServer({ port:0, hostname:"127.0.0.1", hooks })` → register IPC → `createWindow()`.
- [x] 3.2 `electron/main/lifecycle.ts` — `BrowserWindow` with `sandbox:true`, `nodeIntegration:false`, `contextIsolation:true`; dev → `ELECTRON_RENDERER_URL`, prod → built `index.html`; `setWindowOpenHandler` → `shell.openExternal` + deny; renderer console forwarded to stdout.
- [x] 3.3 `before-quit` → `server.stop()` with double-shutdown guard.
- [x] 3.4 `window-all-closed` (non-darwin quit) + `activate` (darwin re-create).
- [x] 3.5 Verified: nix-shell launch logged `embedded server on http://127.0.0.1:9325`.

## 4. Preload + shared contract (type-only)

- [x] 4.1 `electron/shared/{ipc-api,channels,server-config}.ts` — contract types + channel constants.
- [x] 4.2 `electron/preload/index.ts` — `contextBridge.exposeInMainWorld("sakti", { server:{getConfig}, shell:{openExternal} })`; sandbox-safe.
- [x] 4.3 `src/lib/electron.ts` — type-only `import type { SaktiDesktopAPI }` + `declare global { var sakti }`.
- [x] 4.4 Verified renderer is Electron-free: no `import ... from "electron"` / `require(` under `src/`.

## 5. IPC handlers + folder-dialog hook

- [x] 5.1 **TDD:** `electron/main/__tests__/protocol.test.ts` — `isProtocolAllowed` allows `{http,https,mailto,tel,ftp,sftp}`, blocks `{file,javascript,data,shell,malformed}`. **12/12 pass** (bun:test).
- [x] 5.2 `electron/main/ipc/shell.ts` — `shell:openExternal` via the allowlist (pure `isProtocolAllowed` extracted to `lib/protocol.ts`).
- [x] 5.3 `electron/main/ipc/server-config.ts` — `get-server-config` returns `{ baseUrl }`.
- [x] 5.4 `electron/main/ipc/log.ts` — `log:message` → main logger.
- [x] 5.5 `electron/main/ipc/dialog.ts` — `createDialogHooks().onOpenFolderDialog` via `dialog.showOpenDialog`; passed into `createServer`.

## 6. Migrate renderer from `apps/app` — DEFERRED to follow-up change

> **Deferred:** renderer migration is entangled with the Eden→Hono-RPC client migration, which the design doc lists as a **Non-Goal** for this change (the renderer's `lib/api.ts` is currently a broken Eden client). It is split into a new change `desktop-renderer-migration` (blocked on the Eden→RPC follow-up). The shell's smoke renderer (`src/index.html`) already proves the full chain: preload → IPC → embedded server → `/api/health`.

- [ ] 6.1 Move `apps/app/src/**` → `apps/desktop/src/` (deferred).
- [ ] 6.2 Rewire `lib/api.ts` to the embedded port via `window.sakti.server.getConfig()` (deferred — depends on Eden→RPC).
- [ ] 6.3 Replace the Electrobun `src/lib/bun/` shim (deferred).
- [ ] 6.4 Migrate renderer tests (deferred).
- [ ] 6.5 Verify migrated renderer (deferred).

## 7. Native module audit + rebuild setup

- [x] 7.1 Audit: **`node-pty`** (apps/server, terminals) is the only runtime native module. (`better-sqlite3`/lightningcss/swc `.node` files are dev-tooling, not in the Electron runtime path; DB uses `node:sqlite`.)
- [x] 7.2 `asarUnpack` configured for `node-pty`/`*.node`; electron-builder's bundled `@electron/rebuild` rebuilds at package time; `rebuild` script (`electron-builder install-app-deps`) for dev.
- [x] 7.3 Verified: `electron-builder --dir` rebuilt `node-pty` against Electron 42.4.1 (`finished moduleName=node-pty`).

## 8. Packaging — Linux build

- [x] 8.1 `electron-builder.yml` finalized: Linux `AppImage`+`deb`, `appId`, `productName`, `asar:true`, `asarUnpack`.
- [x] 8.2 Verified: `release/linux-unpacked/` produced (Electron binaries + app.asar + `app.asar.unpacked/node-pty/build/Release/pty.node`).
- [ ] 8.3 Full end-to-end packaged smoke (open folder dialog, WS session, DB persistence) — deferred to the renderer-migration change (needs the real renderer).

## 9. Verification, cleanup, docs

- [x] 9.1 `bun typecheck` (turbo, 6/6 packages incl. desktop) + `ultracite check` — 0 errors.
- [ ] 9.2 Delete `apps/app` — deferred to the renderer-migration change.
- [x] 9.3 `AGENTS.md` updated with `apps/desktop` (Electron) + commands.
- [x] 9.4 `openspec/PRD.md` constraint updated: Electrobun → Electron (electron-vite + electron-builder).
- [x] 9.5 Shell change is spec-complete; `desktop-electron-app` ready to archive (renderer migration tracked separately).

## Notes for the executor

- **The Electron shell is complete and verified** (build, typecheck, lint, spike, packaging). What remains is the **renderer migration** — deliberately a separate change (`desktop-renderer-migration`) because it's blocked on the Eden→Hono-RPC client migration (a design Non-Goal here).
- **flake.nix** carries the proven Electron runtime libs + `python3`/`gnumake`/`pkg-config` (node-gyp needs Python to rebuild `node-pty`). System `bun`/`node` are not re-provided by the flake.
- **Dev native rebuild:** after `bun install`, run `cd apps/desktop && bun run rebuild` (in the nix shell) once so `node-pty` matches Electron's ABI for `electron-vite dev`.
- **No `apps/server` changes** — `createServer({ port:0, hooks:{onOpenFolderDialog} })` is consumed verbatim.
