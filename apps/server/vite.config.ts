import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  pack: {
    entry: {
      app: "src/app.ts",
      "create-server": "src/create-server.ts",
      dirs: "src/lib/config-dirs.ts",
      ws: "src/agent/ws-handler.ts",
    },
    dts: true,
  },
});
