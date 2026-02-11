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

      "@ekacode/desktop": DESKTOP_SRC,
      "@ekacode/desktop/utils": DESKTOP_SRC + "/utils",
      "@/utils": DESKTOP_SRC + "/utils",

      // Phase 1: Core layer
      "@ekacode/desktop/core": DESKTOP_SRC + "/core",
      "@ekacode/desktop/core/stores": DESKTOP_SRC + "/core/stores",
      "@ekacode/desktop/core/domain": DESKTOP_SRC + "/core/domain",

      // Phase 1: Infrastructure layer
      "@ekacode/desktop/infrastructure": DESKTOP_SRC + "/infrastructure",
      "@ekacode/desktop/infrastructure/events": DESKTOP_SRC + "/infrastructure/events",
      "@ekacode/desktop/infrastructure/api": DESKTOP_SRC + "/infrastructure/api",

      // Phase 1: Presentation layer
      "@ekacode/desktop/presentation": DESKTOP_SRC + "/presentation",
      "@ekacode/desktop/presentation/state": DESKTOP_SRC + "/presentation/state",

      // Phase 2: Services
      "@ekacode/desktop/core/services": DESKTOP_SRC + "/core/services",
      "@/infrastructure/api": DESKTOP_SRC + "/infrastructure/api",
      "@/components": DESKTOP_SRC + "/components",

      // Phase 3: Domain event handlers
      "@ekacode/desktop/core/domain/message": DESKTOP_SRC + "/core/domain/message",
      "@ekacode/desktop/core/domain/part": DESKTOP_SRC + "/core/domain/part",
      "@ekacode/desktop/core/domain/session": DESKTOP_SRC + "/core/domain/session",
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
    exclude: ["node_modules", "dist", "tests/e2e/**/*", "tests/integration/**/*"],
    pool: "threads",
    maxConcurrency: 1,
    fileParallelism: false,
  },
});
