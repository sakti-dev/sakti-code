import tailwindcss from "@tailwindcss/vite";
import { join, resolve } from "node:path";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

const PACKAGE_ROOT = __dirname;
const PROJECT_ROOT = join(PACKAGE_ROOT, "../..");

// Define explicit paths
const SHARED_SRC = resolve(PACKAGE_ROOT, "../../packages/shared/src");
const CORE_SRC = resolve(PACKAGE_ROOT, "../../packages/core/src");
const DESKTOP_SRC = resolve(PACKAGE_ROOT, "src");

export default defineConfig({
  mode: process.env.MODE,
  root: PACKAGE_ROOT,
  base: "./",
  envDir: PROJECT_ROOT,
  resolve: {
    alias: {
      // From original vite.config.ts
      "@renderer": join(PACKAGE_ROOT, "src"),
      "/@/": join(PACKAGE_ROOT, "src") + "/",

      // Workspace dependencies
      "@ekacode/shared": SHARED_SRC,
      "@ekacode/shared/event-guards": SHARED_SRC + "/event-guards.ts",
      "@ekacode/shared/event-types": SHARED_SRC + "/event-types.ts",
      "@ekacode/shared/binary": SHARED_SRC + "/binary.ts",
      "@ekacode/shared/persist": SHARED_SRC + "/persist.ts",
      "@ekacode/shared/paths": SHARED_SRC + "/paths.ts",
      "@ekacode/shared/retry": SHARED_SRC + "/retry.ts",
      "@ekacode/shared/shutdown": SHARED_SRC + "/shutdown.ts",
      "@ekacode/shared/logger": SHARED_SRC + "/logger/index.ts",

      "@ekacode/core": CORE_SRC,
      "@ekacode/core/chat": CORE_SRC + "/chat",
      "@ekacode/core/server": CORE_SRC + "/server",
      "@ekacode/core/tools": CORE_SRC + "/tools",
      "@/utils": DESKTOP_SRC + "/utils",
      "@/shared": DESKTOP_SRC + "/core/shared",
      "@/shared/": DESKTOP_SRC + "/core/shared/",
      "@/infrastructure/api": DESKTOP_SRC + "/core/services/api",
      "@/infrastructure/api/": DESKTOP_SRC + "/core/services/api/",

      "@renderer/presentation/providers/": DESKTOP_SRC + "/core/state/providers/",
      "@renderer/providers/workspace-provider":
        DESKTOP_SRC + "/core/state/providers/workspace-provider.tsx",

      "@/components": DESKTOP_SRC + "/components",
      "@/core": DESKTOP_SRC + "/core",
      "@/core/*": DESKTOP_SRC + "/core/*",
      "@/state": DESKTOP_SRC + "/core/state",
      "@/state/*": DESKTOP_SRC + "/core/state/*",
      "@/views": DESKTOP_SRC + "/views",
      "@/views/*": DESKTOP_SRC + "/views/*",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: process.env.MODE === "development",
    rollupOptions: {
      input: join(PACKAGE_ROOT, "index.html"),
    },
  },
  plugins: [solid(), tailwindcss()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: [
      "node_modules",
      "dist",
      "tests/e2e/**/*",
      "tests/integration/data-integrity/**/*",
      "tests/helpers/test-server.ts",
    ],
    pool: "threads",
    maxConcurrency: 1,
    fileParallelism: false,
    server: {
      deps: {
        inline: [
          "@solidjs/router",
          "@kobalte/core",
          "@kobalte/core/collapsible",
          "solid-presence",
          "@corvu/utils",
          "@corvu/resizable",
        ],
      },
    },
  },
});
