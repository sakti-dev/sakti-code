import { defineProject, defineWorkspace } from "vite-plus";

export default defineWorkspace([
  defineProject({
    extends: "./vitest.config.ts",
    test: {
      name: "client",
    },
  }),
  defineProject({
    extends: "./vitest.ssr.config.ts",
    mode: "ssr",
    test: {
      name: "ssr",
    },
  }),
]);
