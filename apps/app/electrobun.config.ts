import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "sakti-code",
    identifier: "dev.sakti-code.app",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "../app/dist": "web-dist",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
