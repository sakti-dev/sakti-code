# desktop-preload Specification

## Purpose

The desktop-preload capability provides the sandboxed Electron preload script and shared contract types that bridge the main process and the renderer. It defines the IPC channel constants, the typed `SaktiDesktopAPI` surface exposed to the renderer via `contextBridge`, and the `ServerConfig` shape used for URL resolution. The shared types live in `electron/shared/` and are imported by both main and preload.

## Requirements

### Requirement: IPC channel constants

The system SHALL define IPC channel name constants in `electron/shared/channels.ts` as a const object (`IPC`). The three channels SHALL be: `get-server-config` (invoke/handle), `shell:openExternal` (invoke/handle), and `log:message` (send/on). These constants SHALL be the single source of channel names used by both `ipcMain` and `ipcRenderer` code.

#### Scenario: channel names are centralized

- **WHEN** any IPC handler is registered or invoked
- **THEN** the channel name is a reference to `IPC.<key>`, not a string literal

### Requirement: Server config contract type

The system SHALL define a `ServerConfig` interface in `electron/shared/server-config.ts` with a single field `baseUrl: string`. This type SHALL be the return type of the `get-server-config` IPC handler and SHALL be used by both the preload script (for the return type of `server.getConfig()`) and main process (for the handler's return value).

#### Scenario: ServerConfig is shared between main and preload

- **WHEN** `electron/shared/server-config.ts` is imported by main or preload
- **THEN** both sides resolve the same `{ baseUrl: string }` interface

### Requirement: SaktiDesktopAPI contract type

The system SHALL define a `SaktiDesktopAPI` interface in `electron/shared/ipc-api.ts` that describes the full renderer-accessible surface. It SHALL contain:
- `log.send(entry: LogEntry): void` — fire-and-forget log forwarding
- `server.getConfig(): Promise<ServerConfig>` — resolve the embedded server URL
- `shell.openExternal(url: string): Promise<void>` — open a URL in the OS browser

The `LogEntry` type SHALL be imported from `@sakti-code/logger` and `ServerConfig` from the shared types.

#### Scenario: SaktiDesktopAPI is the renderer's only bridge

- **WHEN** the renderer accesses `window.sakti`
- **THEN** it resolves to an object conforming to `SaktiDesktopAPI`
- **AND** only the three methods (`log.send`, `server.getConfig`, `shell.openExternal`) are available

### Requirement: Preload script with contextBridge

The preload script SHALL use `contextBridge.exposeInMainWorld("sakti", api)` to expose the typed API. The implementation SHALL use `ipcRenderer.invoke` for request-response channels (`get-server-config`, `shell:openExternal`) and `ipcRenderer.send` for fire-and-forget (`log:message`). The preload SHALL import channel names from the shared constants file, never use string literals.

#### Scenario: preload exposes API at window.sakti

- **WHEN** the preload script runs
- **THEN** `window.sakti` is set to an object with `log`, `server`, and `shell` namespaces
- **AND** the renderer can call `window.sakti.server.getConfig()` to get the server URL

#### Scenario: IPC channels use shared constants

- **WHEN** the preload sends an IPC message
- **THEN** the channel name is `IPC.getServerConfig`, `IPC.shellOpenExternal`, or `IPC.logMessage`

### Requirement: Preload bundle format

The preload bundle SHALL be emitted as CommonJS (`.cjs`) for Electron sandbox compatibility. All dependencies except `electron` SHALL be bundled inline (`externalizeDeps: false` in the electron-vite config) because sandboxed require() only allows `electron`.

#### Scenario: preload builds to CJS

- **WHEN** `electron-vite build` runs
- **THEN** the preload entry produces `out/preload/index.cjs`
- **AND** the file uses CommonJS module format

#### Scenario: only electron stays external

- **WHEN** the preload bundle is analyzed
- **THEN** `electron` is the only external dependency
- **AND** all other imports (including shared types) are bundled inline

### Requirement: Renderer type declaration

The system SHALL provide a type declaration file (`src/lib/electron.ts`) that augments `globalThis` with a `sakti` property typed as `SaktiDesktopAPI`. This file SHALL use `import type` only (erased at build time) so that no Electron or Node code enters the renderer bundle.

#### Scenario: renderer has types for window.sakti

- **WHEN** the renderer accesses `window.sakti`
- **THEN** TypeScript resolves it as `SaktiDesktopAPI`
- **AND** no Electron module is included in the renderer bundle
