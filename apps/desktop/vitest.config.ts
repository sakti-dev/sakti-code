import tailwindcss from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import solid from "vite-plugin-solid";
import { defineConfig, mergeConfig } from "vitest/config";
import shared from "./vitest.shared";

const PACKAGE_ROOT = __dirname;
const PROJECT_ROOT = join(PACKAGE_ROOT, "../..");
const PNPM_ROOT_CANDIDATES = [
  resolve(PACKAGE_ROOT, "../../node_modules/.pnpm"),
  resolve(PACKAGE_ROOT, "../../../../../node_modules/.pnpm"),
];
const PNPM_ROOT = PNPM_ROOT_CANDIDATES.find(candidate => existsSync(candidate)) ?? PNPM_ROOT_CANDIDATES[0];
const resolveFirstExisting = (candidates: string[]): string =>
  candidates.find(candidate => existsSync(candidate)) ?? candidates[0];
const INCREMARK_PACKAGES_ROOT_CANDIDATES = [
  resolve(PACKAGE_ROOT, "../../third_party/incremark/packages"),
  resolve(PACKAGE_ROOT, "../../../../../third_party/incremark/packages"),
];
const INCREMARK_PACKAGES_ROOT =
  INCREMARK_PACKAGES_ROOT_CANDIDATES.find(candidate => existsSync(candidate)) ??
  INCREMARK_PACKAGES_ROOT_CANDIDATES[0];
const INCREMARK_THEME_STYLES_CANDIDATES = [
  resolve(INCREMARK_PACKAGES_ROOT, "theme/dist/styles.css"),
  resolve(PNPM_ROOT, "@incremark+theme@0.3.10/node_modules/@incremark/theme/dist/styles.css"),
];
const INCREMARK_THEME_STYLES = resolveFirstExisting(INCREMARK_THEME_STYLES_CANDIDATES);
const SHIKI_STREAM_PATH = resolveFirstExisting([
  ...PNPM_ROOT_CANDIDATES.map(root =>
    resolve(root, "shiki-stream@0.1.4_solid-js@1.9.11/node_modules/shiki-stream"),
  ),
  ...PNPM_ROOT_CANDIDATES.map(root =>
    resolve(
      root,
      "shiki-stream@0.1.4_react@19.2.4_solid-js@1.9.11_vue@3.5.29_typescript@5.9.3_/node_modules/shiki-stream",
    ),
  ),
]);
const SHIKIJS_CORE_PATH = resolveFirstExisting(
  PNPM_ROOT_CANDIDATES.map(root => resolve(root, "@shikijs+core@3.22.0/node_modules/@shikijs/core")),
);
const ANTFU_UTILS_PATH = resolveFirstExisting(
  PNPM_ROOT_CANDIDATES.map(root => resolve(root, "@antfu+utils@9.3.0/node_modules/@antfu/utils")),
);

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
        { find: "solid-js/jsx-runtime", replacement: "solid-js/h/jsx-runtime" },
        { find: "solid-js/jsx-dev-runtime", replacement: "solid-js/h/jsx-dev-runtime" },

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
        { find: "@sakti-code/memorable-name", replacement: MEMORABLE_NAME_SRC },

        // Legacy aliases used by tests
        {
          find: "@renderer/presentation/providers/",
          replacement: DESKTOP_SRC + "/core/state/providers/",
        },
        {
          find: "@renderer/providers/workspace-provider",
          replacement: DESKTOP_SRC + "/core/state/providers/workspace-provider.tsx",
        },
        {
          find: "@incremark/core/engines/micromark",
          replacement: resolve(INCREMARK_PACKAGES_ROOT, "core/src/engines/micromark/index.ts"),
        },
        {
          find: "@incremark/core",
          replacement: resolve(INCREMARK_PACKAGES_ROOT, "core/src"),
        },
        {
          find: "@incremark/solid",
          replacement: resolve(INCREMARK_PACKAGES_ROOT, "solid/src"),
        },
        {
          find: "@incremark/shared",
          replacement: resolve(INCREMARK_PACKAGES_ROOT, "shared/src"),
        },
        {
          find: "@incremark/theme/styles.css",
          replacement: INCREMARK_THEME_STYLES,
        },
        {
          find: "@incremark/theme",
          replacement: resolve(INCREMARK_PACKAGES_ROOT, "theme/src"),
        },
        {
          find: "@incremark/icons",
          replacement: resolve(INCREMARK_PACKAGES_ROOT, "icons/src"),
        },
        {
          find: "@incremark/colors",
          replacement: resolve(INCREMARK_PACKAGES_ROOT, "colors/src"),
        },
        {
          find: "shiki-stream",
          replacement: SHIKI_STREAM_PATH,
        },
        {
          find: "@shikijs/core",
          replacement: SHIKIJS_CORE_PATH,
        },
        {
          find: "@antfu/utils",
          replacement: ANTFU_UTILS_PATH,
        },
        {
          find: "ws",
          replacement: resolve(PACKAGE_ROOT, "tests/shims/ws.ts"),
        },
        {
          find: "@libsql/isomorphic-ws",
          replacement: resolve(PACKAGE_ROOT, "tests/shims/libsql-isomorphic-ws.ts"),
        },
        {
          find: /^@libsql\/client\/node$/,
          replacement: resolve(PACKAGE_ROOT, "tests/shims/libsql-client-sqlite3.ts"),
        },
        {
          find: /^@libsql\/client$/,
          replacement: resolve(PACKAGE_ROOT, "tests/shims/libsql-client-sqlite3.ts"),
        },
      ],
    },
    esbuild: {
      jsxImportSource: "solid-js",
      jsx: "automatic",
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
            server: {
              deps: {
                inline: ["@libsql/client", "ws"],
              },
            },
          },
        },
      ],
    },
  })
);
