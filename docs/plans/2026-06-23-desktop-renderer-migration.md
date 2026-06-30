# Desktop Renderer Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the SolidJS renderer from `apps/app` (Electrobun) into `apps/desktop` (Electron) and delete `apps/app`, with the renderer talking to the embedded Hono server.

**Architecture:** The renderer is already process-agnostic — `store-context.tsx` sets `API_URL = window.location.origin` and the WS client derives its URL from the same base. So we keep that code **unchanged** and make Electron serve the renderer **same-origin** in both modes:

- **Dev:** embedded server on fixed port `3001`; electron-vite's renderer dev server proxies `/api` and `/ws` to it → `window.location.origin` (the vite dev server) routes to the embedded server.
- **Prod:** `createServer({ staticDir: out/renderer })` serves the built renderer; the window `loadURL(server.url)` → same-origin.

No CORS, no renderer rewiring, no `window.sakti` needed for the API. The Electrobun main (`apps/app/src/lib/bun/index.ts`) is deleted — its job is already done by `apps/desktop/electron/main/index.ts`.

**Tech Stack:** SolidJS, Vite (via electron-vite), Tailwind v4, Kobalte, Hono RPC (`hc<App>`), vitest + jsdom, bun:test. Electron 42, electron-vite 5, vite 7.

**Prerequisite:** the `desktop-electron-app` shell is implemented (`apps/desktop` exists with working `electron/main`, `electron/preload`, `electron.vite.config.ts`). Run everything from the repo root, inside `nix develop` (Electron needs the runtime libs; `node-pty` rebuild needs python3).

---

## Task 1: Add renderer dependencies to `apps/desktop`

**Files:**

- Modify: `apps/desktop/package.json`

**Step 1: Add the renderer deps**

These are carried over from `apps/app/package.json` (known-good versions; do NOT chase latest — electron-vite caps Vite at 7 and Solid needs vite-plugin-solid).

Add to `dependencies`:

```jsonc
"@kobalte/core": "^0.13.11",
"@corvu/resizable": "^0.2.5",
"@solid-primitives/presence": "^0.1.3",
"@solid-primitives/virtual": "^0.2.3",
"class-variance-authority": "^0.7.1",
"clsx": "^2.1.1",
"dayjs": "^1.11.21",
"hono": "^4.12.26",
"motion-solidjs": "^0.5.0",
"solid-icons": "^1.2.0",
"solid-js": "^1.9.3",
"tailwind-merge": "^3.6.0",
"tailwindcss": "^4.3.1",
"tailwindcss-animate": "^1.0.7"
```

Add to `devDependencies`:

```jsonc
"@earendil-works/pi-ai": "^0.79.9",
"@solidjs/testing-library": "^0.8.10",
"@tailwindcss/vite": "^4.3.1",
"@testing-library/jest-dom": "^6.9.1",
"@testing-library/user-event": "^14.6.1",
"jsdom": "^29.1.1",
"vite-plugin-solid": "^2.11.0",
"vitest": "^4.1.9"
```

Also add a `test` script:

```jsonc
"test": "vitest run"
```

**Step 2: Install**

Run: `bun install`
Expected: installs resolve cleanly; `bun.lock` updated.

**Step 3: Commit**

```bash
git add apps/desktop/package.json bun.lock
git commit -m "chore(desktop): add SolidJS renderer dependencies"
```

---

## Task 2: Wire the renderer build config

**Files:**

- Modify: `apps/desktop/electron.vite.config.ts`
- Modify: `apps/desktop/tsconfig.json`

**Step 1: Add Solid + Tailwind plugins + dev proxy to the renderer block**

Replace the `renderer:` block in `apps/desktop/electron.vite.config.ts` with:

```ts
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
// ... (add to existing imports at top)
```

```ts
  renderer: {
    root: resolve(import.meta.dirname, "src"),
    resolve: {
      alias: {
        "~": resolve(import.meta.dirname, "src"),
        // Solid JSX runtime must resolve to the non-dev build for HMR correctness
        "solid-js/jsx-runtime": "solid-js/h/jsx-runtime",
        "solid-js/jsx-dev-runtime": "solid-js/h/jsx-dev-runtime",
      },
    },
    plugins: [solid(), tailwindcss()],
    server: {
      // dev: the embedded server runs on fixed 3001; proxy so window.location.origin works
      proxy: {
        "/api": "http://localhost:3001",
        "/ws": { target: "ws://localhost:3001", ws: true },
      },
    },
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, "src/index.html") },
    },
  },
```

**Step 2: Add path aliases to tsconfig**

In `apps/desktop/tsconfig.json`, add a `paths` block under `compilerOptions` (carries `@sakti-code/agent` and the pi-ai type alias from `apps/app/tsconfig.json`; drop the dead `elysia` alias):

```jsonc
"paths": {
  "@sakti-code/agent": ["../../packages/agent/src/index.ts"],
  "@sakti-code/agent/*": ["../../packages/agent/src/*"],
  "@earendil-works/pi-ai": ["../../packages/agent/node_modules/@earendil-works/pi-ai/dist/index.d.ts"],
  "@earendil-works/pi-ai/*": ["../../packages/agent/node_modules/@earendil-works/pi-ai/dist/*"]
}
```

**Step 3: Verify config loads**

Run: `cd apps/desktop && node_modules/.bin/electron-vite build`
Expected: build runs (it's fine if it fails on missing `src/app.tsx` — that lands in Task 4; the config itself must parse with no "failed to load config" error).

**Step 4: Commit**

```bash
git add apps/desktop/electron.vite.config.ts apps/desktop/tsconfig.json
git commit -m "build(desktop): wire solid+tailwind+dev proxy in renderer config"
```

---

## Task 3: Serve the renderer same-origin from Electron main

**Files:**

- Modify: `apps/desktop/electron/main/index.ts`
- Modify: `apps/desktop/electron/main/lifecycle.ts`

This is what makes `window.location.origin` resolve to the embedded server, so the renderer needs **no** API-URL change.

**Step 1: `main/index.ts` — fixed dev port, static dir in prod**

At top, add:

```ts
import { resolve } from "node:path";
```

In the `app.on("ready")` handler, change the `createServer` call:

```ts
const isDev = !app.isPackaged();
server = await createServer({
  port: isDev ? 3001 : 0,
  hostname: "127.0.0.1",
  staticDir: isDev ? null : resolve(import.meta.dirname, "../renderer"),
  hooks: createDialogHooks(),
});
```

Then pass `server.url` into the window creation: change `createWindow()` → `createWindow(server.url)`.

**Step 2: `lifecycle.ts` — load the server URL in prod**

Change the signature and the load logic:

```ts
export function createWindow(serverUrl: string): BrowserWindow {
  // ... BrowserWindow opts unchanged ...
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadURL(serverUrl); // same-origin: server serves the built renderer (staticDir)
  }
  return win;
}
```

(Delete the `PROD_INDEX` constant — no longer used.)

**Step 3: Verify it boots**

Run (in `nix develop`): `cd apps/desktop && node_modules/.bin/electron-vite build && timeout 20 node_modules/.bin/electron . --no-sandbox`
Expected: log `embedded server on http://127.0.0.1:3001`. (The smoke `index.html` still prints `SMOKE OK` — Task 4 replaces it.)

**Step 4: Commit**

```bash
git add apps/desktop/electron/main/index.ts apps/desktop/electron/main/lifecycle.ts
git commit -m "feat(desktop): serve renderer same-origin (dev proxy / prod staticDir)"
```

---

## Task 4: Move the renderer source into `apps/desktop/src`

**Files:**

- Move: `apps/app/src/**` → `apps/desktop/src/**`
- Delete: `apps/app/src/lib/bun/index.ts` (Electrobun main — replaced by `electron/main`)
- Keep: `apps/desktop/src/lib/electron.ts` (the type bridge already there)

**Step 1: Move the source (preserve git history)**

```bash
cd /home/eekrain/CODE/sakti-code
# move everything except the electrobun main + the existing desktop smoke files
git mv apps/app/src/app.tsx              apps/desktop/src/app.tsx
git mv apps/app/src/index.css            apps/desktop/src/index.css
git mv apps/app/src/index.html           apps/desktop/src/index.html
git mv apps/app/src/globals.d.ts         apps/desktop/src/globals.d.ts
git mv apps/app/src/components            apps/desktop/src/components
git mv apps/app/src/stores                apps/desktop/src/stores
git mv apps/app/src/lib/api.ts            apps/desktop/src/lib/api.ts
git mv apps/app/src/lib/utils             apps/desktop/src/lib/utils
# window-state logic stays (pure fs); the electrobun main goes away
git mv apps/app/src/lib/bun/window-state.ts apps/desktop/src/lib/window-state.ts
git rm apps/app/src/lib/bun/index.ts
```

The `~` alias (Task 2) maps to `src`, so `~/lib/api`, `~/stores/...` imports resolve unchanged.

**Step 2: Merge `globals.d.ts`**

The moved `globals.d.ts` declares `module "three"` and `module "*.css"`. The existing `apps/desktop/src/lib/electron.ts` declares `window.sakti`. Both coexist — no merge needed (they're separate files).

**Step 3: Verify it builds**

Run: `cd apps/desktop && node_modules/.bin/electron-vite build`
Expected: `out/renderer/index.html` + bundled JS emitted, no "failed to resolve entry src/index.html" error. Type errors are fine for now (Task 6 fixes them).

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(desktop): migrate SolidJS renderer from apps/app"
```

---

## Task 5: Port window-state persistence to Electron main

**Files:**

- Modify: `apps/desktop/electron/main/lifecycle.ts`
- Uses: `apps/desktop/src/lib/window-state.ts` (moved in Task 4 — but it uses `node:fs`; main can import it)

> `window-state.ts` is pure Node `fs` code (load/save a JSON frame to `~/.sakti/window-state.json`). It's reusable from main. The Electrobun event shapes are gone; Electron's `BrowserWindow` emits plain `'resize'`/`'move'`/`'close'`.

**Step 1: Move `window-state.ts` to the electron side**

It's a main-process concern now, not renderer. Move it:

```bash
git mv apps/desktop/src/lib/window-state.ts apps/desktop/electron/main/lib/window-state.ts
```

No code changes inside it (it's pure fs + validation).

**Step 2: Restore + persist the frame in `lifecycle.ts`**

```ts
import { getCurrentWindowBounds, ... } from "./lib/window-state";
```

In `createWindow`:

```ts
import {
  DEFAULT_FRAME,
  debouncedSaveWindowState,
  flushWindowState,
  loadWindowState,
} from "./lib/window-state";

const frame = loadWindowState();
const win = new BrowserWindow({
  width: frame.width,
  height: frame.height,
  x: frame.x,
  y: frame.y,
  // ...rest unchanged
});
const save = () => debouncedSaveWindowState(win.getBounds());
win.on("resize", save);
win.on("move", save);
win.on("close", () => flushWindowState(win.getBounds()));
```

**Step 3: Verify**

Run (in `nix develop`): `cd apps/desktop && node_modules/.bin/electron-vite build && timeout 15 node_modules/.bin/electron . --no-sandbox`
Expected: boots; on second launch the window reopens at the previous size/pos; `~/.sakti/window-state.json` is written.

**Step 4: Commit**

```bash
git add apps/desktop/electron/main
git commit -m "feat(desktop): persist window state across restarts"
```

---

## Task 6: Migrate the test suite + get typecheck green

**Files:**

- Create: `apps/desktop/vitest.config.ts`
- Modify: `apps/desktop/tsconfig.json` (test types)
- Uses: existing tests moved in Task 4 (`apps/desktop/src/**/__tests__/**`)

**Step 1: Create `apps/desktop/vitest.config.ts`**

```ts
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  root: resolve(import.meta.dirname, "src"),
  resolve: { alias: { "~": resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

**Step 2: Move the test setup**

```bash
git mv apps/app/src/test-setup.ts apps/desktop/src/test-setup.ts 2>/dev/null || true
```

If `apps/app` had no `test-setup.ts`, create a minimal `apps/desktop/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

**Step 3: Add test types to tsconfig**

In `apps/desktop/tsconfig.json` `compilerOptions`:

```jsonc
"types": ["node", "bun", "vitest/globals", "@testing-library/jest-dom"],
```

**Step 4: Run typecheck — fix move-related breakages**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: a handful of errors from stale imports (e.g. `~/lib/bun/...` references). Fix each by repointing to the new path. Commit per green cluster if many.

**Step 5: Run the tests**

Run: `cd apps/desktop && bun x vitest run`
Expected: the migrated store/ws-client/component tests pass (they're self-contained; the api/ws-client tests inject mocks).

**Step 6: Commit**

```bash
git add apps/desktop
git commit -m "test(desktop): migrate renderer vitest suite; typecheck green"
```

---

## Task 7: Full verification

**Step 1: Repo-wide typecheck**

Run: `bun typecheck`
Expected: `Tasks: 6 successful, 6 total` (agent, db, tools, server, desktop, app — app still exists until Task 8).

**Step 2: Lint**

Run: `bun x ultracite fix && bun x ultracite check`
Expected: 0 errors.

**Step 3: Dev launch (in `nix develop`)**

Run: `cd apps/desktop && bun dev`
Expected: the Electron window opens showing the real SolidJS UI (workspace layout, sidebar); the embedded server logs on `3001`; sending a prompt streams over WS.

**Step 4: Prod build + run (in `nix develop`)**

Run: `cd apps/desktop && bun run package` then launch the `release/` artifact.
Expected: window loads from the embedded server URL (same-origin); a prompt round-trips; data persists across restart.

**Step 5: Commit any verification fixes**

```bash
git add -A
git commit -m "chore(desktop): verify renderer migration end-to-end"
```

---

## Task 8: Delete `apps/app` + cleanup

**Files:**

- Delete: `apps/app/` (entire package)
- Modify: nothing else (workspaces auto-discover `apps/*`; turbo auto-drops it)

**Step 1: Remove the old package**

```bash
git rm -r apps/app
```

**Step 2: Re-run typecheck to confirm 5/5**

Run: `bun typecheck`
Expected: `Tasks: 5 successful, 5 total` (app gone).

**Step 3: Update docs**

- `AGENTS.md`: the `apps/app` reference is gone; confirm the `apps/desktop` entry (added in the shell change) is accurate and note the renderer is now in `apps/desktop/src`.
- `openspec/PRD.md`: the architecture diagram still says "Electrobun Desktop Shell (apps/app)" (line ~36) — update to "Electron (apps/desktop)".

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove Electrobun apps/app; renderer now in apps/desktop"
```

---

## Notes for the executor

- **The renderer source is intentionally unchanged.** All the work is config + file moves + main-side same-origin serving. If you find yourself editing `store-context.tsx` or `ws-client.ts`, stop and re-check Task 3 — `window.location.origin` must resolve to the embedded server.
- **Dev port is fixed at 3001** (not ephemeral) so the vite proxy works. Do NOT also run `bun dev:server` in dev — the embedded server is the server. Prod stays ephemeral (`port: 0`).
- **No `apps/server` changes.** `createServer({ port, staticDir, hooks })` already supports both.
- **Run Electron stuff inside `nix develop`** — Chromium needs the runtime libs; after `bun install` run `cd apps/desktop && bun run rebuild` once for `node-pty`.
- **TDD where there's new logic** (window-state port, config). For the migration itself, "existing tests pass" IS the green bar.
- If a Solid HMR or JSX error appears, confirm the `solid-js/jsx-runtime` → `solid-js/h/jsx-runtime` aliases (Task 2) are present.
