import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test/setup.ts", "./tests/vitest.setup.ts"],
    deps: {
      optimizer: {
        web: {
          include: [
            "solid-js",
            "solid-js/web",
            "@solidjs/router",
            "@kobalte/core",
            "solid-presence",
            "lucide-solid",
          ],
        },
      },
    },
    server: {
      deps: {
        inline: [
          "@solidjs/router",
          "@kobalte/core",
          "@kobalte/core/collapsible",
          "@kobalte/core/dialog",
          "@kobalte/core/separator",
          "@corvu/utils",
          "@corvu/resizable",
          "solid-presence",
          "solid-prevent-scroll",
          "lucide-solid",
        ],
      },
    },
  },
  ssr: {
    noExternal: [/^@kobalte\/core/, "solid-presence", "lucide-solid"],
  },
});
