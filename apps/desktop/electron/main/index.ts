import {
  createServer,
  type SaktiServer,
} from "@sakti-code/server/create-server";
import { app, BrowserWindow } from "electron";
import { createDialogHooks } from "./ipc/dialog";
import { registerLogHandler } from "./ipc/log";
import { registerServerConfigHandler } from "./ipc/server-config";
import { registerShellHandlers } from "./ipc/shell";
import { logger } from "./lib/logger";
import { createWindow } from "./lifecycle";

let server: SaktiServer | null = null;
let shuttingDown = false;

app.on("ready", async () => {
  server = await createServer({
    port: 0,
    hostname: "127.0.0.1",
    hooks: createDialogHooks(),
  });
  logger.info("embedded server on", server.url);

  const baseUrl = server.url;
  registerServerConfigHandler(() => ({ baseUrl }));
  registerShellHandlers();
  registerLogHandler();

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
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
