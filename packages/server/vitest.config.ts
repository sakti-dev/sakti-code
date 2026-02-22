/**
 * Vitest configuration for @sakti-code/server
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./tests/vitest.setup.ts"],
    pool: "threads",
    maxConcurrency: 1,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.ts", "**/*.spec.ts", "**/types/"],
    },
    exclude: ["node_modules", "dist"],
  },
});
