# Turborepo → Vite+ Migration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the `sakti-code` monorepo off turborepo onto the Vite+ (`vp`) unified toolchain — `vp` replaces turbo + tsup + biome + husky + lint-staged.

**Architecture:** Spike-then-apply. First convert `packages/logger` via `vp migrate` to capture the tool's exact transforms, verify it green, then replicate that proven pattern across the repo phased by risk (leaves → `node:sqlite` libs → server → velomark → desktop), with root wiring last so the orchestrator level is never half-migrated. Lint/format run through `ultracite check`/`fix` (oxlint + oxfmt); typecheck stays canonical `tsc --noEmit`; nix stays the Node source (`vp env off`).

**Tech Stack:** Vite+ (`vp` CLI + `vite-plus` package), pnpm catalog, oxlint/oxfmt via ultracite, tsdown (`vp pack`), Vitest 4.1+ via `vite-plus/test`. Electron keeps `electron-vite` + `electron-builder`. Rust keeps `cargo`.

**Design doc:** `docs/plans/2026-06-30-turbo-to-vite-plus-design.md` (read first).

**Reference template:** `openspec/references/vite-plus-monorepo/` (authoritative shape).

---

## Migration TDD note

This is a build-system migration, not feature code. The "test" for each task is the **existing test suite + build + lint staying green**. Each task follows: make the change → run the package's existing tests/build → verify GREEN → commit. Do not introduce new tests; the existing suites are the safety net.

**Per-task verification commands** (run from repo root unless noted):
- build: `vp run <pkg>#build` (after conversion) or `pnpm --filter <pkg> build` (before)
- test: `vp run <pkg>#test` (after) or `pnpm --filter <pkg> test` (before)
- lint: `ultracite check` (run from repo root, checks everything)

**Verify RED is impossible here** — the discipline is "verify GREEN after each change; if anything breaks, stop and bisect before continuing" (per AGENTS.md debugging ethos).

---

## Phase 0 — Preconditions (version floors)

Vite+ requires Vite 8+ and Vitest 4.1+. Bump versions first, while still on turbo, so the migration starts from a green baseline.

### Task 0.1: Bump Vitest 3 → 4.1 in the lib packages

**Files:**
- Modify: `packages/agent/package.json`
- Modify: `packages/db/package.json`
- Modify: `packages/llm/package.json`
- Modify: `packages/logger/package.json`
- Modify: `packages/tools/package.json`
- Modify: `packages/velomark/package.json`

**Step 1:** In each of the six files, change `"vitest": "^3"` (or `^3.0.0`) → `"vitest": "4.1.9"`.

**Step 2:** Reinstall and run every affected suite.

Run: `pnpm install`
Run: `pnpm --filter @sakti-code/agent test && pnpm --filter @sakti-code/db test && pnpm --filter @sakti-code/llm test && pnpm --filter @sakti-code/logger test && pnpm --filter @sakti-code/tools test && pnpm --filter velomark test`
Expected: all suites PASS (Vitest 4 is largely back-compatible; watch for reporter/API drift and fix mechanically).

**Step 3:** Commit.

```bash
git add -u packages/*/package.json pnpm-lock.yaml
git commit -m "build: bump vitest to 4.1.9 across packages (vite+ precondition)"
```

### Task 0.2: Bump Vite 5 → 8 in velomark

**Files:**
- Modify: `packages/velomark/package.json` (`"vite": "^5.2.11"` → `"vite": "^8"`; also `@tailwindcss/vite`, `vite-plugin-solid` may need bumps if they peer-reject Vite 8)

**Step 1:** Bump the vite version; run `pnpm install`. If peer warnings block, bump the Solid/Tailwind vite plugins to their Vite-8-compatible versions.

**Step 2:** Verify velomark still builds and serves.

Run: `pnpm --filter velomark build`
Run: `pnpm --filter velomark dev` (smoke — start, hit `/`, Ctrl-C)
Expected: build produces `dist/`; dev server starts.

**Step 3:** Commit.

```bash
git add -u packages/velomark/package.json pnpm-lock.yaml
git commit -m "build(velomark): bump vite to 8 (vite+ precondition)"
```

### Task 0.3: Note dead turbo tasks

`build:canary` and `hmr` appear **only** in `turbo.json` — no `package.json` defines them. They are dead and will simply vanish when `turbo.json` is deleted in Task 17. No action now; record the decision here:
- ✅ `build:canary` — drop (dead)
- ✅ `hmr` — drop (dead)
- `start` — keep (server), becomes `vp run @sakti-code/server#start`
- `dev` — keep (desktop/server/velomark), becomes per-package `vp run <pkg>#dev`

---

## Tier 0 — Spike: convert `packages/logger` (the template)

`logger` is the cleanest leaf: no `node:sqlite`, no native, no Solid. It has **two entries** (`src/index.ts` + `src/node.ts`) and exports `.` and `./node`.

### Task 1: Run `vp migrate` on logger and capture transforms

**Step 1:** From repo root, run the migrator on just the logger package.

Run: `cd packages/logger && vp migrate --no-interactive --no-hooks` then `cd -`

> If `vp migrate` refuses to run on a non-root dir, copy `packages/logger` to `/tmp/opencode/logger-spike`, run `vp migrate` there, and diff the result. The goal is to observe what `vp migrate` does to: `package.json` scripts/exports, `vite.config.ts` creation, import rewrites in `src/`, `vitest` dep removal.

**Step 2:** Record the transforms (do not commit yet). Note specifically:
- what the generated `vite.config.ts` `pack` block looks like
- whether `vitest` was removed from devDeps and `vite-plus` added
- whether `build` script became `vp pack`
- whether `test` import paths (`vitest`) were rewritten to `vite-plus/test`
- exact `dist/` output filenames tsdown produces vs the current `exports` map

**Step 3:** If `vp migrate` left logger broken, restore it.

Run: `git checkout -- packages/logger && git clean -fd packages/logger`

> Decision gate: you now know the tool's real transforms. Decide whether to keep the migrated output as the base (if good) or hand-write using the reference template (if the migrator did something unwanted). Prefer hand-writing from the reference for control.

### Task 2: Convert logger by hand from the reference template

**Files:**
- Create: `packages/logger/vite.config.ts`
- Modify: `packages/logger/package.json`

**Step 1:** Create `packages/logger/vite.config.ts` (multi-entry — both `index.ts` and `node.ts`):

```ts
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {},
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  pack: {
    entry: ['src/index.ts', 'src/node.ts'],
    dts: true,
    exports: true,
  },
});
```

**Step 2:** Edit `packages/logger/package.json`:
- `scripts.build`: `"tsup && node ../../scripts/restore-node-protocol.mjs dist"` → `"vp pack"`
- `scripts.test`: `"vitest run"` → `"vp test"`
- `devDependencies`: remove `vitest`; add `"vite-plus": "catalog:"`.
- Keep `exports` (`.` and `./node`) with the `development` → `./src/*.ts` conditions. After Step 4, confirm the `default`/`types` dist paths still match tsdown output; adjust if tsdown emits e.g. `.mjs`.

**Step 3:** Add `vite-plus` to the catalog (interim — full catalog comes in Task 14, but logger needs it now). In `pnpm-workspace.yaml`, add at end:

```yaml
catalogMode: prefer
catalog:
  vite-plus: latest
```

Run: `pnpm install`
Expected: resolves `vite-plus` for logger.

**Step 4:** Verify build + test green.

Run: `pnpm --filter @sakti-code/logger build`
Expected: `dist/index.js`, `dist/index.d.ts`, `dist/node.js`, `dist/node.d.ts` produced (confirm exact names; fix `exports` if different).

Run: `pnpm --filter @sakti-code/logger test`
Expected: PASS.

Run: `pnpm exec ultracite check` (from root, smoke — may surface logger lint under oxlint for the first time)
Expected: clean, or fix trivially.

**Step 5:** Commit. This is the template every other lib package copies.

```bash
git add packages/logger pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "build(logger): migrate to vp pack + vp test (vite+ template)"
```

---

## Tier 1 — Simple lib: `packages/llm`

### Task 3: Convert llm using the logger template

**Files:**
- Create: `packages/llm/vite.config.ts`
- Modify: `packages/llm/package.json`

**Step 1:** Create `packages/llm/vite.config.ts` — same as logger's but single entry `src/index.ts` (llm exports only `.`). Confirm llm's entry path from its `exports` map first.

**Step 2:** Edit `packages/llm/package.json` exactly as in Task 2 Step 2 (`build` → `vp pack`, `test` → `vp test`, drop `vitest`, add `vite-plus: catalog:`). Note llm also has `generate-models` script — leave it untouched.

**Step 3:** Verify.

Run: `pnpm --filter @sakti-code/llm build` → expect `dist/` produced, `exports` paths match.
Run: `pnpm --filter @sakti-code/llm test` → PASS.

**Step 4:** Commit.

```bash
git add packages/llm pnpm-lock.yaml
git commit -m "build(llm): migrate to vp pack + vp test"
```

---

## Tier 2 — `node:sqlite` libs: agent, db, tools

These use `node:sqlite` (directly or transitively). tsup mangles `node:sqlite` → bare `sqlite`, which is why the repo has `scripts/restore-node-protocol.mjs`. tsdown may or may not. **Spike first.**

### Task 4: Spike — does `vp pack` preserve `node:sqlite`?

**Step 1:** Temporarily build `db` with vp pack to observe. Create a throwaway `packages/db/vite.config.ts`:

```ts
import { defineConfig } from 'vite-plus';
export default defineConfig({
  pack: { entry: ['src/index.ts'], dts: true },
});
```

Add `vite-plus: catalog:` to `packages/db/package.json` devDeps if not resolvable yet.

**Step 2:** Build and inspect.

Run: `cd packages/db && vp pack && cd -`
Run: `rg -n "node:sqlite|\bsqlite\b" packages/db/dist` (use Bash with `rg`)
Expected/decision:
- If output shows `node:sqlite` preserved (no bare `sqlite`) → **tsdown is safe; drop the fixup** for all node:sqlite packages. Delete the throwaway config.
- If output shows bare `sqlite` (mangled) → **keep the fixup**: these packages' `build` script becomes `"vp pack && node ../../scripts/restore-node-protocol.mjs dist"`.

**Step 3:** Restore db to clean state.

Run: `rm packages/db/vite.config.ts && git checkout -- packages/db/package.json && git clean -fd packages/db`

> Record the decision in the commit message of Task 6. Proceed assuming one of the two branches below.

### Task 5: Convert agent

**Files:**
- Create: `packages/agent/vite.config.ts`
- Modify: `packages/agent/package.json`

**Step 1:** Create `packages/agent/vite.config.ts` (single entry `src/index.ts`, same shape as Task 2's lint/fmt/pack blocks).

**Step 2:** Edit `packages/agent/package.json`:
- `build` → `"vp pack"` **or** `"vp pack && node ../../scripts/restore-node-protocol.mjs dist"` per Task 4's decision.
- `test` → `"vp test"`.
- Drop `vitest`, `@effect/vitest` stays (it's a test integration, not vitest itself — confirm it resolves against vite-plus/test; if it hard-depends on `vitest`, keep `vitest` only if required).
- Add `vite-plus: catalog:`.

**Step 3:** Verify.

Run: `pnpm --filter @sakti-code/agent build` → `dist/` produced; `rg -n "\bsqlite\b" packages/agent/dist` shows only `node:sqlite` (if fixup branch) or no bare sqlite.
Run: `pnpm --filter @sakti-code/agent test` → PASS (374 tests).

**Step 4:** Commit.

```bash
git add packages/agent pnpm-lock.yaml
git commit -m "build(agent): migrate to vp pack + vp test (node:sqlite preserved)"
```

### Task 6: Convert db

Same as Task 5, for `packages/db`. db also has `db:generate`/`db:migrate`/`db:studio` (drizzle-kit) scripts — leave them untouched. Verify the `node:sqlite` fixup branch applies (db uses `node:sqlite` directly).

Run: `pnpm --filter @sakti-code/db build && pnpm --filter @sakti-code/db test` → PASS (36 tests).
Commit: `build(db): migrate to vp pack + vp test`

### Task 7: Convert tools

Same as Task 5, for `packages/tools`. tools depends on `@sakti-code/pi-natives` (native) — confirm `vp pack` externalizes it correctly (it's a workspace dep, should resolve via `development` → src or the prebuilt `.node`). tools also uses `@silvia-odwyer/photon-node` (native) — ensure it's external, not bundled.

Run: `pnpm --filter @sakti-code/tools build && pnpm --filter @sakti-code/tools test` → PASS (335 tests).
Commit: `build(tools): migrate to vp pack + vp test`

---

## Tier 3 — `apps/server`

### Task 8: Convert server

**Files:**
- Create: `apps/server/vite.config.ts`
- Modify: `apps/server/package.json`

**Step 1:** Create `apps/server/vite.config.ts`. Server exports multiple subpaths (`.`/`./create-server`/`./dirs`/`./ws`) — the `pack.entry` must list each entry source: `src/app.ts`, `src/create-server.ts`, `src/lib/config-dirs.ts`, `src/agent/ws-handler.ts`.

```ts
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
  pack: {
    entry: [
      'src/app.ts',
      'src/create-server.ts',
      'src/lib/config-dirs.ts',
      'src/agent/ws-handler.ts',
    ],
    dts: true,
    exports: true,
  },
});
```

**Step 2:** Edit `apps/server/package.json`:
- `build` → `"vp pack"` **or** with the `restore-node-protocol.mjs` fixup (server inherits node:sqlite via db — confirm via Task 4 decision; if unsure, run the spike grep on server dist too).
- Keep `dev`/`start` as `NODE_OPTIONS=--conditions=development tsx src/index.ts` (a process, not a vite app — do NOT use `vp dev` here).
- `test` → `"vp test"`.
- Drop direct `vitest` dep (it's in `dependencies` currently — move/drop appropriately; keep only if runtime-imported). Add `vite-plus: catalog:` to devDeps.

**Step 3:** Verify.

Run: `pnpm --filter @sakti-code/server build` → `dist/` produced with all four entry outputs matching the `exports` map.
Run: `pnpm --filter @sakti-code/server test` → PASS.
Run: `pnpm --filter @sakti-code/server dev` (smoke — start, `curl localhost:3001/api/health`, Ctrl-C) → `{"status":"ok"}`.

**Step 4:** Commit.

```bash
git add apps/server pnpm-lock.yaml
git commit -m "build(server): migrate to vp pack + vp test (dev/start keep tsx)"
```

---

## Tier 4 — `packages/velomark` (full convert, push upstream)

**Highest uncertainty.** velomark uses `tsup-preset-solid` to produce `dist/dev.js` + `dist/index.js` with the `solid` export condition (`drop_console: true`). tsdown has no equivalent preset.

### Task 9: Spike — reproduce the Solid conditional build under tsdown

**Step 1:** Study what the current build produces.

Run: `pnpm --filter velomark build` then `ls packages/velomark/dist` and `cat packages/velomark/package.json | rg -A2 solid`
Expected: `dist/index.js`, `dist/dev.js`, `dist/index.d.ts`, `dist/styles.css`; `exports["."].solid = { development: "./dist/dev.js", import: "./dist/index.js" }`.

**Step 2:** Prototype a `packages/velomark/vite.config.ts` with tsdown producing both entries:

```ts
import { defineConfig, lazyPlugins } from 'vite-plus';

export default defineConfig({
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
  plugins: lazyPlugins(async () => {
    const solid = await import('vite-plugin-solid');
    return [solid.default()];
  }),
  pack: {
    entry: { index: 'src/index.tsx', dev: 'src/index.tsx' },
    dts: true,
    // tsdown output options to produce the solid condition go here;
    // consult https://tsdown.dev for multi-condition output
  },
});
```

**Step 3:** Decision gate (be honest — verify, don't theorize):
- If tsdown can emit both `index.js` (prod, `drop_console`) and `dev.js` (dev) with the `solid` condition → proceed to Task 10.
- If tsdown **cannot** faithfully reproduce the Solid conditional output → **fallback**: keep `tsup` for velomark's `build` only (`build: "tsup && cp src/theme/styles.css dist/styles.css"`), but still move lint/test to `vp check`/`vp test` and `dev` to `vp dev`. Document this exception in the design doc and AGENTS.md. (This is acceptable; the user's "convert velomark" intent is met for everything except the packer, and faithful Solid output > toolchain purity.)

### Task 10: Convert velomark per Task 9's decision

**Files:**
- Create: `packages/velomark/vite.config.ts`
- Modify: `packages/velomark/package.json`
- Delete (if tsdown branch): `packages/velomark/tsup.config.ts`

**Step 1:** Apply the chosen build config (tsdown multi-condition OR tsup-retained-for-build).

**Step 2:** Edit `packages/velomark/package.json`:
- `dev`: `"vite serve dev"` → `"vp dev"`.
- `build`: per Task 9 decision (`vp pack` with `&& cp src/theme/styles.css dist/styles.css`, OR keep tsup).
- `test`: collapse the three-config dance. The `test` script currently runs `concurrently pnpm:test:client pnpm:test:ssr pnpm:test:packed-consumer`. Move per-mode config into a `test` block in `vite.config.ts` (projects) OR keep the three scripts but invoke via `vp test --config <file>`. Keep `test:packed-consumer` as `node ./scripts/pack-and-test-consumer.mjs` (it's a node script, not vitest).
- Remove devDeps that vite-plus now provides or that are biome/eslint/prettier/husky/lint-staged legacy: `@biomejs/biome`, `@typescript-eslint/*`, `eslint*`, `prettier`, `husky`, `lint-staged`, `concurrently` (if test collapses). Add `vite-plus: catalog:`. Bump/align `vite`, `vitest`, `typescript` to catalog.
- Drop the `lint-staged` field and `prepare: husky`.

**Step 3:** Verify all three test modes.

Run each test mode and confirm PASS:
- client: `vp test --config vitest.config.ts` (or the collapsed equivalent)
- ssr: `vp test --config vitest.ssr.config.ts --mode ssr`
- packed-consumer: `pnpm --filter velomark test:packed-consumer`
Run: `pnpm --filter velomark build` → `dist/` shape matches the original (index.js, dev.js, styles.css).
Run: `pnpm --filter velomark dev` (smoke).

**Step 4:** Commit + push upstream.

```bash
git add packages/velomark pnpm-lock.yaml
git commit -m "build(velomark): migrate to vite+ (vp dev/test; pack per solid spike)"
git push # then run the velomark subtree push so upstream matches:
git subtree push --prefix=packages/velomark https://github.com/sakti-dev/velomark.git main
```

---

## Tier 5 — `apps/desktop` (orchestrate only)

Internals untouched. Only add lint config + rewire scripts so `vp` orchestrates and `ultracite` lints.

### Task 11: Desktop — lint config + script rewire

**Files:**
- Create: `apps/desktop/vite.config.ts` (fmt/lint only — NOT a pack or vite-app config)
- Modify: `apps/desktop/package.json`

**Step 1:** Create `apps/desktop/vite.config.ts`:

```ts
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {},
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
```

> Do NOT add a `pack` block or Vite plugins here — desktop builds via `electron-vite` (its own config). The `vite.config.ts` exists only so `ultracite check`/`fix` reach desktop sources.

**Step 2:** Edit `apps/desktop/package.json` scripts:
- `package`: `"turbo run build:electron && electron-builder"` → `"vp run -r build && electron-vite build && electron-builder"` (build all lib dists first, then electron-vite, then package). Confirm `build:electron` script stays `"electron-vite build"`.
- `rebuild`: keep `"electron-builder install-app-deps"` (Electron-ABI-aware — do NOT switch to `vp rebuild`).
- `build:electron`, `dev`, `spike`, `test`, `typecheck`: keep as-is (they invoke electron-vite / electron / vitest / tsc directly; `vp run desktop#<script>` orchestrates them).
- `postinstall`: keep `"node node_modules/electron/install.js"`.
- devDeps: bump `vite`/`vitest` to catalog; add `vite-plus: catalog:`. Keep `electron`, `electron-vite`, `electron-builder`, `@swc/core`, `jsdom`, `vite-plugin-solid`, `@tailwindcss/vite`.

**Step 3:** Verify lint reaches desktop + packaging still works.

Run: `pnpm exec ultracite check` (root) → desktop files linted, clean.
Run: `pnpm --filter desktop typecheck` → PASS.
Run: `pnpm --filter desktop test` → PASS.
Run (full packaging smoke, in `nix develop`): `pnpm --filter desktop package` → builds lib dists + electron-vite + electron-builder into `release/`.

**Step 4:** Commit.

```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "build(desktop): wire vp orchestration + ultracite lint (electron-vite retained)"
```

---

## Special — `crates/pi-natives`

### Task 12: pi-natives test → `vp test`

**Files:**
- Modify: `crates/pi-natives/package.json`

**Step 1:** pi-natives is a Cargo-built native addon (prebuilt `index.linux-x64-gnu.node` + `index.js` + `index.d.ts`). It is **not** a `vp pack` target. Only switch its test script.

Edit `crates/pi-natives/package.json`: `test` → `"vp test"` (it has `vitest.config.ts` + `__tests__/`). Build stays Cargo (`build.rs`); no `build` script change. Add `vite-plus: catalog:` devDep if needed for `vp test`.

**Step 2:** Verify.

Run: `pnpm --filter @sakti-code/pi-natives test` → PASS.
Run (smoke, optional): `cargo test` in `crates/pi-natives` if Rust tests exist.

**Step 3:** Commit.

```bash
git add crates/pi-natives pnpm-lock.yaml
git commit -m "build(pi-natives): run tests via vp test (cargo build unchanged)"
```

---

## Root wiring (lands LAST)

Now that every package is individually green under vp/ultracite, rewire the root and delete the old orchestrator.

### Task 13: Create root `vite.config.ts` + lint/fmt configs

**Files:**
- Create: `vite.config.ts` (repo root)
- Create: `oxlint.config.ts`
- Create: `oxfmt.config.ts`

**Step 1:** Create root `vite.config.ts` (minimal lint/fmt — source of truth is the standalone files; this is for anyone who runs `vp check`):

```ts
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    options: { typeAware: true, typeCheck: true },
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
  },
  run: {
    cache: true,
  },
  staged: {
    '*': 'ultracite fix',
  },
});
```

**Step 2:** Create `oxlint.config.ts` (source of truth for lint — ports `biome.jsonc` overrides):

```ts
import { defineConfig } from 'oxlint';
import core from 'ultracite/oxlint/core';

export default defineConfig({
  extends: [core],
  ignorePatterns: [...core.ignorePatterns, 'openspec/**'],
  overrides: [
    // Port the meaningful biome overrides:
    // - test files: relax no-explicit-any, no-non-null-assertion, etc.
    // - velomark/desktop: solid rules
    // - server: node env
    {
      files: ['**/__tests__/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      files: ['packages/velomark/**', 'apps/desktop/**'],
      plugins: ['typescript', 'solid'],
    },
  ],
});
```

> Rule names differ between biome and oxlint — port the **intent** of `biome.jsonc`'s overrides (the 148-line file), not 1:1 names. Use `ultracite/oxlint/core` presets for the bulk.

**Step 3:** Create `oxfmt.config.ts`:

```ts
import { defineConfig } from 'oxfmt';
import ultracite from 'ultracite/oxfmt';

export default defineConfig({
  ...ultracite,
});
```

**Step 4:** Verify `ultracite check` runs against the new config.

Run: `pnpm exec ultracite check` → clean (fix trivially).

**Step 5:** Commit.

```bash
git add vite.config.ts oxlint.config.ts oxfmt.config.ts
git commit -m "build: add root vite-plus config (vite.config.ts, oxlint, oxfmt)"
```

### Task 14: Add pnpm catalog

**Files:**
- Modify: `pnpm-workspace.yaml`

**Step 1:** Replace `pnpm-workspace.yaml` with (keep `packages`, add catalog):

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "crates/*"

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
  allowAny:
    - vite
    - vitest
  allowedVersions:
    vite: "*"
    vitest: "*"
```

> Note: the workspace currently uses typescript ^6 and @types/node ^24/^26 in places. The catalog pins typescript ^5 (matching the reference). Decide: either align to ^5 (catalِog) or keep ^6 and drop typescript from the catalog. Confirm in Step 2; if ^6 is required, remove `typescript`/`@types/node` from the catalog and leave per-package pins.

**Step 2:** Reinstall and verify resolution.

Run: `pnpm install`
Expected: catalog resolves for all packages referencing `catalog:`; `vite-plus`, `vite` (aliased), `vitest` resolve.

Run: `vp install` (smoke — confirm vp delegates to pnpm and the catalog works through vp too)
Expected: succeeds, no resolution errors.

**Step 3:** Commit.

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "build: add pnpm catalog for vite-plus/vite/vitest (ts types)"
```

### Task 15: Rewrite root `package.json`

**Files:**
- Modify: `package.json` (root)

**Step 1:** Edit root `package.json`:
- `scripts` — replace the turbo scripts:

```json
"scripts": {
  "typecheck": "vp run -r typecheck",
  "build": "vp run -r build",
  "dev": "vp run desktop#dev",
  "start": "vp run @sakti-code/server#start",
  "test": "vp run -r test",
  "dev:server": "vp run @sakti-code/server#dev",
  "check": "ultracite check",
  "fix": "ultracite fix",
  "prepare": "vp config",
  "velomark:pull": "git subtree pull --prefix=packages/velomark https://github.com/sakti-dev/velomark.git main --squash",
  "velomark:push": "git subtree push --prefix=packages/velomark https://github.com/sakti-dev/velomark.git main",
  "pi:sync": "nix-shell -p git-filter-repo --run \"bash scripts/sync-pi-crates.sh\"",
  "pi:pull": "git subtree pull --prefix=vendor/pi-crates https://github.com/sakti-dev/oh-my-pi.git crates-only --squash",
  "pi:push": "git subtree push --prefix=vendor/pi-crates https://github.com/sakti-dev/oh-my-pi.git crates-only"
}
```

  (Drop `hmr`, `build:canary`, and the old turbo-based aliases — confirmed dead/renamed.)

- `devDependencies`: remove `@biomejs/biome`, `turbo`, `tsup`, `husky`, `lint-staged`; add `"oxfmt": "latest"`, `"oxlint": "latest"`, `"vite-plus": "catalog:"`; keep `ultracite`, `typescript`, `@types/node`.
- Keep `packageManager: pnpm@10.18.0`. Add:

```json
"devEngines": {
  "runtime": { "name": "node", "version": ">=22.18.0", "onFail": "download" },
  "packageManager": { "name": "pnpm", "version": "^10", "onFail": "download" }
},
"engines": { "node": ">=22.18.0" }
```

**Step 2:** Reinstall.

Run: `pnpm install`
Expected: retired deps removed; `vite-plus`/`oxfmt`/`oxlint` installed.

**Step 3:** Smoke the new root scripts.

Run: `pnpm run typecheck` → `vp run -r typecheck` PASS.
Run: `pnpm run check` → `ultracite check` clean.

**Step 4:** Commit.

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: rewrite root scripts for vp + ultracite; drop turbo/tsup/biome/husky deps"
```

### Task 16: Replace `.husky` with `.vite-hooks`

**Files:**
- Create: `.vite-hooks/pre-commit`
- Delete: `.husky/` (in Task 17)

**Step 1:** Create `.vite-hooks/pre-commit`:

```sh
vp staged
```

> The old `.husky/pre-commit` ran agent+db+tools tests + lint-staged. The new hook runs `vp staged`, which executes the `staged` block (`ultracite fix` on staged files). **The test-running behavior is intentionally dropped** (tests run via `vp run -r test` in CI / manually). If you want pre-commit tests, add a second hook or a root `vp run -r test` line — but the reference pattern is lint-only. Flag this in review.

**Step 2:** Install hooks via vp.

Run: `pnpm run prepare` (=`vp config`)
Expected: `.vite-hooks/` hooks activated; `core.hooksPath` pointed at `.vite-hooks`.

**Step 3:** Smoke the hook — stage a trivial change and commit (or use the Task 17 commit).

### Task 17: Delete legacy orchestrator files + retired devDeps

**Files:**
- Delete: `turbo.json`
- Delete: `biome.jsonc`
- Delete: `.husky/` (whole dir)
- Delete: `.lintstagedrc.json`

**Step 1:** Remove the files.

Run: `git rm turbo.json biome.jsonc .lintstagedrc.json && git rm -r .husky`

**Step 2:** Confirm nothing references them.

Run: `rg -n "turbo|biome|lint-staged|\.husky" --glob '!openspec/**' --glob '!docs/plans/**' -l`
Expected: only legit references (e.g., this plan, AGENTS.md which is rewritten in Task 19). Fix any stragglers.

**Step 3:** Reinstall to prune.

Run: `pnpm install`

**Step 4:** Commit.

```bash
git add -A
git commit -m "chore: remove turbo.json, biome.jsonc, .husky, .lintstagedrc (vite+ migration)"
```

### Task 18: Set `vp env off` (nix stays Node source)

**Step 1:** Switch vp to system-first mode.

Run: `vp env off`
Expected: shims now prefer system (nix) Node.

**Step 2:** Diagnose.

Run: `vp env doctor`
Expected: system Node (nix) winning; no conflicts with `devEngines.runtime`/`engines.node`.

> Do not commit anything here (env state is machine-local). Document the `vp env off` requirement in AGENTS.md (Task 19).

---

## Task 19: Rewrite AGENTS.md

**Files:**
- Modify: `AGENTS.md`

**Step 1:** In the **Commands** section, replace the turbo/pnpm commands with the vp surface:
- `pnpm run fix` → `ultracite fix` (or `pnpm run fix`)
- `pnpm run typecheck` → `vp run -r typecheck`
- `pnpm run dev:server` → `vp run @sakti-code/server#dev`
- per-package: `pnpm run dev` (desktop) → `vp run desktop#dev`; per-package tests → `vp run <pkg>#test`
- `pnpm install` → `vp install`
- add: run `vp env off` once so nix stays the Node source.

**Step 2:** Add the canonical Vite+ block from `openspec/references/vite-plus-monorepo/AGENTS.md` (the `<!--VITE PLUS START--> ... <!--VITE PLUS END-->` review checklist), with the lint line adjusted to `ultracite check` / `ultracite fix` (since we bypass `vp check`).

**Step 3:** In **Conventions**, replace biome with oxlint/oxfmt (via ultracite); replace turbo references with `vp run -r`. Keep the nix-develop / node-pty rebuild / packaging notes (Electron-native, unaffected).

**Step 4:** Commit.

```bash
git add AGENTS.md
git commit -m "docs(agents): rewrite commands for vp + ultracite; add vite+ block"
```

---

## Task 20: Definition-of-done verification

From a clean clone, in `nix develop` (with `vp env off`):

**Step 1:** Confirm legacy is gone.

Run: `ls turbo.json biome.jsonc .husky .lintstagedrc.json 2>&1` → "No such file or directory" for all four.
Run: `rg -n "turbo|tsup|biome|husky|lint-staged" package.json` → no matches in root devDeps.

**Step 2:** Fresh install + full pipeline.

```bash
vp install
vp run -r typecheck      # canonical tsc, all packages
ultracite check          # oxlint + oxfmt, all packages
vp run -r test           # vitest via vite-plus/test, all packages
vp run -r build          # vp pack (or electron-vite for desktop), all dists produced
```
Expected: every command PASS.

**Step 3:** Packaging smoke.

Run: `vp run desktop#package` → `release/` artifact built (lib dists + electron-vite + electron-builder).

**Step 4:** velomark upstream check.

Confirm `packages/velomark` matches what was pushed to `sakti-dev/velomark`.

**Step 5:** If all green, the migration is complete. Final commit if any doc drift remains.

---

## Risks register (from design doc — track during execution)

1. **node:sqlite under tsdown** — resolved by Task 4 spike (keep fixup if mangled).
2. **velomark Solid conditional output under tsdown** — resolved by Task 9 spike (fallback: keep tsup for velomark build only).
3. **catalog resolution through vp install** — verified Task 14 Step 2.
4. **`vp env off` defers to nix** — verified Task 18 Step 2.
5. **Native rebuild** — keep `electron-builder install-app-deps` for node-pty; never `vp rebuild` for Electron bits. (Mitigated.)
6. **`build:canary`/`hmr`** — confirmed dead (Task 0.3), vanish with Task 17.
7. **`baseUrl`** — verified absent; type-aware lint not at risk.

## Open questions to resolve during execution

- Exact tsdown dist filenames vs current `exports` maps (resolve per-package in Tier 0–3).
- typescript ^5 (catalog) vs the repo's current ^6 — decide in Task 14 Step 1.
- Whether `@effect/vitest` needs a direct `vitest` dep retained in agent (Task 5).
- Whether electron-vite's bundled Vite satisfies the "Vite 8+" floor (desktop keeps electron-vite regardless; only relevant if `vp dev`/`vp build` are pointed at desktop, which they are NOT in this plan).
