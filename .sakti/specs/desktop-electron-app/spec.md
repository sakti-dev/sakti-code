# desktop-electron-app Specification

## Purpose

The desktop-electron-app capability provides the Electron shell that embeds the Hono REST+WebSocket server (`@sakti-code/server`) in-process and hosts the SolidJS renderer same-origin. It owns window lifecycle, IPC handler registration, native OS integration (dialogs, shell, logging), and build/packaging for Linux distribution.

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

The system SHALL host the existing `@sakti-code/server` inside the Electron main process by calling `createServer({ port, hostname, staticDir, migrationsFolder, hooks })`. In development the server SHALL bind to a fixed port `3001`; in the packaged app the server SHALL bind to an OS-assigned ephemeral port (`port: 0`). The static file directory and migrations folder paths SHALL differ between dev and packaged. The server SHALL NOT run as a separate OS process in the packaged app.

#### Scenario: dev server binds to fixed port 3001

- **WHEN** the main process starts in development mode (`app.isPackaged === false`)
- **THEN** `createServer` is called with `port: 3001`, `hostname: "127.0.0.1"`
- **AND** main retains the server URL for renderer bootstrap

#### Scenario: packaged server binds to ephemeral port

- **WHEN** the packaged application launches
- **THEN** `createServer` is called with `port: 0`, binding to an OS-assigned ephemeral port

#### Scenario: server paths differ between dev and packaged

- **WHEN** the app is in development mode
- **THEN** `staticDir` is `null` and `migrationsFolder` resolves to the workspace `packages/db/migrations/`
- **WHEN** the app is packaged
- **THEN** `staticDir` resolves to `../renderer` (relative to the main bundle directory) and `migrationsFolder` resolves to `../migrations`

#### Scenario: packaged app has no standalone server process

- **WHEN** the packaged application launches
- **THEN** a single Electron process serves both REST and WebSocket on the embedded port

### Requirement: Renderer bootstrap and same-origin architecture

The main process SHALL load the renderer directly from the embedded server URL in packaged mode (`win.loadURL(serverUrl)`). In dev mode the renderer SHALL load from `ELECTRON_RENDERER_URL` (the Vite dev server). The renderer's API client SHALL target `window.location.origin` for REST and WebSocket — because the renderer is served from the same origin as the embedded server, no CORS or IPC URL-proxy is needed. The renderer SHALL remain runnable as a standalone Vite app against `apps/server` on port `3001` without any Electron runtime present, via the `get-server-config` IPC channel providing the fallback URL.

#### Scenario: packaged renderer is same-origin with embedded server

- **WHEN** the packaged app loads
- **THEN** `win.loadURL(serverUrl)` loads the renderer from the embedded server
- **AND** the renderer's `window.location.origin` equals the server's base URL
- **AND** all REST and WebSocket calls go to the same origin without CORS

#### Scenario: dev renderer uses Vite dev server

- **WHEN** `electron-vite dev` starts
- **THEN** the renderer loads from `ELECTRON_RENDERER_URL` (the Vite HMR dev server)
- **AND** Vite proxies `/api` to `localhost:3001` and `/ws` to `ws://localhost:3001`

#### Scenario: renderer runs without Electron

- **WHEN** `src/` is served by Vite standalone and pointed at `apps/server` on `:3001`
- **THEN** the UI functions with no Electron runtime present

### Requirement: Hardened preload with contextBridge

The BrowserWindow SHALL be created with `sandbox: true`, `nodeIntegration: false`, and `contextIsolation: true`. The preload script SHALL expose capabilities to the renderer exclusively via `contextBridge.exposeInMainWorld("sakti", api)`. The shared contract types (`SaktiDesktopAPI`, `ServerConfig`, `IPC` channel constants) SHALL live under `electron/shared/` and be imported by both main and preload.

#### Scenario: no direct Node access in renderer

- **WHEN** the renderer is loaded
- **THEN** `require` and Node core modules are not reachable from the renderer context
- **AND** only the explicitly exposed `window.sakti` API is available

#### Scenario: preload emits CJS for sandbox

- **WHEN** `electron-vite build` runs
- **THEN** the preload bundle is emitted as `index.cjs` (CommonJS)
- **AND** all dependencies except `electron` are bundled inline

### Requirement: Minimal security-scoped IPC surface

The system SHALL register exactly these IPC handlers: `get-server-config` (returns `{ baseUrl }`), `shell:openExternal` (opens a URL in the system browser after validating its protocol), and `log:message` (forwards renderer log entries to the desktop pino logger with `origin: "renderer"` tag). `shell:openExternal` SHALL reject any URL whose protocol is not in the allowlist `{ http:, https:, mailto:, tel:, ftp:, sftp: }`.

#### Scenario: disallowed protocol is rejected

- **WHEN** the renderer invokes `shell:openExternal` with a `file:` or `javascript:` URL
- **THEN** the handler throws an `Error` and no shell action occurs
- **AND** a warning is logged

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

The main process SHALL stop the embedded server via `server.stop()` during the `before-quit` event — including HMR-induced main restarts — before the process exits, so the bound port is released. A `shuttingDown` flag SHALL prevent re-entry.

#### Scenario: port is released on quit

- **WHEN** the application quits (`before-quit` fires)
- **THEN** `event.preventDefault()` is called
- **AND** `server.stop()` is awaited
- **AND** the ephemeral port is released
- **AND** `app.quit()` is called again to complete the shutdown

#### Scenario: re-entry is prevented

- **WHEN** `before-quit` fires while `shuttingDown` is already `true`
- **THEN** no action is taken (the second `app.quit()` from the prior shutdown is in-flight)

### Requirement: Window state persistence

The system SHALL persist the window's position and dimensions (`x`, `y`, `width`, `height`) to `~/.sakti/window-state.json`. On startup, the window SHALL restore to the persisted state, clamped to a minimum of `600×400`. State changes during `resize` and `move` events SHALL be debounced (500ms). The final state SHALL be flushed synchronously on `close`. If the state file is missing or corrupt, the default frame (`1200×800` at `(100, 100)`) SHALL be used.

#### Scenario: window restores saved position

- **WHEN** the app launches after a previous session
- **THEN** the BrowserWindow is created with the saved `x`, `y`, `width`, `height` values
- **AND** dimensions are clamped to at least `600×400`

#### Scenario: debounced save on resize

- **WHEN** the window is resized
- **THEN** after a 500ms pause the new frame is written to `~/.sakti/window-state.json`

#### Scenario: final state flushed on close

- **WHEN** the window closes
- **THEN** the pending debounced save is flushed immediately

### Requirement: Renderer console forwarding

The main process SHALL forward renderer console messages to the main-process logger via the `console-message` webContents event, prefixed with `[renderer]`, for observability during development.

#### Scenario: renderer console appears in main logs

- **WHEN** the renderer logs a message
- **THEN** it appears in the main process stdout prefixed with `[renderer]`

### Requirement: Linux Wayland support

On Linux, the system SHALL hint Electron to prefer native Wayland when available via `--ozone-platform-hint=auto` and enable fractional scale via `--enable-features=WaylandFractionalScaleV1`. In development, the dev script passes `--ozone-platform=wayland` as a real CLI arg (which Chromium respects). The hint ensures Wayland is also preferred in packaged builds.

#### Scenario: Wayland is hinted on Linux

- **WHEN** the app starts on Linux
- **THEN** `app.commandLine.appendSwitch("ozone-platform-hint", "auto")` is called
- **AND** `app.commandLine.appendSwitch("enable-features", "WaylandFractionalScaleV1")` is called

### Requirement: DPR scale compensation

The renderer's HTML entry SHALL include a synchronous script that reads a `?dpr=` query parameter (passed by the main process) and applies a CSS `zoom` to compensate when the browser's `devicePixelRatio` is lower than the OS scale factor.

#### Scenario: DPR zoom compensates for over-scale

- **WHEN** `?dpr=2` is passed and `window.devicePixelRatio` is `1`
- **THEN** `document.documentElement.style.zoom` is set to `2`
- **WHEN** `?dpr=1` is passed or the DPR already matches
- **THEN** no zoom is applied

### Requirement: Desktop file logger

The main process SHALL create a pino-based file logger writing to `desktop.log` under the server's log directory, accessible via `getLogDir()`. Renderer log entries forwarded via the `log:message` IPC channel SHALL be emitted through this logger with `origin: "renderer"`. If pino initialization fails, a no-op logger SHALL be used so app startup and renderer logging never break.

#### Scenario: renderer log entries go to desktop.log

- **WHEN** the renderer sends a log entry via IPC
- **THEN** the entry is re-emitted through the pino desktop logger with `origin: "renderer"`

#### Scenario: pino failure degrades gracefully

- **WHEN** `createPinoLogger` throws
- **THEN** a no-op logger is used
- **AND** app startup continues normally

### Requirement: electron-vite build and electron-builder packaging

The package SHALL provide `dev` (via `vp run desktop#dev`), `build:electron` (`electron-vite build`), and `package` scripts. The `package` script SHALL run `vp run -r build` (compiling all consumed `@sakti-code/*` workspace packages to `dist/` across the monorepo) before `electron-vite build`, then run `electron-builder`. Workspace packages (`@sakti-code/*`), `@vscode/ripgrep`, `pino`/`pino-roll`, and native FFI bindings (`@ff-labs/fff-node`) SHALL remain external in the Electron main bundle. The renderer bundle SHALL use the `solid-js/h` JSX runtime for HMR correctness. `package` SHALL produce a runnable Linux build that launches the app window with the embedded server responding on its ephemeral port — the packaged `node_modules/@sakti-code/*` SHALL resolve to compiled JavaScript, never raw `.ts`.

#### Scenario: dev launches with HMR

- **WHEN** `electron-vite dev` runs
- **THEN** the renderer supports Vite HMR
- **AND** a main-source change restarts the main process
- **AND** a preload change reloads the renderer

#### Scenario: package produces a runnable Linux build

- **WHEN** the `package` script runs on Linux
- **THEN** `vp run -r build` compiles workspace packages to `dist/` before bundling
- **AND** `electron-builder` emits an artifact that launches the app window
- **AND** the embedded server responds on its ephemeral localhost port
- **AND** no `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` error occurs at launch

#### Scenario: native dependencies remain external

- **WHEN** the packaged app launches
- **THEN** `@ff-labs/fff-node` and `@vscode/ripgrep` are loaded from the unpacked `node_modules`
- **AND** they are not inlined into the Electron main bundle

#### Scenario: pino-roll stays external

- **WHEN** the packaged app launches
- **THEN** `pino` and `pino-roll` resolve from `node_modules` (not inlined), so that `pino.transport({ target: "pino-roll" })` resolves correctly at runtime in the worker thread
