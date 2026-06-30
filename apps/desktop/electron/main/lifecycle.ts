import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { BrowserWindow, shell } from "electron";

import { logger } from "./lib/logger";
import { debouncedSaveWindowState, flushWindowState, loadWindowState } from "./lib/window-state";

// electron-vite emits preload at out/preload/index.cjs (CJS — sandbox can't run ESM); main runs at out/main/
const PRELOAD_PATH = join(import.meta.dirname, "../preload/index.cjs");

export function createWindow(serverUrl: string): BrowserWindow {
  const frame = loadWindowState();
  const win = new BrowserWindow({
    width: frame.width,
    height: frame.height,
    x: frame.x,
    y: frame.y,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const saveFrame = () => debouncedSaveWindowState(win.getBounds());
  win.on("resize", saveFrame);
  win.on("move", saveFrame);
  win.on("close", () => flushWindowState(win.getBounds()));

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
    win.loadURL(serverUrl);
  }

  return win;
}
