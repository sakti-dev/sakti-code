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
            "@incremark/solid",
            "@incremark/core",
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
          "@libsql/client",
          "@libsql/hrana-client",
          "@libsql/isomorphic-ws",
          "ws",
          "@incremark/solid",
          "@incremark/core",
          "@incremark/theme",
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
    noExternal: [
      /^@kobalte\/core/,
      /^@incremark\//,
      /^@libsql\//,
      /^ws$/,
      "solid-presence",
      "lucide-solid",
    ],
  },
});
