import tailwindcss from "@tailwindcss/vite";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { UserConfig } from "vite";
import solid from "vite-plugin-solid";

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

const config: UserConfig = {
  mode: process.env.MODE,
  root: PACKAGE_ROOT,
  base: "./", // Use relative paths for Electron file:// protocol
  envDir: PROJECT_ROOT,
  resolve: {
    dedupe: ["solid-js", "@solidjs/router"],
    alias: [
      { find: "@renderer", replacement: join(PACKAGE_ROOT, "src") },
      { find: "/@/", replacement: join(PACKAGE_ROOT, "src") + "/" },
      { find: "@/core/hooks", replacement: join(PACKAGE_ROOT, "src/core/chat/hooks") },
      { find: "@/core/state/contexts", replacement: join(PACKAGE_ROOT, "src/core/state/contexts") },
      {
        find: "@/core/state/providers",
        replacement: join(PACKAGE_ROOT, "src/core/state/providers"),
      },
      { find: /^@\/state\/(.*)$/, replacement: join(PACKAGE_ROOT, "src/core/state/$1") },
      { find: /^@\/services\/(.*)$/, replacement: join(PACKAGE_ROOT, "src/core/services/$1") },
      { find: /^@\/shared\/(.*)$/, replacement: join(PACKAGE_ROOT, "src/core/shared/$1") },
      { find: "@/routes", replacement: join(PACKAGE_ROOT, "src/routes") },
      { find: "@/components/parts", replacement: join(PACKAGE_ROOT, "src/components/parts") },
      { find: "@/", replacement: join(PACKAGE_ROOT, "src") + "/" },
      { find: "solid-js/jsx-runtime", replacement: "solid-js/h/jsx-runtime" },
      { find: "solid-js/jsx-dev-runtime", replacement: "solid-js/h/jsx-dev-runtime" },
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
};

export default config;
