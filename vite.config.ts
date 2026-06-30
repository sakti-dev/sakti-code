import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["openspec/**"],
  },
  lint: {
    ignorePatterns: ["openspec/**"],
    options: {
      typeAware: true,
      typeCheck: false,
    },
    rules: {
      "no-this-alias": "off",
    },
  },
  run: {
    cache: true,
  },
  staged: {
    "*": "vp check --fix",
  },
});
