import { defineConfig } from "tsup";
import { sharedConfig } from "../../tsup.config";

export default defineConfig({
  ...sharedConfig,
  entry: ["src/index.ts"],
  noExternal: [/^~\//],
});
