import tailwindcss from "@tailwindcss/vite";
import { join, resolve } from "node:path";
import solid from "vite-plugin-solid";
import { defineConfig, mergeConfig } from "vitest/config";
import shared from "./vitest.shared";

const PACKAGE_ROOT = __dirname;
const PROJECT_ROOT = join(PACKAGE_ROOT, "../..");

// Define explicit paths
const SHARED_SRC = resolve(PACKAGE_ROOT, "../../packages/shared/src");
const CORE_SRC = resolve(PACKAGE_ROOT, "../../packages/core/src");
const MEMORABLE_NAME_SRC = resolve(PACKAGE_ROOT, "../../packages/memorable-name/src/index.ts");
const DESKTOP_SRC = resolve(PACKAGE_ROOT, "src");

export default mergeConfig(
  shared,
  defineConfig({
    mode: process.env.MODE,
    root: PACKAGE_ROOT,
    base: "./",
    envDir: PROJECT_ROOT,
    resolve: {
      conditions: ["browser", "import", "default"],
      alias: [
        // App aliases
        { find: "@renderer", replacement: DESKTOP_SRC },
        { find: "/@/", replacement: DESKTOP_SRC + "/" },
        { find: "@/core/hooks", replacement: DESKTOP_SRC + "/core/chat/hooks" },
        { find: "@/core/state/contexts", replacement: DESKTOP_SRC + "/core/state/contexts" },
        { find: "@/core/state/providers", replacement: DESKTOP_SRC + "/core/state/providers" },
        { find: "@/fixtures", replacement: PACKAGE_ROOT + "/tests/fixtures" },
        { find: /^@\/state\/(.*)$/, replacement: DESKTOP_SRC + "/core/state/$1" },
        { find: /^@\/services\/(.*)$/, replacement: DESKTOP_SRC + "/core/services/$1" },
        { find: /^@\/shared\/(.*)$/, replacement: DESKTOP_SRC + "/core/shared/$1" },
        { find: /^@\/utils\/(.*)$/, replacement: DESKTOP_SRC + "/utils/$1" },
        {
          find: /^@\/infrastructure\/api\/(.*)$/,
          replacement: DESKTOP_SRC + "/core/services/api/$1",
        },
        { find: "@/routes", replacement: DESKTOP_SRC + "/routes" },
        { find: "@/components/parts", replacement: DESKTOP_SRC + "/components/parts" },
        { find: "@/", replacement: DESKTOP_SRC + "/" },

        // Workspace dependencies
        { find: "@sakti-code/shared/event-guards", replacement: SHARED_SRC + "/event-guards.ts" },
        { find: "@sakti-code/shared/event-types", replacement: SHARED_SRC + "/event-types.ts" },
        { find: "@sakti-code/shared/binary", replacement: SHARED_SRC + "/binary.ts" },
        { find: "@sakti-code/shared/persist", replacement: SHARED_SRC + "/persist.ts" },
        { find: "@sakti-code/shared/paths", replacement: SHARED_SRC + "/paths.ts" },
        { find: "@sakti-code/shared/retry", replacement: SHARED_SRC + "/retry.ts" },
        { find: "@sakti-code/shared/shutdown", replacement: SHARED_SRC + "/shutdown.ts" },
        { find: "@sakti-code/shared/logger", replacement: SHARED_SRC + "/logger/index.ts" },
        { find: "@sakti-code/shared", replacement: SHARED_SRC },
        { find: "@sakti-code/core/chat", replacement: CORE_SRC + "/chat" },
        { find: "@sakti-code/core/server", replacement: CORE_SRC + "/server" },
        { find: "@sakti-code/core/tools", replacement: CORE_SRC + "/tools" },
        { find: "@sakti-code/core", replacement: CORE_SRC },
        { find: "memorable-name", replacement: MEMORABLE_NAME_SRC },

        // Legacy aliases used by tests
        {
          find: "@renderer/presentation/providers/",
          replacement: DESKTOP_SRC + "/core/state/providers/",
        },
        {
          find: "@renderer/providers/workspace-provider",
          replacement: DESKTOP_SRC + "/core/state/providers/workspace-provider.tsx",
        },
      ],
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
      exclude: [
        "node_modules",
        "dist",
        "tests/integration/data-integrity/**/*",
        "tests/e2e/data-integrity/**/*",
        "tests/helpers/test-server.ts",
      ],
      pool: "threads",
      maxConcurrency: 1,
      fileParallelism: false,
      projects: [
        {
          extends: true,
          test: {
            name: "desktop-unit-node",
            include: ["src/**/__tests__/**/*.test.ts"],
            exclude: [
              "src/**/__tests__/**/*.test.tsx",
              "tests/integration/**/*.test.ts",
              "tests/e2e/**/*.test.ts",
            ],
            environment: "node",
          },
        },
        {
          extends: true,
          test: {
            name: "desktop-ui-jsdom",
            include: ["src/**/__tests__/**/*.test.tsx", "tests/integration/**/*.test.tsx"],
            exclude: ["tests/integration/**/*.test.ts", "tests/e2e/**/*.test.ts"],
            environment: "jsdom",
          },
        },
        {
          extends: true,
          test: {
            name: "desktop-contract",
            include: [
              "tests/e2e/**/*.test.ts",
              "tests/e2e/**/*.test.tsx",
              "tests/integration/**/*.test.ts",
              "tests/integration/**/*.test.tsx",
            ],
            environment: "jsdom",
          },
        },
      ],
    },
  })
);
