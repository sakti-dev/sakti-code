import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@sakti-code/agent-effect": resolve(
        import.meta.dirname,
        "../../packages/agent-effect/dist/index.js"
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
