import { defineConfig } from "tsup";
import { sharedConfig } from "../../tsup.config";

export default defineConfig({
  ...sharedConfig,
  entry: {
    app: "src/app.ts",
    "create-server": "src/create-server.ts",
    dirs: "src/lib/config-dirs.ts",
    ws: "src/agent/ws-handler.ts",
  },
});
