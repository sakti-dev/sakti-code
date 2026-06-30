import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  run: {
    tasks: {
      dev: {
        command: "node scripts/dev.mjs",
        cache: false,
      },
    },
  },
});
