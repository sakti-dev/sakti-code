# desktop-renderer-app Specification

## Purpose

The desktop-renderer-app capability provides the SolidJS application shell: the render entry point, `ThemeProvider` with Kobalte color-mode and dark-class sync, `StoreProvider` that initializes the server store, session and terminal registries, WebSocket client, and action facade, and the root `WorkspaceLayout` composition. It owns the HTML entry (`index.html`) with DPR compensation script and the Root element bootstrap.

## Requirements

### Requirement: Application entry point

The renderer SHALL mount a SolidJS app at the `#app` element, composed of `ThemeProvider` wrapping `StoreProvider` wrapping `WorkspaceLayout`. If the root element is missing, the system SHALL throw an `Error`.

#### Scenario: app mounts when root exists

- **WHEN** `index.html` loads with `<div id="app">`
- **THEN** SolidJS mounts the component tree: `ThemeProvider > StoreProvider > WorkspaceLayout`

#### Scenario: app throws when root is missing

- **WHEN** the `#app` element is not found
- **THEN** an `Error` with message "Root element #app not found" is thrown

### Requirement: Dark-mode theme system

The system SHALL use Kobalte's `ColorModeProvider` with `createLocalStorageManager("sakti-theme")` for color-mode persistence. The initial mode SHALL default to `"dark"` and SHALL be configurable via the `initialColorMode` prop. A synchronous inline `<script>` in the HTML `<head>` SHALL set `data-kb-theme`, `color-scheme`, and the `.dark` class before first paint to prevent flash of unstyled content. A `DarkClassSync` component SHALL keep the `.dark` class in sync at runtime whenever the user toggles color mode.

#### Scenario: initial dark mode is set before first paint

- **WHEN** the HTML loads
- **THEN** the inline script sets `document.documentElement.dataset.kbTheme`, `document.documentElement.style.colorScheme`, and toggles the `.dark` class synchronously before React hydration or SolidJS render

#### Scenario: theme persists across reloads

- **WHEN** the user toggles from dark to light mode
- **THEN** `"light"` is written to `localStorage` key `"sakti-theme"`
- **AND** on next load, the inline script reads the stored value and applies it

#### Scenario: .dark class stays in sync at runtime

- **WHEN** the user toggles color mode via Kobalte
- **THEN** `DarkClassSync` adds or removes the `.dark` class on `document.documentElement`

### Requirement: DPR zoom compensation

The HTML entry SHALL include a synchronous inline script in `<head>` that reads a `?dpr=` query parameter and compensates via CSS `zoom` if the browser's `devicePixelRatio` is lower than the expected scale. This SHALL run before first paint to prevent an unscaled flash.

#### Scenario: DPR zoom compensates when browser ratio is lower

- **WHEN** the URL contains `?dpr=2` and `window.devicePixelRatio` is `1`
- **THEN** `document.documentElement.style.zoom` is set to `2`
- **WHEN** `?dpr=1` or no DPR parameter is present
- **THEN** no zoom is applied

### Requirement: Store provider initialization

The `StoreProvider` SHALL create all top-level state singletons on mount and expose them via SolidJS context (`StoreContext`). It SHALL initialize in order: `createServerStore` (server session/project metadata), `SessionRegistry` (LRU-capped session stores), `TerminalRegistry` (terminal stores), Hono RPC client targeting `window.location.origin`, WebSocket client (with server store, session registry, terminal registry as deps), and Actions facade (with API client, WS client, server store, and session registry as deps). Context consumers SHALL use `useStore()` which SHALL throw if called outside a provider.

#### Scenario: store context is populated on mount

- **WHEN** `StoreProvider` mounts
- **THEN** a `ServerStore` is created
- **AND** a `SessionRegistry` is created with LRU cap 3
- **AND** a `TerminalRegistry` is created
- **AND** an Hono RPC client is created at `window.location.origin`
- **AND** a `WsClient` is created and connects
- **AND** `Actions` are created

#### Scenario: useStore throws outside provider

- **WHEN** `useStore()` is called without a `StoreProvider` ancestor
- **THEN** an `Error` with message "useStore must be used within StoreProvider" is thrown

#### Scenario: cleanup disposes registries and WS

- **WHEN** `StoreProvider` unmounts
- **THEN** `ws.disconnect()` is called
- **AND** `sessions.disposeAll()` releases all session reactive roots
- **AND** `terminals.disposeAll()` releases all terminal reactive roots
