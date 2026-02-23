import tailwindcss from "@tailwindcss/vite";
import { join, resolve } from "node:path";
import type { UserConfig } from "vite";
import solid from "vite-plugin-solid";

const PACKAGE_ROOT = __dirname;
const PROJECT_ROOT = join(PACKAGE_ROOT, "../..");
const INCREMARK_ROOT = resolve(PACKAGE_ROOT, "../../../../incremark");
const PNPM_ROOT = resolve(PACKAGE_ROOT, "../../node_modules/.pnpm");

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
      { find: "@incremark/solid", replacement: resolve(INCREMARK_ROOT, "packages/solid/src") },
      {
        find: "@incremark/core",
        replacement: resolve(PNPM_ROOT, "@incremark+core@0.3.10/node_modules/@incremark/core"),
      },
      {
        find: "@incremark/shared",
        replacement: resolve(
          PNPM_ROOT,
          "@incremark+shared@0.3.10_@incremark+core@0.3.10/node_modules/@incremark/shared"
        ),
      },
      {
        find: "@incremark/theme/styles.css",
        replacement: resolve(
          PNPM_ROOT,
          "@incremark+theme@0.3.10/node_modules/@incremark/theme/dist/styles.css"
        ),
      },
      {
        find: "@incremark/theme",
        replacement: resolve(PNPM_ROOT, "@incremark+theme@0.3.10/node_modules/@incremark/theme"),
      },
      {
        find: "@incremark/icons",
        replacement: resolve(PNPM_ROOT, "@incremark+icons@0.3.10/node_modules/@incremark/icons"),
      },
      { find: "shiki", replacement: resolve(PNPM_ROOT, "shiki@3.22.0/node_modules/shiki") },
      {
        find: "shiki-stream",
        replacement: resolve(
          PNPM_ROOT,
          "shiki-stream@0.1.4_solid-js@1.9.11/node_modules/shiki-stream"
        ),
      },
      {
        find: "@shikijs/core",
        replacement: resolve(PNPM_ROOT, "@shikijs+core@3.22.0/node_modules/@shikijs/core"),
      },
      {
        find: "@antfu/utils",
        replacement: resolve(PNPM_ROOT, "@antfu+utils@9.3.0/node_modules/@antfu/utils"),
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
