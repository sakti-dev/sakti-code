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
    dedupe: ["solid-js", "@solidjs/router"],
    alias: [
      { find: "@renderer", replacement: join(PACKAGE_ROOT, "src") },
      { find: "/@/", replacement: join(PACKAGE_ROOT, "src") + "/" },
      { find: "@/presentation/hooks", replacement: join(PACKAGE_ROOT, "src/presentation/hooks") },
      {
        find: "@/presentation/contexts",
        replacement: join(PACKAGE_ROOT, "src/presentation/contexts"),
      },
      {
        find: "@/presentation/providers",
        replacement: join(PACKAGE_ROOT, "src/presentation/providers"),
      },
      { find: "@ekacode/desktop", replacement: join(PACKAGE_ROOT, "src") },
      { find: /^@ekacode\/desktop\/(.*)$/, replacement: join(PACKAGE_ROOT, "src/$1") },
    ],
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
