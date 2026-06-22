import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { BrowserWindow, shell } from "electron";

import { logger } from "./lib/logger";

// electron-vite emits preload at out/preload/index.mjs (ESM project); main runs at out/main/
const PRELOAD_PATH = join(import.meta.dirname, "../preload/index.mjs");
const PROD_INDEX = join(import.meta.dirname, "../renderer/index.html");

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.on("ready-to-show", () => win.show());

  // forward renderer console to main stdout (observability for the smoke + dev)
  win.webContents.on("console-message", (_event, _level, message) => {
    logger.info(`[renderer] ${message}`);
  });

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(PROD_INDEX);
  }

  return win;
}
