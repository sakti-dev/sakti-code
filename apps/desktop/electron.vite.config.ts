import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "electron-vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, "electron/main/index.ts"),
        external: [
          "electron",
          // Workspace packages are consumed as pre-built dist (apps/*/dist,
          // packages/*/dist) — see dev.mjs / the `package` script, which run
          // `vp run -r build` before electron-vite. Adding a dependency inside
          // a workspace package (e.g. tools -> turndown) no longer flows into
          // this bundle; only that package's own `vp pack` build sees it.
          // Also covers @sakti-code/pi-natives (native Rust crate, no dist).
          /^@sakti-code\//,
          // @vscode/ripgrep resolves its platform binary via a dynamic
          // require.resolve('@vscode/ripgrep-<plat>-<arch>/bin/rg') at runtime;
          // bundlers can't statically resolve that, so the platform subpackages
          // must stay external and resolve from node_modules.
          /^@vscode\/ripgrep/,
          // pino's worker-thread transport (pino.transport({ target: "pino-roll" }))
          // spawns a worker that resolves "pino-roll" + its deps at runtime via
          // require.resolve — bundling inlines the code but breaks that runtime
          // resolution (silent async worker failure -> no log files written).
          // Must stay external + hoisted as direct deps of desktop.
          /^pino(?:-roll)?$/,
          // Native node bindings — can't be bundled (.node / platform binaries).
          "@ff-labs/fff-node",
        ],
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
