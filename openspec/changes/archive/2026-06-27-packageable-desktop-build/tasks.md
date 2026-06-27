## 1. De-risk: verify the `"development"` export condition (spike)

- [x] 1.1 Write a throwaway script that imports a workspace package under each dev runner (tsx, vitest, vite/electron-vite dev) and asserts it resolves to `src/*.ts` via the `"development"` condition — before changing any real package.
- [x] 1.2 For any runner that does NOT honor `"development"` by default, determine the exact config knob (Vite `resolve.conditions`; `tsx --conditions development` / `NODE_OPTIONS=--conditions=development`; Vitest `resolve.conditions`) and document it. Update design Open Questions with the answer.

## 2. tsup base + prove on one leaf package (`@sakti-code/logger`)

- [x] 2.1 Add `tsup` as a root dev dependency (`pnpm -w add -D tsup`).
- [x] 2.2 Create a shared `tsup.config.ts` base at repo root (ESM, `dts`, `clean`, `sourcemap`, deps externalized) and a thin `packages/logger/tsup.config.ts` override listing entries for `.` and `./node`.
- [x] 2.3 Replace `packages/logger/package.json` `"build": "tsc"` with `"build": "tsup"` and switch its `exports` to conditional form (`development`→`src/*.ts`, `types`→`dist/*.d.ts`, `default`→`dist/*.js`); add `dist/` to `.gitignore`.
- [x] 2.4 Run `pnpm --filter @sakti-code/logger build`; verify `dist/` has ESM `.js` + `.d.ts` per entry and no emitted file references `.ts`.
- [x] 2.5 TDD: add a test asserting `dist/` entries exist and the `default` export condition points at `dist/*.js` (guards against reverting to source exports).

## 3. Roll out compile + conditional exports to remaining packages (dependency order)

- [x] 3.1 `@sakti-code/llm` — entries for `.` and the `/*` subpath; conditional exports; `build` script; `.gitignore`. Build + verify dist.
- [x] 3.2 `@sakti-code/db` — conditional exports + build; build + verify (note `node:sqlite` stays external).
- [x] 3.3 `@sakti-code/tools` — conditional exports + build; build + verify.
- [x] 3.4 `@sakti-code/agent` — conditional exports + build; build + verify.
- [x] 3.5 `@sakti-code/server` — entries for all 4 subpaths (`.`, `./create-server`, `./dirs`, `./ws`); conditional exports; `build` script; `.gitignore`. Build + verify each subpath emits.
- [x] 3.6 `@sakti-code/velomark` (optional) — skipped: renderer-only (consumed by Vite, not the packaged main) and already tsup-built; no change needed for packaging correctness.
- [x] 3.7 Run `pnpm run typecheck` (turbo) across all packages; ensure build configs don't break `tsc --noEmit`.

## 4. Wire turbo build + root script

- [x] 4.1 Add `"build": "turbo run build"` to root `package.json`.
- [x] 4.2 Confirm `turbo.json` `build` task (`dependsOn: ["^build"]`, `outputs: ["dist/**"]`) covers all packages; adjust if needed.
- [x] 4.3 Run `pnpm run build`; verify topological order (leaf packages before dependents) and that every package's `dist/` is produced.
- [x] 4.4 TDD: add a test asserting `turbo run build` produces `dist/` for all workspace packages and respects `^build` ordering (e.g. agent before server).

## 5. Wire desktop packaging + native binaries

- [x] 5.1 Change `apps/desktop/package.json` `package` to `turbo build && electron-vite build && electron-builder`.
- [x] 5.2 Add `node-pty` and `@ff-labs/fff-bin-linux-x64-gnu` to `apps/desktop` `optionalDependencies` so electron-builder bundles the correct platform binaries.
- [x] 5.3 Confirm `electron-builder.yml` `asarUnpack` still covers `**/node-pty/**` and `**/*.node`; confirm `main` keeps default `externalizeDeps` (workspace packages externalized, not bundled).
- [x] 5.4 Run `pnpm --filter desktop package`; confirm AppImage builds (`.deb` may still fail on fpm/ruby under NixOS — track separately, not a blocker).

## 6. End-to-end verification

- [x] 6.1 Run the AppImage via `appimage-run release/sakti-code-*.AppImage`; assert the window launches and the embedded server responds on its ephemeral port (curl `/api/health`).
- [x] 6.2 Confirm no `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, no `require is not defined`, and native `node-pty`/ffi load from unpacked `node_modules`.
- [x] 6.3 Verify dev workflow unchanged: `pnpm run dev:server` (tsx) and `cd apps/desktop && pnpm run dev` (electron-vite) still resolve source `.ts` via the `"development"` condition with no prior build.
- [x] 6.4 Run the relevant package + server + desktop test suites; ensure green.
