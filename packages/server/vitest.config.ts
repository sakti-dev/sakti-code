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
    include: [
      "src/**/__tests__/**/*.test.ts",
      "db/__tests__/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.ts", "**/*.spec.ts", "**/types/"],
    },
    exclude: ["node_modules", "dist"],
  },
});
