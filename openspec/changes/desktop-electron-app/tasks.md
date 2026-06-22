## 1. Spike — verify `node:sqlite` + embedded server in Electron

- [ ] 1.1 Create a throwaway `apps/desktop` skeleton: `package.json` with `electron`, `electron-vite`, `@sakti-code/server` (workspace), and a minimal `electron/main/index.ts` that calls `createServer({ port: 0, hostname: "127.0.0.1" })` and logs `{ port, url }`. `bun install`.
- [ ] 1.2 Launch Electron (via `electron-vite dev` or `electron .`); from a scratch renderer (or `curl`) hit `GET http://127.0.0.1:<port>/health` and trigger a DB write (e.g. `POST /api/projects`). Confirm `node:sqlite` (`DatabaseSync`) works unflagged inside Electron's bundled Node.
- [ ] 1.3 **Decision gate:** if `node:sqlite` fails, switch `packages/db` to `better-sqlite3` (per design Decision 7 / AGENTS.md "bun:sqlite→better-sqlite3 re-wire"), rebuild via `@electron/rebuild`, and re-verify. Record the outcome before proceeding.
- [ ] 1.4 Verify `server.stop()` releases the port on `before-quit` (bind a fixed port, quit, rebind — should succeed).

## 2. Scaffold `apps/desktop` (single-package structure)

- [ ] 2.1 Create `apps/desktop/package.json` (`@sakti-code/desktop`, private): scripts `dev`/`build`/`package`/`typecheck`; deps `electron`, `electron-vite`, `electron-builder`, `@electron-toolkit/utils`, `@electron-toolkit/preload`, `@electron/rebuild`, `@sakti-code/server` (workspace), `solid-js`, `vite-plugin-solid`, `@tailwindcss/vite`, `tailwindcss`.
- [ ] 2.2 Create `electron.vite.config.ts` wiring three entries with **custom paths**: `main` → `electron/main/index.ts`, `preload` → `electron/preload/index.ts`, `renderer` with `root: "src"` and `solid()` + `tailwindcss()` plugins and the `~` → `src` alias.
- [ ] 2.3 Create tsconfigs: solution-style `tsconfig.json` referencing `tsconfig.web.json` (renderer, includes `src/`) and `tsconfig.electron.json` (node, includes `electron/`).
- [ ] 2.4 Create `electron-builder.yml` (Linux target stub; `asar: true`; `directories`/`files` pointing at electron-vite output; empty `asarUnpack` for now — filled in §7).
- [ ] 2.5 Verify `electron-vite build` emits main + preload + renderer artifacts with no path-resolution errors.

## 3. Main process — embedded server + lifecycle

- [ ] 3.1 Create `electron/main/index.ts`: on `app.whenReady()`, call `createServer({ port: 0, hostname: "127.0.0.1", hooks: { onOpenFolderDialog } })`, store `{ port, url, stop }`, then `createWindow()`.
- [ ] 3.2 Create `electron/main/lifecycle.ts`: `createWindow()` builds a `BrowserWindow` with `webPreferences: { preload, sandbox: true, nodeIntegration: false, contextIsolation: true }`; loads dev URL in dev (`ELECTRON_RENDERER_URL`) else the built `index.html`; `setWindowOpenHandler` → `shell.openExternal` + `{ action: "deny" }`.
- [ ] 3.3 Wire `before-quit` (and main-HMR restart) to `await server.stop()`; guard against double-shutdown.
- [ ] 3.4 `app.on("window-all-closed")` quits on non-darwin; `activate` re-creates the window on darwin.
- [ ] 3.5 Verify: launch dev, confirm the server health endpoint responds on the embedded port, and quitting releases the port.

## 4. Preload + shared contract (type-only)

- [ ] 4.1 Create `electron/shared/ipc-api.ts` exporting the `SaktiDesktopAPI` type, `channels.ts` (channel-name constants), and `server-config.ts` (`{ baseUrl: string }` type). Keep all exports **type-only** except tiny string constants.
- [ ] 4.2 Create `electron/preload/index.ts`: `contextBridge.exposeInMainWorld("sakti", { server: { getConfig }, shell: { openExternal } })`. CJS output (sandbox-safe); externalize only `electron`.
- [ ] 4.3 Create `src/lib/electron.ts` in the renderer: `import type { SaktiDesktopAPI }` from `../../electron/shared/ipc-api` and a `declare global { interface Window { sakti: SaktiDesktopAPI } }`.
- [ ] 4.4 Verify no Node-targeted code leaks: `rg "^import .* from \"electron\"|require\\(" src/` returns nothing (renderer is Electron-free).

## 5. IPC handlers + folder-dialog hook

- [ ] 5.1 **TDD (RED):** write `electron/main/__tests__/shell.test.ts` — `validateUrlProtocol` accepts `https:`/`mailto:` and rejects `file:`/`javascript:`/`data:`/`shell:`. Run → RED.
- [ ] 5.2 Implement `electron/main/ipc/shell.ts`: `shell:openExternal` handler using the validated allowlist `{ http, https, mailto, tel, ftp, sftp }`. Run → GREEN. Typecheck + `bun x ultracite fix`.
- [ ] 5.3 Implement `electron/main/ipc/server-config.ts`: `get-server-config` returns `{ baseUrl: "http://127.0.0.1:<port>" }`.
- [ ] 5.4 Implement `electron/main/ipc/log.ts`: `log:message` → forwards to the main logger.
- [ ] 5.5 Implement `hooks.onOpenFolderDialog` in main using `dialog.showOpenDialog({ properties: ["openDirectory"] })`, returning the path or `null`; pass it into `createServer`.
- [ ] 5.6 Verify: trigger the server's `/api/dialog` folder route from the renderer; confirm the native picker opens and the selected path round-trips over HTTP.

## 6. Migrate renderer from `apps/app`

- [ ] 6.1 Move `apps/app/src/**` into `apps/desktop/src/` (components, stores, lib, `index.html`, `app.tsx`, css). Preserve the `~`/`@/` alias in `electron.vite.config.ts` renderer block.
- [ ] 6.2 Update `src/lib/api.ts`: resolve `baseUrl` from `window.sakti.server.getConfig()` when running under Electron; fall back to `http://localhost:3001` (via Vite proxy) when standalone. Keep real `fetch` + WebSocket.
- [ ] 6.3 Replace the Electrobun `src/lib/bun/` shim (`window-state`, etc.) with Electron equivalents — hand-rolled window-state persistence via main IPC + a JSON file (design Open Question Q3), unless the spike favors `electron-store`.
- [ ] 6.4 Move `apps/app` test setup (`vitest.config.ts`, `src/test-setup`) into `apps/desktop`; run the existing renderer tests; fix breakages from the path move.
- [ ] 6.5 Verify: `cd apps/desktop && bun x vitest run` passes the migrated renderer tests; `bun typecheck` is clean.

## 7. Native module audit + rebuild setup

- [ ] 7.1 Audit the dependency tree for native modules (`bun pm ls` / inspect `packages/{agent,db,tools}` and `pi-ai`): look for `better-sqlite3`, `tree-sitter*`, tokenizers, `@mastra/fastembed`, `@napi-rs/*`.
- [ ] 7.2 Add `@electron/rebuild` to the build flow; list any native offenders in `electron-builder.yml` `asarUnpack`.
- [ ] 7.3 Verify a clean `electron-vite build` followed by `electron-builder --dir` (unpacked) launches and the embedded server + DB work in the packaged dir.

## 8. Packaging — Linux build

- [ ] 8.1 Finalize `electron-builder.yml`: Linux target (`AppImage` and/or `deb`), `productName`, `appId`, icon, `asar: true`, `files`/`extraResources` (include `packages/db` migrations if not embedded by `createServer`'s `migrationsFolder`).
- [ ] 8.2 Run `electron-builder`; confirm the artifact installs/launches and the app window shows the renderer with the embedded server responding.
- [ ] 8.3 Smoke-test end-to-end in the packaged build: open a project folder (native dialog), start a session (WS streaming), confirm a DB write persists across restart.

## 9. Verification, cleanup, docs

- [ ] 9.1 Run `bun typecheck` (0 errors) and `bun x ultracite fix` (0 remaining diagnostics) across `apps/desktop`.
- [ ] 9.2 Delete `apps/app` (Electrobun) once the renderer is fully migrated and green; remove its workspace entry and the `dev:web`/`dev:desktop` scripts.
- [ ] 9.3 Update `AGENTS.md`: replace the Electrobun app description with `apps/desktop` (Electron), add the `dev`/`build`/`package` commands and the embedded-server note.
- [ ] 9.4 Update `openspec/PRD.md` technical-constraints table: "Desktop framework: Electrobun" → "Electron (electron-vite + electron-builder)".
- [ ] 9.5 Final `openspec status --change "desktop-electron-app"` is apply-ready; all §1–§8 tasks checked.

## Notes for the executor

- **De-risk first.** Task §1 (the spike) resolves the single highest-uncertainty item — whether `node:sqlite` runs inside Electron unflagged. Do **not** start §2–§8 in earnest until §1.3 records a decision. The whole DB-driver story (and whether `@electron/rebuild` is even needed) hinges on it.
- **Conventions** (AGENTS.md): TDD where unit-testable (RED → GREEN → commit); `bun typecheck` + `bun x ultracite fix` before each commit; `exactOptionalPropertyTypes: true` is on (conditional spread); SolidJS uses `class`/`for` not `className`/`htmlFor`.
- **No server changes expected.** `createServer({ port: 0, hooks })` already supports embedding. If you find yourself editing `apps/server`, stop — that's a separate change (and would modify `server-rest-api`).
- **IPC contract stays type-only** in `electron/shared/`. The renderer imports it via `import type` so nothing Node-targeted enters the renderer bundle (enforced by the §4.4 grep check).
- **Scope guardrails:** Linux target only for v1; no auto-updater/signing/notarization (separate change); no tray/multi-window/native notifications.
