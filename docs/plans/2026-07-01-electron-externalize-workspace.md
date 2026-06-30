# Externalize Workspace Packages in the Electron Main Build

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This is an infra/config change — there are no unit tests; each task verifies via build output greps and a dev/prod smoke run.

**Goal:** Stop editing `apps/desktop/electron.vite.config.ts` every time a package is added. Externalize the `@sakti-code/*` workspace namespace so the Electron main consumes those packages as **pre-built dist libraries**; their internal dependencies never flow into the main bundle.

**Architecture:** Add `/^@sakti-code\//` to the main build's `external`. Workspace packages are already fully packable — verified: `@sakti-code/{server,db,tools,llm,logger,agent}` all have `pack:` configs + `dist/`, and `vp pack` externalizes each package's own `dependencies` (so `tools` → `turndown` resolves from `node_modules` at runtime, never reaching desktop's bundler). `@sakti-code/pi-natives` is a native Rust crate (no dist) — the regex keeps it external exactly as the explicit entry does today. Prod already runs `vp run -r build` before `electron-vite build`; dev needs the same pre-build added.

**Tech Stack:** electron-vite, vite-plus (`vp pack` / `vp run -r build`), tsdown, pnpm workspace.

**Verified findings (ground truth for this plan):**

- Built `apps/desktop/out/main/index.js` today **inlines** `@sakti-code/{server,agent,tools,llm,logger}` from source (5 MB + chunks). Only `electron`, `pino`, `@sakti-code/pi-natives`, `@ff-labs/fff-node`, `@vscode/ripgrep`, and node builtins are external — i.e. exactly the explicit `external` array. electron-vite's default `externalizeDeps` is contributing nothing; the explicit array is the only thing that takes effect.
- `vp pack` externalizes a package's `dependencies`: `packages/tools/dist/index.mjs` keeps `diff`, `lru-cache`, `@sakti-code/pi-natives` as bare imports and does NOT inline them. So consuming workspace dist makes desktop's bundle blind to those packages' internal deps.
- Every consumed workspace JS package is packable with dist present (see matrix below). `pi-natives` is the sole non-packable (native crate), already external.
- `vp run -r build --watch` forwards `--watch` to each package's `vp pack` (confirmed).

**Workspace package matrix:**
| package | location | pack config | dist | consumed by main |
| --- | --- | --- | --- | --- |
| @sakti-code/server | apps/server | yes | yes | yes (embeds via createServer) |
| @sakti-code/agent | packages/agent | yes | yes | yes (transitive) |
| @sakti-code/tools | packages/tools | yes | yes | yes (transitive) |
| @sakti-code/llm | packages/llm | yes | yes | yes (transitive) |
| @sakti-code/logger | packages/logger | yes | yes | yes (transitive) |
| @sakti-code/db | packages/db | yes | yes | yes (transitive) |
| @sakti-code/pi-natives | crates/pi-natives | no (native) | n/a | yes (native binding) |

**Conventions:** `apps/desktop` uses electron-vite; main is ESM output; dev launcher is `apps/desktop/scripts/dev.mjs`.

---

### Task 1: Externalize `@sakti-code/*` in the main build

**Files:**

- Modify: `apps/desktop/electron.vite.config.ts` (the `main.build.rollupOptions.external` array, lines ~11–26)

**Step 1: Replace the `external` array**

Replace the entire `external: [ ... ]` block with:

```ts
        external: [
          "electron",
          // Workspace packages are consumed as pre-built dist (apps/*/dist,
          // packages/*/dist) — see dev.mjs / the `package` script, which run
          // `vp run -r build` before electron-vite. Adding a dependency inside
          // a workspace package (e.g. tools → turndown) no longer flows into
          // this bundle; only that package's own `vp pack` build sees it.
          // Also covers @sakti-code/pi-natives (native Rust crate, no dist).
          /^@sakti-code\//,
          // @vscode/ripgrep resolves its platform binary via a dynamic
          // require.resolve('@vscode/ripgrep-<plat>-<arch>/bin/rg') at runtime;
          // bundlers can't statically resolve that, so the platform subpackages
          // must stay external and resolve from node_modules.
          /^@vscode\/ripgrep/,
          // pino's worker-thread transport (pino.transport({ target: "pino-roll" }))
          // spawns a worker that resolves "pino-roll" + its deps at runtime via
          // require.resolve — bundling inlines the code but breaks that runtime
          // resolution (silent async worker failure → no log files written).
          // Must stay external + hoisted as direct deps of desktop.
          /^pino(?:-roll)?$/,
          // Native node bindings — can't be bundled (.node / platform binaries).
          "@ff-labs/fff-node",
        ],
```

Net change: **add** `/^@sakti-code\//`; **remove** the old explicit `"@sakti-code/pi-natives"` string and its now-redundant comment block (the regex subsumes it). Everything else stays.

**Step 2: Verify the prod build externalizes workspace packages**

Run:

```bash
vp run -r build && vp run '@sakti-code/server#build' >/dev/null 2>&1; vp run desktop#build:electron
```

(apps/desktop `package` script is `vp run -r build && electron-vite build && electron-builder`; `build:electron` is just `electron-vite build` — sufficient for this check.)

Then grep the output:

```bash
grep -oE 'from "@sakti-code/[^"]+"' apps/desktop/out/main/index.js | sort -u
```

Expected: the list now includes `@sakti-code/server` (and any workspace packages the main reaches directly), e.g. `from "@sakti-code/server"`. Before this change that set was empty (all inlined).

**Step 3: Verify the native/transitive leak is gone**

The whole point: a dep added to `tools` (e.g. `turndown`) must NOT appear in the main bundle.

```bash
grep -cE "TurndownService|turndown" apps/desktop/out/main/index.js
```

Expected: `0` (turndown now lives only in `packages/tools/dist`, reached at runtime via `require`/`import` from `node_modules`). Also check size dropped materially:

```bash
wc -c apps/desktop/out/main/index.js
```

Expected: substantially smaller than the previous ~5 MB (server/agent/tools/llm/logger code no longer inlined).

**Step 4: Verify no unintended inlined workspace code remains**

```bash
grep -cE "createWebFetchTool|createServer" apps/desktop/out/main/index.js
```

Expected: `0` (these are now inside workspace dist, not the main bundle).

**Step 5: Commit**

```bash
git add apps/desktop/electron.vite.config.ts
git commit -m "build(desktop): externalize @sakti-code/* in the electron main bundle

Workspace packages are consumed as pre-built dist, so adding a dependency
inside one (e.g. tools -> turndown) no longer flows into the main bundle.
Drops the explicit @sakti-code/pi-natives entry (subsumed by the namespace
regex; pi-natives is a native crate that stays external either way)."
```

---

### Task 2: Make `dev` consume workspace dist (pre-build before electron-vite)

**Files:**

- Modify: `apps/desktop/scripts/dev.mjs`

**Why:** With `@sakti-code/*` external, `electron-vite dev` must resolve those imports from `dist/` at runtime. Prod already builds dist first (`package` script); dev currently bundles source and does no pre-build, so it would fail to resolve workspace packages after Task 1. Add the same pre-build to dev.

**Step 1: Add a one-shot workspace build before launching electron-vite**

In `apps/desktop/scripts/dev.mjs`, restructure the launch so the existing `cleanLogs()` and env setup run, then a `vp run -r build` completes before `electron-vite dev` spawns. Wrap the script body in an async `main()` so the build can be awaited. Concretely, after the `process.env.SAKTI_LOG_SECRETS ??= "true";` line and before the `const ps = spawn("electron-vite", ...)` block, add:

```js
// Build workspace package dist so the Electron main can consume @sakti-code/*
// as pre-built libraries (they're externalized in electron.vite.config.ts).
// Prod does the same via the `package` script (`vp run -r build && electron-vite build`).
console.log("[dev] building workspace dist (vp run -r build)…");
const build = spawn("vp", ["run", "-r", "build"], { stdio: "inherit", shell: true });
await new Promise((resolve, reject) => {
  build.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`workspace build failed (exit ${code}))`)),
  );
  build.on("error", reject);
});
```

The whole script is ESM (`"type": "module"`), so top-level `await` is legal — but to keep it clean, wrap the existing top-level statements in `async function main() { … } main();` (or use top-level await directly). Pick one and apply consistently.

**Step 2: Verify dev boots and resolves workspace packages**

Run: `vp run desktop#dev`
Expected: the `[dev] building workspace dist…` line prints, `vp run -r build` succeeds, then electron-vite starts and the Electron window opens without a "Cannot find module '@sakti-code/server'" (or similar) error in the console.

Sanity check the runtime resolution path: with dev running, the main process should be starting the embedded Hono server on port 3001 (same as before). If the window opens and the renderer loads, resolution works.

**Step 3: Commit**

```bash
git add apps/desktop/scripts/dev.mjs
git commit -m "build(desktop): pre-build workspace dist before electron-vite dev

The main bundle now consumes @sakti-code/* as external pre-built libraries,
so dev must build their dist (vp run -r build) before launching electron-vite,
mirroring the prod \`package\` script."
```

---

### Task 3: Live workspace rebuilds during dev (enhancement)

**Files:**

- Modify: `apps/desktop/scripts/dev.mjs`
- Create: `apps/desktop/electron/main/workspace-stamp.ts`
- Modify: `apps/desktop/electron/main/index.ts`

**Why:** After Task 1+2, editing a workspace package no longer auto-rebuilds the main process (workspace source is outside main's module graph; only `dist/` is, via external imports — and electron-vite doesn't watch external deps). This task restores the previous DX: save a workspace file → dist rebuilds → Electron main restarts.

**Approach (the "stamp" trick):** maintain a tiny file imported by the main entry whose contents change whenever workspace dist changes. electron-vite watches the main's imports, so a stamp change triggers a main rebuild + Electron restart. A concurrent `vp run -r build --watch` keeps dist fresh; a small file-watcher rewrites the stamp on each dist change.

**Step 1: Add the stamp file and import it from main**

Create `apps/desktop/electron/main/workspace-stamp.ts`:

```ts
// Bumped by apps/desktop/scripts/dev.mjs whenever a workspace package's dist
// changes, so electron-vite (which watches this import) rebuilds + restarts the
// Electron main. Prod ignores this file entirely.
export const WORKSPACE_STAMP = "0";
```

In `apps/desktop/electron/main/index.ts`, add a side-effect import near the top (after the existing imports):

```ts
import { WORKSPACE_STAMP } from "./workspace-stamp";
```

And, only in dev, reference it so it isn't tree-shaken — e.g. inside the existing dev-only block:

```ts
if (import.meta.env.DEV) {
  console.log(`[main] workspace build stamp: ${WORKSPACE_STAMP}`);
}
```

(If there's no dev-only block, a top-level `void WORKSPACE_STAMP;` is enough to pin it in the graph. Check the file first and pick the least invasive option.)

**Step 2: Spawn the workspace watcher and stamp-bumper in dev.mjs**

After the one-shot build (from Task 2) and before spawning `electron-vite dev`, add:

```js
// Keep workspace dist fresh as packages/* are edited, and bump the main's
// workspace-stamp so electron-vite rebuilds + restarts Electron on each change.
import { watch } from "node:fs";
import { writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const distDirs = [
  resolve(repoRoot, "apps", "server", "dist"),
  resolve(repoRoot, "packages", "agent", "dist"),
  resolve(repoRoot, "packages", "tools", "dist"),
  resolve(repoRoot, "packages", "llm", "dist"),
  resolve(repoRoot, "packages", "logger", "dist"),
  resolve(repoRoot, "packages", "db", "dist"),
];
const stampPath = resolve(here, "..", "electron", "main", "workspace-stamp.ts");
let bumpTimer;
const bumpStamp = () => {
  writeFileSync(stampPath, `export const WORKSPACE_STAMP = "${Date.now()}";\n`);
};
for (const dir of distDirs) {
  watch(dir, { recursive: true }, (_event, file) => {
    if (!file || !file.endsWith(".mjs")) return;
    clearTimeout(bumpTimer);
    bumpTimer = setTimeout(bumpStamp, 150); // debounce burst rebuilds
  });
}

const watcher = spawn("vp", ["run", "-r", "build", "--watch"], { stdio: "inherit", shell: true });
```

And wire cleanup so the watcher dies with the process — update the existing exit handler:

```js
ps.on("exit", (code) => {
  watcher.kill();
  build.kill();
  process.exit(code ?? 0);
});
```

(Adjust if `build` was already consumed/removed in Task 2; the one-shot `build` process has exited by this point, so only `watcher` truly needs killing — keep `build.kill()` defensively only if it's still referenced.)

**Step 3: Verify the live-reload loop**

Run: `vp run desktop#dev`, let it boot. Then make a trivial edit in a workspace package (e.g. add and remove a blank line in `packages/tools/src/index.ts`, or bump a logged string) and save.
Expected: the `vp run -r build --watch` process logs a rebuild for that package; within ~150 ms the stamp file updates; electron-vite logs a main rebuild and Electron restarts. The new workspace code is now live.

**Fallback if the stamp trick doesn't trigger a rebuild:** some electron-vite versions don't watch imports outside the entry's resolved graph even if statically imported. If the rebuild doesn't fire, add the stamp file to the main build's watch list explicitly:

```ts
// in electron.vite.config.ts -> main
build: { watch: { include: ["electron/main/workspace-stamp.ts"] } },
```

and re-verify. If it still doesn't fire, drop Task 3 entirely and document that workspace edits require a manual dev restart (Ctrl-C + re-run) — Task 1+2 already deliver the primary goal.

**Step 4: Commit**

```bash
git add apps/desktop/electron/main/workspace-stamp.ts apps/desktop/electron/main/index.ts apps/desktop/scripts/dev.mjs
git commit -m "build(desktop): live-reload electron main on workspace dist changes

vp run -r build --watch rebuilds workspace dist on save; dev.mjs bumps a
workspace-stamp imported by the main entry so electron-vite rebuilds and
restarts Electron, restoring the pre-externalization edit->reload DX."
```

---

### Task 4: Full verification

**Step 1: Lint / typecheck**

Run: `vp check`
Expected: clean. (`vp check --fix` if formatting drifts.)

**Step 2: Prod packaging smoke (no electron-builder needed)**

Run:

```bash
vp run desktop#build:electron
```

Expected: succeeds. Then confirm the externalization + de-duplication held:

```bash
grep -oE 'from "@sakti-code/[^"]+"' apps/desktop/out/main/index.js | sort -u
grep -cE "TurndownService|createServer" apps/desktop/out/main/index.js   # expect 0
wc -c apps/desktop/out/main/index.js                                     # expect << 5 MB
```

**Step 3: Dev smoke**

Run: `vp run desktop#dev`
Expected: pre-build runs, Electron boots, window loads, embedded server on :3001. Make a workspace edit (per Task 3 Step 3) and confirm it reloads (or, if Task 3 was dropped, restart dev to confirm the change is picked up).

**Step 4: Tests (unchanged, just confirm nothing broke)**

Run: `vp run -r test`
Expected: all green (no source logic changed; only build wiring).

**Step 5: Commit any remaining formatting**

If `vp check --fix` touched files:

```bash
git add -A && git commit -m "style(desktop): apply formatting to dev/build wiring"
```

---

## Notes & risks

- **No pack configs need adding.** Every consumed `@sakti-code/*` JS package is already packable with dist (`apps/server`, `packages/{agent,tools,llm,logger,db}`). The earlier "server has no pack config" worry was a wrong-path artifact — server is at `apps/server`, not `packages/server`, and already has a full `pack:` block.
- **Runtime resolution chain is sound.** Each workspace `dist` externalizes its own deps, resolved from `node_modules` via pnpm at runtime: main → `@sakti-code/server` (dist) → `@sakti-code/tools` (dist) → `turndown` (node_modules). Verified that `tools/dist` keeps `diff`/`lru-cache`/`@sakti-code/pi-natives` as bare imports and does not inline them.
- **`pi-natives` unchanged.** Native Rust crate, no dist; the `/^@sakti-code\//` regex keeps it external exactly as the explicit string did. No behavior change.
- **Renderer is unaffected.** This change touches only the `main` build's `external`. The renderer bundles its own deps independently and talks to the embedded server over HTTP/WS; it does not import `@sakti-code/server` values. (Worth a confirm-grep during Task 4: `grep -rn "@sakti-code" apps/desktop/src` should show only type-only imports.)
- **Still-external non-workspace packages** (`@vscode/ripgrep` platform subpackages, `pino`/`pino-roll` worker transport, `@ff-labs/fff-node` native) remain in the list. These are stable, runtime-resolution-special packages — they won't grow unless a new _direct_ native dep is added to desktop itself (rare).
- **Dev DX tradeoff.** Externalizing means workspace source is no longer in main's module graph, so the auto-rebuild on workspace edits is lost unless Task 3 is in place. Task 3 restores it via the stamp trick; if that proves flaky, the fallback is a manual dev restart (still leaves the primary goal — no more config edits — fully achieved).
