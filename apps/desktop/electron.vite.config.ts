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
      // sandbox preload cannot require() npm deps — bundle everything (only `electron` stays external)
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(import.meta.dirname, "electron/preload/index.ts"),
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
