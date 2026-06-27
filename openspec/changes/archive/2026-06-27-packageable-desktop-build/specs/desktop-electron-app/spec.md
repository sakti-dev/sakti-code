## MODIFIED Requirements

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
