## Why

`apps/desktop` defines a `package` script and the `desktop-electron-app` spec already requires it to "produce a runnable Linux build", but the packaged app crashes on launch with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Root cause: every `@sakti-code/*` workspace package exports raw `.ts` (`apps/server/package.json:6-23` is representative) with no compiled `dist/`. The dev tooling (tsx, Vite) transpiles that `.ts` on the fly, but once externalized into the packaged app's `node_modules`, Node cannot load TypeScript from under `node_modules`. Bundling the packages into the Electron main is a dead end — confirmed across six failure modes: type-stripping, `require is not defined` in ESM, ffi-rs musl/gnu platform mis-resolution, pnpm hoisting, and ffi `exports`/CJS interop. The packages must ship compiled JS so `pnpm run package` produces a build that actually runs.

## What Changes

- Each `@sakti-code/*` workspace package gains a `build` script (tsc) emitting ESM `.js` + `.d.ts` to `dist/`, driven by a per-package `tsconfig.build.json`.
- Each package's `exports` becomes conditional: `"development"` → `src/*.ts` (keeps the existing dev workflow — tsx `dev:server`, Vite renderer/main dev — resolving source `.ts` unchanged); `"types"` → `dist/*.d.ts`; `"default"` → `dist/*.js`.
- A root `pnpm run build` script runs `turbo run build` (`turbo.json:16-19` already defines the `build` task with topological `^build` and `dist/**` outputs).
- `apps/desktop` `package` chains `turbo build` before `electron-vite build` so the embedded server's runtime imports resolve to compiled JS.
- Workspace packages stay **externalized** in the Electron main (default `externalizeDeps`); native deps (`node-pty`, ffi platform binaries) stay external + `asarUnpack`'d as today. No bundling of workspace TS into the main bundle.

## Capabilities

### New Capabilities

- `workspace-package-build`: Workspace packages SHALL be compilable to distributable ESM JavaScript with conditional package `exports` — dev resolves source `.ts`, runtime resolves compiled `dist/` — orchestrated by a turbo topological `build` task.

### Modified Capabilities

- `desktop-electron-app`: The "electron-vite build and electron-builder packaging" requirement is strengthened so `package` SHALL produce a Linux build that actually launches (embedded server responds on its ephemeral port), with the prerequisite that workspace packages are compiled (`turbo build`) before `electron-vite build` runs.

## Impact

- **All `packages/*`** (agent, db, tools, llm, logger, server, velomark): add `build` script + `tsconfig.build.json` (emit, `outDir: dist`, declarations) + switch `exports` to conditional form; add `dist/` to `.gitignore`.
- **`turbo.json`**: `build` task already present; confirm `outputs: ["dist/**"]` covers all packages.
- **Root `package.json`**: add `"build": "turbo run build"`.
- **`apps/desktop/package.json`**: change `package` to `turbo build && electron-vite build && electron-builder`; add `@ff-labs/fff-bin-linux-x64-gnu` + `node-pty` to `optionalDependencies`/`dependencies` so electron-builder bundles the correct platform binaries (pnpm 10 does not auto-install transitive platform binaries — surfaced during investigation).
- **Dev workflow**: day-to-day unchanged via the `"development"` export condition; any tool resolving the `default` condition will require a prior `turbo build` (notably the packaged build, which is the point).
- **No runtime/API behavior changes** — pure build/distribution change.
