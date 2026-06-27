# desktop-electron-app Specification

## Purpose
TBD - created by archiving change desktop-electron-app. Update Purpose after archive.
## Requirements
### Requirement: Single-package desktop app structure
The system SHALL provide an `apps/desktop` workspace package (`@sakti-code/desktop`) whose Vite renderer root is `src/`, and whose Electron main, preload, and shared-contract code live under a sibling `electron/` directory. The package SHALL be buildable from a single `electron.vite.config.ts` that configures three entries — main (`electron/main/index.ts`), preload (`electron/preload/index.ts`), and renderer (root `src/`). No Electron main or preload source SHALL live under `src/`.

#### Scenario: renderer root is pure src
- **WHEN** the renderer Vite build runs
- **THEN** its root is `apps/desktop/src`
- **AND** no file under `electron/` is included in the renderer bundle

#### Scenario: three entries are configured
- **WHEN** `electron-vite` builds the package
- **THEN** it emits a main bundle, a preload bundle, and a renderer build, each from the configured entry path

### Requirement: Embedded Hono server in the main process
The system SHALL host the existing `@sakti-code/server` inside the Electron main process by calling `createServer({ port: 0, hostname: "127.0.0.1", hooks })` and SHALL resolve the OS-assigned port from the returned `{ port, url, stop }`. The server SHALL NOT run as a separate OS process in the packaged app.

#### Scenario: server binds an ephemeral localhost port
- **WHEN** the main process starts
- **THEN** `createServer` binds to `127.0.0.1` on an OS-assigned port
- **AND** main retains the resolved port for renderer bootstrap

#### Scenario: packaged app has no standalone server process
- **WHEN** the packaged application launches
- **THEN** a single Electron process serves both REST and WebSocket on the embedded port

### Requirement: Renderer bootstrap and process-agnosticism
The main process SHALL deliver the embedded server's base URL to the renderer via the `get-server-config` IPC handler. The renderer's `lib/api.ts` SHALL target that base URL with real `fetch` and WebSocket — identical to the standalone configuration — and SHALL contain no Electron-specific import. The renderer SHALL remain runnable as a plain Vite app against `apps/server` on a fixed port (e.g. `:3001`) without any Electron runtime present.

#### Scenario: renderer learns the server URL
- **WHEN** the renderer invokes the exposed server-config call
- **THEN** it resolves to `{ baseUrl: "http://127.0.0.1:<embedded-port>" }`
- **AND** subsequent REST and WebSocket calls target that URL

#### Scenario: renderer runs without Electron
- **WHEN** `src/` is served by Vite standalone and pointed at `apps/server` on `:3001`
- **THEN** the UI functions with no Electron runtime present

### Requirement: Hardened preload with contextBridge
The BrowserWindow SHALL be created with `sandbox: true`, `nodeIntegration: false`, and `contextIsolation: true`. The preload script SHALL expose capabilities to the renderer exclusively via `contextBridge.exposeInMainWorld`, and SHALL expose nothing beyond the desktop API (server config, shell open, logging).

#### Scenario: no direct Node access in renderer
- **WHEN** the renderer is loaded
- **THEN** `require` and Node core modules are not reachable from the renderer context
- **AND** only the explicitly exposed `window.sakti` API is available

### Requirement: Minimal security-scoped IPC surface
The system SHALL register exactly these IPC handlers: `get-server-config` (returns `{ baseUrl }`), `shell:openExternal` (opens a URL in the system browser after validating its protocol), and `log:message` (forwards renderer logs to the main logger). `shell:openExternal` SHALL reject any URL whose protocol is not in the allowlist `{ http, https, mailto, tel, ftp, sftp }`.

#### Scenario: disallowed protocol is rejected
- **WHEN** the renderer invokes `shell:openExternal` with a `file:` or `javascript:` URL
- **THEN** the handler throws and no shell action occurs

#### Scenario: allowed protocol opens externally
- **WHEN** the renderer invokes `shell:openExternal` with an `https:` URL
- **THEN** the URL is opened in the system default browser

### Requirement: Native folder dialog via the server hook
The main process SHALL implement `hooks.onOpenFolderDialog` using Electron's `dialog.showOpenDialog` and pass it into `createServer`. The renderer SHALL open project folders through the existing server REST dialog route (which invokes that hook), not through a dedicated IPC channel.

#### Scenario: renderer opens a folder via REST
- **WHEN** the renderer calls the server's folder-dialog REST route
- **THEN** Electron's native directory picker is shown
- **AND** the selected path (or `null` when canceled) is returned to the renderer over HTTP

### Requirement: Graceful server shutdown
The main process SHALL stop the embedded server via `server.stop()` during quit — including HMR-induced main restarts — before the process exits, so the bound port is released.

#### Scenario: port is released on quit
- **WHEN** the application quits
- **THEN** the embedded HTTP/WS server is stopped
- **AND** the ephemeral port is released for reuse

### Requirement: electron-vite build and electron-builder packaging
The package SHALL provide `dev` (`electron-vite dev`), `build` (`electron-vite build`), and `package` scripts. The `package` script SHALL run `turbo build` (compiling all consumed `@sakti-code/*` workspace packages to `dist/`) before `electron-vite build`, then run `electron-builder`. Workspace packages SHALL remain externalized in the Electron main (not bundled); native modules (`node-pty`) and native platform binaries (the ffi `@ff-labs/fff-bin-*` family) SHALL stay external and `asarUnpack`'d. `package` SHALL produce a runnable Linux build that launches the app window with the embedded server responding on its ephemeral port — the packaged `node_modules/@sakti-code/*` SHALL resolve to compiled JavaScript, never raw `.ts`.

#### Scenario: dev launches with HMR
- **WHEN** `electron-vite dev` runs
- **THEN** the renderer supports Vite HMR
- **AND** a main-source change restarts the main process
- **AND** a preload change reloads the renderer
- **AND** workspace packages resolve to source `.ts` via the `"development"` export condition

#### Scenario: package produces a runnable Linux build
- **WHEN** the `package` script runs on Linux
- **THEN** `turbo build` compiles workspace packages to `dist/` before bundling
- **AND** `electron-builder` emits an artifact that launches the app window
- **AND** the embedded server responds on its ephemeral localhost port
- **AND** no `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` error occurs at launch

#### Scenario: native dependencies remain external
- **WHEN** the packaged app launches
- **THEN** `node-pty` and the ffi platform binaries are loaded from the unpacked `node_modules`
- **AND** they are not inlined into the Electron main bundle

