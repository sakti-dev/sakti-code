import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, "electron/main/index.ts"),
      },
    },
  },
  preload: {
    build: {
      // sandbox preloads can't use ESM `import` — emit CJS, and bundle everything
      // (only `electron` stays external; sandboxed require() allows it)
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(import.meta.dirname, "electron/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src"),
    resolve: { alias: { "~": resolve(import.meta.dirname, "src") } },
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, "src/index.html") },
    },
  },
});
