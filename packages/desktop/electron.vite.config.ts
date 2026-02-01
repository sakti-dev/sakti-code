import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
import solid from "vite-plugin-solid";

// Internal workspace packages that should be bundled, not externalized.
// These export raw .ts files which Node ESM cannot resolve at runtime.
const internalPackages = ["@ekacode/core", "@ekacode/server", "@ekacode/shared", "@ekacode/zai"];

// Native module packages that MUST be externalized via rollupOptions.external
// These are transitive dependencies of bundled workspace packages
// and use require() for .node bindings which conflicts with top-level await
const nativeModules = [
  "@libsql/client",
  "@libsql/linux-x64-gnu", // libsql platform-specific bindings
  "@mastra/fastembed",
  "@napi-rs/tokenizers",
  "better-sqlite3",
  "pino",
  "pino-pretty",
  "tree-sitter",
  "tree-sitter-bash",
  "ts-morph",
  "typescript",
];

export default defineConfig({
  main: {
    build: {
      target: "node20", // Support top-level await
      // Use new externalizeDeps config instead of deprecated plugin
      externalizeDeps: {
        exclude: internalPackages,
      },
      rollupOptions: {
        // Explicitly externalize native modules (transitive deps of bundled packages)
        external: nativeModules,
        output: {
          format: "es",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: internalPackages,
      },
      rollupOptions: {
        output: {
          format: "es",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [solid(), tailwindcss()],
  },
});
