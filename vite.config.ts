import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["openspec/**"],
  },
  lint: {
    ignorePatterns: ["openspec/**"],
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
    exclude: ["**/node_modules/**", "**/dist/**", "openspec/**", ".direnv/**"],
  },
  staged: {
    "*": "vp check --fix",
  },
});
