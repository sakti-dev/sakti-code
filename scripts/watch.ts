#!/usr/bin/env node
/**
 * Development Watch Script
 *
 * Orchestrates the development build for all Electron processes:
 * 1. Starts renderer dev server (Vite with HMR)
 * 2. Builds and watches preload script
 * 3. Builds and watches main process
 * 4. Restarts Electron on main process changes
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { build, createServer } from "vite";
import { shutdown } from "../packages/shared/src/shutdown.js";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mode = process.env.MODE || "development";
process.env.MODE = mode;

let electronApp: ChildProcess | null = null;
let rendererServer: ViteDevServer | null = null;

/**
 * Start renderer dev server with HMR
 */
async function startRenderer(): Promise<ViteDevServer> {
  console.log("Starting renderer dev server...");
  const server = await createServer({
    configFile: path.resolve(__dirname, "../apps/desktop/vite.config.ts"),
    mode,
  });
  await server.listen();
  console.log(`Renderer dev server running at ${server.resolvedUrls?.local[0]}`);
  return server;
}

/**
 * Build and watch preload script
 * Triggers full reload when preload changes
 */
async function watchPreload(renderer: ViteDevServer) {
  console.log("Building and watching preload script...");
  await build({
    configFile: path.resolve(__dirname, "../apps/preload/vite.config.ts"),
    mode,
    build: { watch: {} },
    plugins: [
      {
        name: "reload-on-preload-change",
        writeBundle() {
          console.log("Preload script rebuilt - reloading renderer...");
          renderer.ws.send({ type: "full-reload" });
        },
      },
    ],
  });
  console.log("Preload script watching for changes...");
}

/**
 * Build and watch main process
 * Restarts Electron when main process changes
 */
async function watchMain(renderer: ViteDevServer) {
  process.env.ELECTRON_RENDERER_URL = renderer.resolvedUrls?.local[0] ?? "http://localhost:5173";

  console.log("Building and watching main process...");
  await build({
    configFile: path.resolve(__dirname, "../apps/electron/vite.config.ts"),
    mode,
    build: { watch: {} },
    plugins: [
      {
        name: "restart-electron",
        writeBundle() {
          // Kill existing Electron process
          if (electronApp) {
            console.log("Stopping Electron...");
            electronApp.removeListener("exit", process.exit);
            electronApp.kill("SIGINT");
            electronApp = null;
          }

          // Start new Electron process
          console.log("Starting Electron...");
          electronApp = spawn(
            "electron",
            [
              ".",
              "--ozone-platform=wayland",
              "--enable-features=UseOzonePlatform",
              "--force-device-scale-factor=1",
              "--disable-fractional-rp-pixelation",
            ],
            {
              cwd: path.resolve(__dirname, "../apps/electron"),
              stdio: "inherit",
              env: {
                ...process.env,
                // Enable Wayland on Linux
                ELECTRON_OZONE_PLATFORM_HINT: "auto",
              },
            }
          );
          electronApp.addListener("exit", process.exit);
        },
      },
    ],
  });
  console.log("Main process watching for changes...");
}

/**
 * Cleanup on exit
 */
// Register cleanup with centralized shutdown manager
shutdown.register(
  "watch-electron",
  () => {
    console.log("\nCleaning up...");
    if (electronApp) {
      electronApp.kill("SIGINT");
    }
    if (rendererServer) {
      rendererServer.close();
    }
  },
  50
); // Higher priority (run early)

/**
 * Main entry point
 */
async function main() {
  try {
    // 1. Start renderer dev server
    rendererServer = await startRenderer();

    // 2. Build and watch preload
    await watchPreload(rendererServer);

    // 3. Build and watch main (this will trigger the first Electron start)
    await watchMain(rendererServer);

    console.log("\nDevelopment environment ready!");
    console.log("- Renderer: http://localhost:5173");
    console.log("- Main: watching for changes...");
    console.log("- Preload: watching for changes...\n");
  } catch (error) {
    console.error("Failed to start development environment:", error);
    process.exit(1);
  }
}

main();
