import { resolve } from "node:path";
import { createServer, type SaktiServer } from "@sakti-code/server/create-server";
import { getLogDir } from "@sakti-code/server/dirs";
import { app, BrowserWindow, screen } from "electron";
import { createDialogHooks } from "./ipc/dialog";
import { registerLogHandler } from "./ipc/log";
import { registerServerConfigHandler } from "./ipc/server-config";
import { registerShellHandlers } from "./ipc/shell";
import { createDesktopLogger, logger } from "./lib/logger";
import { createWindow } from "./lifecycle";

if (process.platform === "linux") {
  // Packaged fallback: prefer native Wayland when available (X11 otherwise).
  // In dev, scripts/dev.mjs passes --ozone-platform=wayland as a real CLI arg —
  // this appendSwitch runs after Chromium picks the platform, so it can't force
  // Wayland here; it only helps packaged builds via the hint.
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
  app.commandLine.appendSwitch("enable-features", "WaylandFractionalScaleV1");
}

let server: SaktiServer | null = null;
let shuttingDown = false;

app.on("ready", async () => {
  const isDev = !app.isPackaged;
  server = await createServer({
    port: isDev ? 3001 : 0,
    hostname: "127.0.0.1",
    staticDir: isDev ? null : resolve(import.meta.dirname, "../renderer"),
    migrationsFolder: isDev
      ? resolve(import.meta.dirname, "../../../../packages/db/migrations")
      : resolve(import.meta.dirname, "../migrations"),
    hooks: createDialogHooks(),
  });
  logger.info("embedded server on", server.url);

  const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
  logger.info(`display scale factor: ${scaleFactor}`);

  const baseUrl = server.url;
  registerServerConfigHandler(() => ({ baseUrl }));
  registerShellHandlers();
  registerLogHandler(createDesktopLogger(getLogDir()));

  createWindow(server.url);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && server) {
    createWindow(server.url);
  }
});

app.on("before-quit", async (event) => {
  if (server && !shuttingDown) {
    event.preventDefault();
    shuttingDown = true;
    await server.stop();
    server = null;
    app.quit();
  }
});
