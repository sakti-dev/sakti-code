import tailwindcss from "@tailwindcss/vite";
import { join } from "node:path";
import type { UserConfig } from "vite";
import solid from "vite-plugin-solid";

const PACKAGE_ROOT = __dirname;
const PROJECT_ROOT = join(PACKAGE_ROOT, "../..");

const config: UserConfig = {
  mode: process.env.MODE,
  root: PACKAGE_ROOT,
  base: "./", // Use relative paths for Electron file:// protocol
  envDir: PROJECT_ROOT,
  resolve: {
    alias: {
      "@renderer": join(PACKAGE_ROOT, "src"),
      "/@/": join(PACKAGE_ROOT, "src") + "/",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: process.env.MODE === "development",
    rollupOptions: {
      input: join(PACKAGE_ROOT, "index.html"),
    },
  },
  plugins: [solid(), tailwindcss()],
};

export default config;
