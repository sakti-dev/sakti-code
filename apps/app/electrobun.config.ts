import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "sakti-code",
    identifier: "dev.sakti-code.app",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/lib/bun/index.ts",
    },
    copy: {
      "../app/dist": "web-dist",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    win: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
