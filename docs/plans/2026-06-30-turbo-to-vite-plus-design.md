# Migrate from Turborepo to Vite+

**Date:** 2026-06-30
**Status:** Design (approved in substance; pending implementation plan)
**Reference template:** `openspec/references/vite-plus-monorepo/`

## Goal

Move the `sakti-code` monorepo off **turborepo** onto the **Vite+** unified toolchain
(the `vp` CLI). `vp` becomes the single entry point for install, task running, builds,
tests, dev, and hooks — replacing turbo, tsup, biome, husky, and lint-staged.

The reference implementation lives at `openspec/references/vite-plus-monorepo/` and is
treated as the authoritative shape (it is the official Vite+ monorepo starter).

## Decisions (confirmed with the user)

1. **Scope — full toolchain.** `vp` replaces turbo + tsup + biome + husky + lint-staged
   and wraps package management. The three atypical packages (Electron `desktop`,
   `velomark`, Rust `pi-natives`) keep their bespoke build steps but are still
   orchestrated through `vp run`.
2. **Lint/format gate — `ultracite`, not `vp check`.** The user hit issues with
   `vp check`. Lint/format run through `ultracite check` / `ultracite fix` (engines =
   oxlint + oxfmt, via the `ultracite/oxlint/core` and `ultracite/oxfmt` presets, exactly
   as in the reference). `vp check` is not used.
3. **Typecheck — canonical `tsc`.** Per-package `typecheck: tsc --noEmit`, aggregated as
   `vp run -r typecheck`. This preserves the repo's existing convention and avoids
   `tsgolint` (the `vp check` type path) entirely.
4. **`velomark` — fully converted**, and the owner pushes the changes upstream to the
   velomark repo (so subtree sync conflicts are a non-issue).
5. **`apps/desktop` — orchestrate only.** Electron internals (`electron-vite`,
   `electron-builder`, `electron-builder install-app-deps` for node-pty's Electron ABI)
   stay. `vp` only orchestrates them and lints the source.
6. **Node runtime — nix stays the source.** Run `vp env off` (system-first mode) so vp's
   shims prefer the nix-provided Node. vp still installs its own shims; `off` only
   changes resolution priority.

## Strategy — spike-then-apply

Do **not** run `vp migrate` at the workspace root. The docs state `vp migrate` is
single-project oriented and "most projects require further manual adjustments"; on a
9-member workspace with Electron, a Rust crate, a vendored subtree, mixed vitest 3/4,
mixed vite 5/7, and a `node:sqlite` post-build fixup, a blind root migration would
produce a tangled mess.

Instead:

1. **Spike on one clean leaf** (`packages/logger`) — run `vp migrate` there to capture the
   tool's exact transforms (import rewrites, `pack` block shape, script mapping, hook
   output). Verify `vp pack` + `vp test` are green. This becomes the template.
2. **Replicate the proven pattern** across the repo, phased by risk (see §Rollout). Each
   tier ends GREEN before the next begins, honoring the repo's "verify before you claim"
   ethos.

## Preconditions (Phase 0 — before any package converts)

Vite+ requires **Vite 8+** and **Vitest 4.1+**. Current repo state:

| Package                       | vitest   | vite                         | Action                                                     |
| ----------------------------- | -------- | ---------------------------- | ---------------------------------------------------------- |
| agent, db, llm, logger, tools | `^3`     | —                            | bump vitest → `4.1.x` (catalog)                            |
| apps/server                   | `^4.1.9` | —                            | already OK; move to catalog                                |
| apps/desktop                  | `^4.1.9` | `^7.3.5` (via electron-vite) | verify electron-vite's bundled vite; renderer vitest OK    |
| velomark                      | `^3`     | `^5.2.11`                    | bump vitest → 4.1.x; vite → 8 (velomark dev uses `vp dev`) |

Also confirm: no tsconfig uses `baseUrl` (verified 2026-06-30 — none do), so type-aware
linting is not silently disabled.

## End-state architecture

### Root files — added

- **`vite.config.ts`** (from the reference) — root `fmt`, `lint` (`typeAware` +
  `typeCheck`, `vite-plus/oxlint-plugin`, `prefer-vite-plus-imports`), `run` (cache
  defaults), `staged`, `check`. Minimal `lint`/`fmt` blocks here are for anyone who runs
  `vp check` — they are **not** the source of truth (see lint note below).
- **`oxlint.config.ts`** — `extends: [core]` from `ultracite/oxlint/core`, plus
  per-package `overrides` (Solid rules, node env, vitest rules). **This is the source of
  truth for linting** because `ultracite check` reads `oxlint.config.ts`.
- **`oxfmt.config.ts`** — `...ultracite` from `ultracite/oxfmt`. Source of truth for
  formatting.
- **`.vite-hooks/pre-commit`** → `vp staged` (created by `prepare: "vp config"`).

> **Override-location note:** the Vite+ monorepo guide puts per-package lint/fmt
> differences in `vite.config.ts` `lint.overrides` / `fmt.overrides`. That only applies
> when running `vp check`. Because we run `ultracite check`/`fix`, overrides live in
> `oxlint.config.ts` / `oxfmt.config.ts`. Optionally compose them via
> `tooling/lint/*.ts` modules typed with `import type { OxlintOverride } from
'vite-plus/lint'`, spread into the `oxlint.config.ts` overrides.

### Root files — removed

`turbo.json`, `biome.jsonc`, `.husky/`, and root devDeps `turbo`, `tsup`,
`@biomejs/biome`, `husky`, `lint-staged`.

### Root `package.json`

- devDeps: add `vite-plus: catalog:`, `oxfmt: latest`, `oxlint: latest`; keep
  `ultracite: 7.8.3`. Drop the five retired deps above.
- `packageManager`: keep `pnpm@10.18.0`. Add
  `devEngines.packageManager: { name: "pnpm", version: "^10", onFail: "download" }`.
- Keep `engines.node`; add `devEngines.runtime` for documentation.
- Scripts (vp surface):

  | old                                                | new                               |
  | -------------------------------------------------- | --------------------------------- |
  | `typecheck: turbo run typecheck`                   | `vp run -r typecheck`             |
  | `build: turbo run build`                           | `vp run -r build`                 |
  | `dev: turbo run dev`                               | `vp run desktop#dev`              |
  | `start: turbo run start`                           | `vp run @sakti-code/server#start` |
  | `hmr: turbo run hmr`                               | (drop if unused; see tasks)       |
  | `build:canary: turbo run build:canary`             | (drop if unused; see tasks)       |
  | `check: ultracite check`                           | keep                              |
  | `fix: ultracite fix`                               | keep                              |
  | `dev:server: pnpm --filter @sakti-code/server dev` | `vp run @sakti-code/server#dev`   |
  | `prepare: husky`                                   | `vp config`                       |

  Keep the `velomark:*` / `pi:*` subtree sync scripts unchanged (plain git).

### `pnpm-workspace.yaml`

Keep `packages: [apps/*, packages/*, crates/*]`. Add (from the reference):

```yaml
catalogMode: prefer
catalog:
  "@types/node": ^24
  typescript: ^5
  vite: npm:@voidzero-dev/vite-plus-core@latest
  vitest: 4.1.9
  vite-plus: latest
overrides:
  vite: "catalog:"
  vitest: "catalog:"
peerDependencyRules:
  allowAny: [vite, vitest]
  allowedVersions:
    vite: "*"
    vitest: "*"
```

> The Vite+ docs do not document `catalog:` (it is a pnpm feature). vite-plus delegates
> install to pnpm, so the catalog works. Verify once during the catalog spike.

### Runtime posture

`vp env off` (one-time, after install). Declare `devEngines.runtime` + `engines.node` for
diagnostics. `vp env doctor` should show system (nix) Node winning. Keep nix as the
source of Node + Electron runtime libs + python3/gnumake (for node-pty rebuilds).

### Per-package shape (libs: agent, db, llm, logger, tools)

Each gains a **`vite.config.ts`** with:

```ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
  pack: { entry: ["src/index.ts"], dts: true, format: ["esm"] },
});
```

`package.json` changes:

- `build` → `vp pack` (replaces `tsup && node ../../scripts/restore-node-protocol.mjs
dist`). The `restore-node-protocol.mjs` post-step is kept **only** for the
  `node:sqlite` packages if the spike shows tsdown mangles it (see §Risks).
- `dev` → `vp pack --watch` (where useful).
- `test` → `vp test` (replaces `vitest run`).
- `typecheck` → `tsc --noEmit` (unchanged).
- Drop direct `vitest` devDep (shipped by `vite-plus`). Drop `tsup`. Move `@types/node`
  / `typescript` to catalog.
- `exports` field: keep the `"development": "./src/index.ts"` condition (workspace src
  resolution). Align the `default`/`types` dist paths with tsdown output (tsdown default
  outDir `dist/`, ESM). Verify exact paths during the spike.

## Task-graph translation (turbo.json → `vp run`)

`vp run` derives topological order from the **`package.json` dependency graph** — there
is no turbo-style `^build`. Recursive runs (`vp run -r build`) already build upstream
deps first.

| turbo task                                      | becomes                                                                                                     | notes                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build` (`^build`, `dist/**`)                   | `vp run -r build`                                                                                           | topological order automatic. Workspace imports resolve to `src/` via the `development` condition, so cross-package dist is **not** needed to build. |
| `test` (`^build`)                               | `vp run -r test`                                                                                            | drop the `^build` dep — tests import `src/`, no build needed.                                                                                       |
| `typecheck` (`^typecheck`)                      | `vp run -r typecheck`                                                                                       | per-package `tsc --noEmit`.                                                                                                                         |
| `dev` / `start` / `hmr` (persistent)            | `vp run <pkg>#dev` etc.                                                                                     | no `persistent` concept; dev servers just run (package.json scripts are not cached by default).                                                     |
| `build:electron` (`^build`, `out/**`,`dist/**`) | `vp run -r build && vp run desktop#build:electron`                                                          | desktop's `package` script chains these + `electron-builder`.                                                                                       |
| `build:canary`                                  | **verify it exists per-package first**; likely dead (only in `turbo.json`, no script seen). Drop if unused. |

**Caching:** leave `run.cache` at default `{ scripts: false, tasks: true }`. Do not chase
build-output caching in phase 1 — rolldown builds are fast and workspace imports don't
need dist. If CI later needs it, define per-package `run.tasks.build = { command:
'vp pack', output: ['dist/**'] }` and **remove** the `build` entry from `package.json`
(a name cannot live in both `vite.config.ts` and `package.json`).

## Per-package conversion tiers

Each tier ends GREEN (`vp pack` / `vp test` / `ultracite check` pass) before the next.

- **Tier 0 — Spike (`packages/logger`)**: `vp migrate` on this one clean leaf; capture
  transforms; verify `vp pack` + `vp test` green. Becomes the template.
- **Tier 1 — Simple libs (`logger`, `llm`)**: apply template. `build: vp pack`,
  `test: vp test`, drop tsup + direct vitest, add `vite-plus: catalog:`.
- **Tier 2 — `node:sqlite` libs (`agent`, `db`, `tools`)**: same as Tier 1 **plus** the
  node:sqlite spike. If tsdown mangles it, keep `build: "vp pack && node
../../scripts/restore-node-protocol.mjs dist"` (the fixup is tool-agnostic).
- **Tier 3 — `apps/server`**: `build: vp pack`; keep `dev`/`start` as
  `NODE_OPTIONS=--conditions=development tsx src/index.ts` (a process, not a vite app),
  orchestrated via `vp run @sakti-code/server#dev`. Inherits the node:sqlite fixup if
  needed.
- **Tier 4 — `packages/velomark` (full convert)**: `vp pack` must reproduce the Solid
  conditional output (`dist/dev.js` + `dist/index.js` with the `solid` export condition)
  — the velomark-specific spike. `vp dev` replaces `vite serve dev`; the three vitest
  configs (client/ssr/packed-consumer) collapse into `vp test` + a `test` block;
  `scripts/pack-and-test-consumer.mjs` stays as a script. Wrap `@tailwindcss/vite` /
  `vite-plugin-solid` in `lazyPlugins(...)`. Owner pushes upstream.
- **Tier 5 — `apps/desktop` (orchestrate only)**: internals untouched
  (`electron-vite build`, `electron-builder`, `electron-builder install-app-deps` —
  **not** `vp rebuild`; electron-builder's install-app-deps is Electron-ABI-aware, which
  node-pty requires). Gets a `vite.config.ts` with only `fmt`/`lint` blocks so
  `ultracite check` lints it; `vp run desktop#dev` drives `scripts/dev.mjs`;
  `package` = `vp run -r build && vp run desktop#build:electron && electron-builder`.
- **Special — `crates/pi-natives`**: not a `vp pack` target (Cargo + prebuilt `.node`).
  `test: vp test`; JS shims (`index.js`, `index.d.ts`) linted by `ultracite`; Rust stays
  `cargo`. vp just orchestrates `vp run @sakti-code/pi-natives#test`.

## Risks & spikes (verify before believing)

1. **node:sqlite under tsdown** — tsup mangles `node:sqlite` → bare `sqlite` (hence the
   existing `restore-node-protocol.mjs`). Does tsdown/Rolldown preserve `node:`?
   _Spike:_ `vp pack packages/db`, grep `dist/` for bare `sqlite`. If broken, keep the
   post-pack fixup. Falsifiable in ~30s. (The Vite+ `vp pack` doc defers to upstream
   tsdown docs and gives no answer.)
2. **velomark Solid conditional output** — `tsup-preset-solid` has no direct tsdown
   equivalent. _Spike:_ `vp pack packages/velomark`, verify `dist/dev.js` +
   `dist/index.js` + the `solid` condition survive. Highest-uncertainty item; may need a
   tsdown plugin or a custom multi-entry config.
3. **catalog resolution** — confirm `vp install` honors `pnpm-workspace.yaml` `catalog:`
   - the `vite: npm:@voidzero-dev/vite-plus-core@latest` alias. vite-plus delegates to
     pnpm, so it should — verify once.
4. **`vp env off` defers to nix** — `vp env doctor` shows system Node winning; pin via
   `.node-version` or `devEngines.runtime`.

### Accepted (mitigated, not spiked)

- **Native rebuild**: keep `electron-builder install-app-deps` for node-pty; never
  substitute `vp rebuild` for Electron native bits. `pi-natives` is prebuilt — no
  rebuild.
- **`build:canary` / `hmr`**: verify these scripts exist anywhere before porting; drop
  dead turbo tasks.
- **`baseUrl`**: verified absent from all tsconfigs (2026-06-30) — type-aware lint will
  not be silently disabled.

## Rollout order

Tier 0 → 1 → 2 → 3 → 4 → 5 → **root wiring** (drop turbo/biome/husky, add root
`vite.config.ts` + `oxlint.config.ts`/`oxfmt.config.ts` + catalog + `.vite-hooks`,
rewrite root scripts) → `vp env off` + **AGENTS.md** rewrite.

Root wiring lands **last** so the orchestrator level is never in a half-turbo/half-vp
state. Commit per tier.

## AGENTS.md updates

- Replace the **Commands** block:
  - `pnpm run fix` → `ultracite fix`
  - `pnpm run typecheck` → `vp run -r typecheck`
  - `pnpm run dev:server` → `vp run @sakti-code/server#dev`
  - per-package build/test → `vp run <pkg>#build` / `vp run <pkg>#test`
  - add `vp install` (replaces `pnpm install`)
  - add a note: run `vp env off` once so nix stays the Node source
- Add the canonical **`<!--VITE PLUS START--> ... <!--VITE PLUS END-->`** block from the
  reference `AGENTS.md` (the vp review checklist), with the lint line adjusted to
  `ultracite check` / `ultracite fix`.
- Update **Conventions** to reference oxlint/oxfmt (via ultracite) instead of biome, and
  `vp run -r` instead of turbo.
- Keep the **nix develop** / node-pty rebuild / packaging notes — they are
  Electron-native and unaffected.

## Definition of done

From a clean clone, in `nix develop` (with `vp env off`):

1. `turbo.json`, `biome.jsonc`, `.husky/`, and root devDeps `turbo`/`tsup`/
   `@biomejs/biome`/`husky`/`lint-staged` are gone.
2. `vp install` succeeds.
3. `vp run -r typecheck` passes.
4. `ultracite check` passes.
5. `vp run -r test` passes.
6. `vp run -r build` passes (all dists produced).
7. `apps/desktop` packages via `vp run desktop#package`.
8. velomark upstream has matching changes pushed.

## Open questions for implementation

- Exact tsdown dist output paths vs the current `exports` map (resolve during Tier 0
  spike).
- Whether `build:canary` / `hmr` scripts exist anywhere (grep before porting).
- Whether electron-vite's bundled Vite satisfies the "Vite 8+" precondition or needs a
  desktop-specific adjustment (desktop keeps electron-vite regardless).
