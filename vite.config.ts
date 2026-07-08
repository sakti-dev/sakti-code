import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["openspec-legacy/**", ".sakti/**"],
  },
  lint: {
    ignorePatterns: ["openspec-legacy/**", ".sakti/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "no-this-alias": "off",
    },
  },
  run: {
    cache: true,
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "openspec-legacy/**", ".sakti/**", ".direnv/**"],
  },
  staged: {
    "*": "vp check --fix",
  },
});
