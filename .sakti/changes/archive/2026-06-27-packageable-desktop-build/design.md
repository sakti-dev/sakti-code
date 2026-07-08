## Context

The monorepo's workspace packages (`@sakti-code/{agent,db,tools,llm,logger,server,velomark}`) all export raw `.ts` (`apps/server/package.json:6-23` and `packages/logger/package.json:7` are representative). The dev toolchain resolves this directly: `tsx` (`dev:server`), Vite (renderer + `electron-vite dev` main/preload), and Vitest all transpile source on the fly. `tsconfig.base.json` sets `moduleResolution: "bundler"`, `allowImportingTsExtensions: true`, `noEmit: true` — a pure dev/typecheck setup. `turbo.json:16-19` already defines a `build` task (`dependsOn: ["^build"]`, `outputs: ["dist/**"]`) but no package defines a `build` script that emits anything, and the root has no `build` script.

Consequence: `apps/desktop` `package` cannot produce a runnable build. `electron-vite` externalizes `node_modules` by default, so the Electron main ships `@sakti-code/*` as runtime imports that resolve to `.ts` under `node_modules` → Node refuses to strip TypeScript there (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Bundling the packages into the main was investigated and rejected across six failure modes (type-stripping; `require is not defined` in ESM; ffi-rs musl/gnu platform mis-resolution; pnpm 10 strict hoisting; ffi `exports`/CJS interop; electron-vite silently dropping function-typed `rollupOptions.external`). Source uses explicit `.ts` suffixes on relative imports, and `logger/package.json` already carries a stub `"build": "tsc"` (currently a no-op under `noEmit`).

## Goals / Non-Goals

**Goals:**
- Make `pnpm run package` produce a Linux build that launches with the embedded server responding.
- Workspace packages emit distributable ESM JS + declarations to `dist/`.
- Dev workflow stays unchanged day-to-day (no prior build needed for `dev`/`dev:server`/`test`).
- Uniform, low-maintenance build setup across all workspace packages.

**Non-Goals:**
- Publishing packages to a registry (private workspace only).
- Changing runtime/API behavior.
- Cross-platform (Windows/macOS) packaging — Linux AppImage only, as today.
- Refactoring import styles or module format of source.

## Decisions

### Decision 1: Compile with `tsup` (esbuild), not plain `tsc`

Each workspace package gets `"build": "tsup"` with a per-package `tsup.config.ts`: `format: ["esm"]`, `dts: true`, `clean: true`, `sourcemap: true`, entry points per subpath export, and deps auto-externalized.

**Why tsup:** esbuild rewrites relative import specifiers correctly (`.ts` → resolved), emits runnable Node ESM, generates `.d.ts`, and is fast and idempotent. esbuild is already transitively present (vitest/vite/tsx).

**Alternatives considered:**
- *Plain `tsc` emit* with a `tsconfig.build.json` overriding `noEmit:false`, `module/moduleResolution: NodeNext`, `declaration:true`, `allowImportingTsExtensions:false`, and `rewriteRelativeImportExtensions` (TS 5.7+, we run 6.0). Rejected: bleeding-edge, finicky interaction with the existing `bundler`/`allowImportingTsExtensions` base, and `tsc` won't bundle multi-entry subpath exports cleanly. `tsc` stays in charge of `typecheck` (`noEmit`).
- *Rewriting all imports to `.js` by hand.* Rejected: invasive, error-prone, unnecessary given a bundler.
- *CJS emit.* Rejected: fights the `"type": "module"` ESM design.

### Decision 2: Conditional `exports` — `development` → source, `default` → dist

Each package's `exports` becomes:
```json
".": {
  "development": "./src/index.ts",
  "types": "./dist/index.d.ts",
  "default": "./dist/index.js"
}
```
with the same shape per subpath (`./create-server`, `./dirs`, `./ws`, `./node`, `./llm/*`, …).

**Why:** dev tools keep resolving source `.ts` (no build prerequisite); Node at runtime resolves compiled `dist/`. This preserves the current dev experience exactly.

**Alternatives considered:**
- *Dist-only exports.* Rejected: forces every `dev`/`test` run to be preceded by a build — a workflow regression the current `.ts`-export design deliberately avoids.
- *A custom condition name.* Rejected: `"development"` is the established convention.

### Decision 3: Workspace packages stay externalized in the Electron main

`apps/desktop/electron.vite.config.ts` keeps default `externalizeDeps` for `main` (no bundling of `@sakti-code/*`). Native deps (`node-pty`) and ffi platform binaries stay external and `asarUnpack`'d (`electron-builder.yml` already unpacks `**/node-pty/**` and `**/*.node`).

**Why:** bundling was proven broken (six failure modes above). Externalized compiled packages behave like normal npm deps; native loaders run in their own CJS context.

### Decision 4: `package` chains `turbo build`; add platform binaries to desktop deps

`apps/desktop` `package` becomes `turbo build && electron-vite build && electron-builder`. Add `@ff-labs/fff-bin-linux-x64-gnu` and `node-pty` to `apps/desktop` dependencies/optionalDependencies so electron-builder bundles the correct platform binaries (pnpm 10 does not auto-install transitive platform binaries — surfaced during investigation). Root gains `"build": "turbo run build"`.

## Risks / Trade-offs

- **[Dev tools may not honor the `"development"` condition by default]** → Verify tsx, Vite (renderer + `electron-vite` main/preload dev), and Vitest each resolve source via `"development"`. If any does not, configure it explicitly (Vite `resolve.conditions`, `tsx --conditions development` / `NODE_OPTIONS`, Vitest `resolve.conditions`). Cover with a TDD dev-resolution test before broad changes.
- **[Subpath exports multiply per-package tsup entries]** → Server has 4 subpaths, llm has a wildcard. Each needs a tsup entry + conditional export. Mitigation: scripted/templated tsup config; verify each subpath resolves in both dev and packaged runtime.
- **[TS 6.0 / `allowImportingTsExtensions` quirks]** → Build config must override the base cleanly; verify `tsc --noEmit` (typecheck) still passes alongside tsup emit.
- **[Native platform binaries for musl vs glibc]** → Only bundle the glibc binary for the Linux build (musl/other platforms out of scope; document).
- **[`dist/` must be gitignored and clean-built]** → Add `dist/` to each package's ignore; `turbo build` is cacheable so cost is low.

## Migration Plan

Additive only — no source/runtime changes. Order: (1) add `tsup` dev dep + config + `build` script + conditional exports to one leaf package (e.g. `logger`), verify dev + build + packaged resolution; (2) roll out to remaining packages in dependency order; (3) wire root `build` + desktop `package` chain; (4) end-to-end `pnpm run package` + run the AppImage. **Rollback:** revert `exports` to source and remove `build` scripts; `dist/` is gitignored so no cleanup needed.

## Open Questions

- ~~Do `tsx`, Vite (`electron-vite` main/preload + renderer), and Vitest honor the `"development"` condition without extra config?~~ **Resolved (spike):** Vite / Vitest / `electron-vite` dev resolve the `"development"` condition natively (no config needed). **tsx does not** (Node-based; resolves `default` → `dist`, which won't exist unbuilt) — the single tsx script `apps/server/package.json` `"start": "tsx src/index.ts"` requires `NODE_OPTIONS=--conditions=development` (verified working). Apply when wiring dev compat (task 6.3).
- Compile `velomark` too, or leave it src-only (it is renderer-only and Vite-bundled)? Lean: compile for uniformity, but it is optional for packaging correctness.
- Single shared `tsup.config.ts` at repo root extended per-package, or one per package? Lean: shared base + thin per-package override.
