import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, "electron/main/index.ts"),
        external: ["electron", "@sakti-code/pi-natives", "@ff-labs/fff-node"],
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
    resolve: {
      alias: {
        "~": resolve(import.meta.dirname, "src"),
        // Solid JSX runtime must resolve to the non-dev build for HMR correctness
        "solid-js/jsx-runtime": "solid-js/h/jsx-runtime",
        "solid-js/jsx-dev-runtime": "solid-js/h/jsx-dev-runtime",
      },
    },
    plugins: [solid(), tailwindcss()],
    server: {
      // dev: the embedded server runs on fixed 3001; proxy so window.location.origin works
      proxy: {
        "/api": "http://localhost:3001",
        "/ws": { target: "ws://localhost:3001", ws: true },
      },
    },
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, "src/index.html") },
    },
  },
});
