# Migration Plan: electron-vite → Plain Vite

## Overview

Migrate from `electron-vite` to **plain Vite** with a custom watch script for better control over the build process, especially for handling native modules and workspace packages.

## Current vs Target Architecture

### Current (electron-vite)

```
packages/desktop/
  ├── electron.vite.config.ts  ← single config for all
  ├── src/main/
  ├── src/preload/
  └── src/renderer/
```

### Target (Plain Vite)

```
apps/
  ├── electron/           ← main process (new)
  │   └── vite.config.ts
  ├── preload/            ← preload scripts (new)
  │   └── vite.config.ts
  └── desktop/            ← renderer (existing, restructured)
      └── vite.config.ts

packages/
  ├── core/               ← pre-built to dist/
  ├── server/             ← pre-built to dist/
  ├── shared/             ← pre-built to dist/
  └── zai/                ← pre-built to dist/

scripts/
  └── watch.ts            ← dev orchestration (new)
```

---

## Phase 1: Add Build to Workspace Packages

**Goal**: Each `@ekacode/*` package compiles to `dist/` folder.

### Step 1.1: Create shared Vite config for packages

```typescript
// packages/vite.shared.ts
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export function createPackageConfig(entry: string | string[]) {
  return defineConfig({
    build: {
      ssr: true,
      target: "node20",
      outDir: "dist",
      lib: {
        entry,
        formats: ["es"],
      },
      rollupOptions: {
        external: [
          /^@ekacode\//, // workspace packages
          /^@mastra\//, // mastra ecosystem
          /^@libsql\//, // libsql native
          "better-sqlite3",
          "pino",
          "pino-pretty",
          "ts-morph",
          "typescript",
          /^tree-sitter/,
          /^node:/, // node builtins
        ],
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "[name].js",
        },
      },
      emptyOutDir: true,
    },
    plugins: [dts({ rollupTypes: true })],
  });
}
```

### Step 1.2: Add vite.config.ts to each package

**packages/shared/vite.config.ts**

```typescript
import { createPackageConfig } from "../vite.shared";

export default createPackageConfig({
  index: "src/index.ts",
  paths: "src/paths.ts",
  logger: "src/logger.ts",
});
```

**packages/core/vite.config.ts**

```typescript
import { createPackageConfig } from "../vite.shared";

export default createPackageConfig({
  index: "src/index.ts",
  server: "src/server.ts",
});
```

_(Similar for `packages/server` and `packages/zai`)_

### Step 1.3: Update package.json exports

**Before:**

```json
{
  "exports": {
    ".": "./src/index.ts"
  }
}
```

**After:**

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

### Step 1.4: Add build scripts

**packages/shared/package.json**

```json
{
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch"
  }
}
```

---

## Phase 2: Create Separate App Directories

### Step 2.1: Create apps/electron (main process)

```
apps/electron/
  ├── src/
  │   ├── index.ts        ← from packages/desktop/src/main/
  │   └── ipc.ts
  ├── vite.config.ts
  ├── package.json
  └── tsconfig.json
```

**apps/electron/vite.config.ts**

```typescript
import { defineConfig } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  build: {
    ssr: true,
    target: "node20",
    outDir: "dist",
    lib: {
      entry: join(__dirname, "src/index.ts"),
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "electron",
        /^@ekacode\//,
        /^@mastra\//,
        /^@libsql\//,
        "better-sqlite3",
        "pino",
        "ts-morph",
        "typescript",
        /^tree-sitter/,
        /^node:/,
      ],
      output: {
        entryFileNames: "[name].js",
      },
    },
    emptyOutDir: true,
  },
});
```

### Step 2.2: Create apps/preload

```
apps/preload/
  ├── src/
  │   └── index.ts        ← from packages/desktop/src/preload/
  ├── vite.config.ts
  ├── package.json
  └── tsconfig.json
```

**apps/preload/vite.config.ts**

```typescript
import { defineConfig } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  build: {
    ssr: true,
    target: "chrome130", // Electron's Chrome version
    outDir: "dist",
    lib: {
      entry: join(__dirname, "src/index.ts"),
      formats: ["cjs"], // Preload must be CJS or .mjs
    },
    rollupOptions: {
      external: ["electron"],
      output: {
        entryFileNames: "[name].cjs",
      },
    },
    emptyOutDir: true,
  },
});
```

### Step 2.3: Restructure apps/desktop (renderer)

```
apps/desktop/               ← renamed from packages/desktop
  ├── src/                  ← only renderer code now
  │   ├── App.tsx
  │   └── ...
  ├── index.html
  ├── vite.config.ts        ← renderer-only config
  └── package.json
```

**apps/desktop/vite.config.ts**

```typescript
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "index.html",
    },
  },
});
```

---

## Phase 3: Create Watch Script

### Step 3.1: Create scripts/watch.ts

```typescript
#!/usr/bin/env node
import type { ChildProcess } from "node:child_process";
import type { ViteDevServer } from "vite";
import { spawn } from "node:child_process";
import path from "node:path";
import { build, createServer } from "vite";
import electronPath from "electron";

const mode = process.env.MODE || "development";
process.env.MODE = mode;

let electronApp: ChildProcess | null = null;

// 1. Start renderer dev server (HMR)
async function startRenderer(): Promise<ViteDevServer> {
  const server = await createServer({
    configFile: "apps/desktop/vite.config.ts",
    mode,
  });
  await server.listen();
  return server;
}

// 2. Build and watch main process
async function watchMain(rendererServer: ViteDevServer) {
  process.env.VITE_DEV_SERVER_URL = rendererServer.resolvedUrls?.local[0];

  await build({
    configFile: "apps/electron/vite.config.ts",
    mode,
    build: { watch: {} },
    plugins: [
      {
        name: "restart-electron",
        writeBundle() {
          if (electronApp) {
            electronApp.removeListener("exit", process.exit);
            electronApp.kill("SIGINT");
            electronApp = null;
          }

          console.log("Starting Electron...");
          electronApp = spawn(String(electronPath), ["."], {
            cwd: path.resolve(import.meta.dirname, "../apps/electron"),
            stdio: "inherit",
          });
          electronApp.addListener("exit", process.exit);
        },
      },
    ],
  });
}

// 3. Build and watch preload
async function watchPreload(rendererServer: ViteDevServer) {
  await build({
    configFile: "apps/preload/vite.config.ts",
    mode,
    build: { watch: {} },
    plugins: [
      {
        name: "reload-on-preload-change",
        writeBundle() {
          rendererServer.ws.send({ type: "full-reload" });
        },
      },
    ],
  });
}

// Main
(async () => {
  const renderer = await startRenderer();
  await watchPreload(renderer);
  await watchMain(renderer);
})();
```

### Step 3.2: Update root package.json scripts

```json
{
  "scripts": {
    "dev": "tsx scripts/watch.ts",
    "build:pkg": "pnpm -F './packages/**' build",
    "build": "pnpm build:pkg && turbo run build",
    "postinstall": "pnpm build:pkg"
  }
}
```

---

## Phase 4: Handle Native Modules

### Key Strategy

Native modules are **externalized** at every level and resolved at **runtime** by Node.js/Electron.

**Pattern: Regex-based externalization**

```typescript
rollupOptions: {
  external: [
    /^@libsql\//,         // All @libsql/* packages
    /^@mastra\/fastembed/,
    /^@napi-rs\//,
    /^better-sqlite3/,
    /^tree-sitter/,
    /^pino/,
  ],
}
```

### Native module dependencies

Add to `apps/electron/package.json`:

```json
{
  "dependencies": {
    "@mastra/fastembed": "^1.0.0",
    "@libsql/client": "^0.17.0",
    "pino": "^9.14.0",
    "ts-morph": "^25.0.1"
  }
}
```

---

## Phase 5: Migration Checklist

### Pre-migration

- [ ] Backup current config
- [ ] Ensure tests pass

### Phase 1: Package Builds

- [ ] Add `vite.shared.ts` in packages/
- [ ] Add `vite.config.ts` to each package
- [ ] Update exports in package.json
- [ ] Add build/dev scripts
- [ ] Test: `pnpm build:pkg`

### Phase 2: App Restructure

- [ ] Create `apps/electron/`
- [ ] Create `apps/preload/`
- [ ] Move renderer to `apps/desktop/`
- [ ] Update path references

### Phase 3: Watch Script

- [ ] Create `scripts/watch.ts`
- [ ] Update root scripts
- [ ] Test: `pnpm dev`

### Phase 4: Clean Up

- [ ] Remove `electron-vite` dependency
- [ ] Remove old `electron.vite.config.ts`
- [ ] Update CI/CD scripts

---

## Directory Structure After Migration

```
ekacode/
├── apps/
│   ├── electron/             # Main process
│   │   ├── src/index.ts
│   │   ├── vite.config.ts
│   │   └── package.json
│   ├── preload/              # Preload scripts
│   │   ├── src/index.ts
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── desktop/              # Renderer (UI)
│       ├── src/
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   ├── core/
│   │   ├── src/
│   │   ├── dist/             # Pre-built
│   │   ├── vite.config.ts
│   │   └── package.json
│   ├── server/
│   ├── shared/
│   └── zai/
├── scripts/
│   └── watch.ts              # Dev orchestration
└── package.json
```

---

## Estimated Time

| Phase                    | Duration        |
| ------------------------ | --------------- |
| Phase 1: Package Builds  | ~1-2 hours      |
| Phase 2: App Restructure | ~2-3 hours      |
| Phase 3: Watch Script    | ~1-2 hours      |
| Phase 4: Native Modules  | ~1 hour         |
| Phase 5: Testing         | ~1-2 hours      |
| **Total**                | **~6-10 hours** |

---

## Risks & Mitigations

| Risk                      | Mitigation                           |
| ------------------------- | ------------------------------------ |
| Breaking changes          | Implement in phases, test each       |
| Native module issues      | Use regex externals, test thoroughly |
| Build order problems      | Use turbo for orchestration          |
| Dev experience regression | Test HMR and restart times           |

---

## Next Steps

1. **Review this plan** - Let me know if you want changes
2. **Start Phase 1** - I can begin adding builds to packages
3. **Iterate** - We'll verify each phase works before moving on
