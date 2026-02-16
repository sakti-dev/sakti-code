import { join } from "path";
import copy from "rollup-plugin-copy";
import type { UserConfig } from "vite";

const PACKAGE_ROOT = __dirname;

const config: UserConfig = {
  mode: process.env.MODE,
  root: PACKAGE_ROOT,
  envDir: process.cwd(),
  resolve: {
    alias: {
      "/@/": `${join(PACKAGE_ROOT, "src")}/`,
    },
  },
  build: {
    ssr: true,
    sourcemap: process.env.MODE === "development",
    target: "node20",
    outDir: "dist",
    lib: {
      entry: {
        index: join(PACKAGE_ROOT, "src/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      plugins: [
        copy({
          targets: [
            {
              src: join(PACKAGE_ROOT, "../../packages/server/drizzle/*"),
              dest: join(PACKAGE_ROOT, "dist/drizzle"),
            },
          ],
          hook: "writeBundle",
        }),
      ],
      // External only truly native modules + Electron
      external: [
        "electron",
        // Native modules with .node bindings
        "better-sqlite3",
        "tree-sitter",
        "tree-sitter-bash",
        /^@libsql\/.*/, // Platform-specific bindings
        /^@anush008\/tokenizers.*/, // Tokenizer native bindings
        /^@napi-rs\/tokenizers/, // Tokenizer package
        "@mastra/fastembed", // Contains native tokenizers
        // Pure JS modules that use require() (incompatible with ESM top-level await)
        "pino",
        "pino-pretty",
        "ts-morph",
        "typescript",
      ],
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
      },
    },
    emptyOutDir: true,
  },
};

export default config;
