## Why

sakti-code's desktop shell runs on Electrobun (`apps/app`), whose development has stalled and whose CEF webview story is fragile. The rewrite's server is already a clean Hono app on `@hono/node-server` with REST + WebSocket, and it already exposes `createServer({ port, hooks })` returning `{ url, port, stop }` — purpose-built for embedding. Migrating to Electron gives a mature cross-platform runtime, first-class Vite tooling (electron-vite + electron-builder), and a renderer that stays a plain, process-agnostic web app (real `fetch` + WS to `127.0.0.1`). This change establishes the Electron shell so the UI can move off Electrobun with **no server duplication** and a renderer that could still run in a browser.

## What Changes

- Create `apps/desktop` — a single-package Electron app (`@sakti-code/desktop`) laid out as `src/` (the SolidJS/Vite renderer, migrated from `apps/app/src`) + `electron/` (`main/`, `preload/`, `shared/`). One package, one `electron.vite.config.ts`.
- Build/pack stack: **electron-vite + electron-builder + `@electron-toolkit/{utils,preload}`** (not Electron Forge). `electron.vite.config.ts` wires the three Vite entries; `electron-builder.yml` handles packaging/signing/publish.
- **Embedded server, zero server changes**: Electron main calls the existing `createServer({ port: 0 })` from `apps/server` to bind an **ephemeral localhost port** and gets `{ url, port, stop }`. The server's existing `hooks.onOpenFolderDialog` is backed by Electron's native `dialog` in main, so the renderer keeps using the existing `/api/dialog` REST route — **no separate IPC for dialogs**.
- **Renderer stays process-agnostic**: `lib/api.ts` does real `fetch` + WebSocket to the embedded port, identical to today; it also runs standalone against `apps/server` on `:3001` for fast UI iteration.
- **Minimal, security-scoped IPC** (only what HTTP can't do): `get-server-config` (port bootstrap), `shell:openExternal` (with a URL-protocol allowlist), `log:message` (renderer → main pino).
- **Hardened preload**: `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`, `contextBridge`-only exposure.
- Delete `apps/app` (Electrobun) once the renderer is migrated.

## Capabilities

### New Capabilities
- `desktop-electron-app`: The Electron desktop shell — single-package layout (`src/` renderer + `electron/{main,preload,shared}`), the electron-vite/electron-builder pipeline, embedded Hono server lifecycle in main, the minimal security-scoped IPC bridge, the contextBridge preload contract, and the dev/build/package scripts.

### Modified Capabilities
<!-- None. This change consumes server-rest-api (createServer) and agent-streaming (WS) without changing their requirements. -->

## Impact

- **New code**: `apps/desktop/` — `electron.vite.config.ts`, `electron-builder.yml`, `src/` (migrated renderer), `electron/main/{index,lifecycle,ipc/*}.ts`, `electron/preload/index.ts`, `electron/shared/{ipc-api,channels,server-config}.ts`.
- **Dependencies**: adds `electron`, `electron-vite`, `electron-builder`, `@electron-toolkit/{utils,preload}`, `@electron/rebuild`; moves `solid-js`, `vite-plugin-solid`, `tailwindcss` from `apps/app`. `@sakti-code/server` consumed as a workspace package, **unchanged**.
- **Consumes but does not modify**: `apps/server` (`createServer`, `buildApp`, `createContext`), `packages/{agent,db,tools}`.
- **Runtime**: dev = `electron-vite dev` (renderer HMR + main/preload watch + Electron launch + embedded server on ephemeral port); build = `electron-vite build`; package = `electron-builder`.
- **Risks**: (1) the server's DB driver is `node:sqlite` (`DatabaseSync`) — must work inside Electron's bundled Node; verify `experimental-sqlite` availability, with a `better-sqlite3` fallback in `packages/db` (native rebuild via `@electron/rebuild`). (2) Confirm no workspace dependency (tokenizers/tree-sitter) pulls a native module requiring rebuild.
- **BREAKING**: removes `apps/app` (Electrobun). The PRD's "Desktop framework: Electrobun" constraint is updated to Electron.
