import { PermissionManager } from "@ekacode/ekacode";
import { createLogger } from "@ekacode/logger";
import { startServer } from "@ekacode/server";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";

const logger = createLogger("desktop");

let mainWindow: BrowserWindow | null = null;
let serverConfig: { port: number; token: string } | null = null;

function createWindow(): void {
  logger.info("Creating main window", { module: "desktop:lifecycle" });

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    logger.info("Window ready to show", { module: "desktop:lifecycle" });
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(details => {
    logger.debug("External link requested", {
      module: "desktop:lifecycle",
      url: details.url,
    });
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools();
    logger.debug("Loaded dev renderer URL", {
      module: "desktop:lifecycle",
      url: process.env["ELECTRON_RENDERER_URL"],
    });
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
    logger.debug("Loaded production renderer", {
      module: "desktop:lifecycle",
    });
  }
}

app.whenReady().then(async () => {
  logger.info("Application ready", { module: "desktop:lifecycle" });

  electronApp.setAppUserModelId("com.ekacode.app");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
    logger.debug("Browser window created", {
      module: "desktop:lifecycle",
    });
  });

  // Initialize ekacode server
  try {
    logger.info("Starting ekacode server", { module: "desktop:server" });
    const server = await startServer();
    serverConfig = { port: server.port, token: server.token };
    logger.info(`Server started on port ${server.port}`, {
      module: "desktop:server",
      port: server.port,
    });
  } catch (error) {
    logger.error("Failed to start server", error instanceof Error ? error : undefined, {
      module: "desktop:server",
    });
  }

  // IPC handlers

  // Get server configuration for renderer
  ipcMain.handle("get-server-config", async _event => {
    logger.debug("Server config requested", {
      module: "desktop:ipc",
      channel: "get-server-config",
    });

    if (!serverConfig) {
      logger.warn("Server config requested but not initialized", {
        module: "desktop:ipc",
        channel: "get-server-config",
      });
      throw new Error("Server not initialized");
    }

    return {
      baseUrl: `http://127.0.0.1:${serverConfig.port}`,
      token: serverConfig.token,
    };
  });

  // Permission responses from renderer
  ipcMain.on("permission:response", (_event, response) => {
    logger.debug("Permission response received", {
      module: "desktop:ipc",
      channel: "permission:response",
      id: response.id,
      approved: response.approved,
    });

    const permissionMgr = PermissionManager.getInstance();
    permissionMgr.handleResponse(response);
  });

  // File watcher stubs (Phase 5)
  ipcMain.on("fs:watch-start", (_event, workspacePath) => {
    logger.info("File watch requested", {
      module: "desktop:ipc",
      channel: "fs:watch-start",
      workspacePath,
    });
    // TODO: Implement chokidar watch in Phase 5
  });

  ipcMain.on("fs:watch-stop", _event => {
    logger.info("File watch stop requested", {
      module: "desktop:ipc",
      channel: "fs:watch-stop",
    });
    // TODO: Implement chokidar stop in Phase 5
  });

  // Legacy ping handler
  ipcMain.on("ping", () => {
    logger.debug("Ping received", { module: "desktop:ipc", channel: "ping" });
  });

  createWindow();

  app.on("activate", function () {
    logger.debug("Activate event", { module: "desktop:lifecycle" });
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  logger.info("All windows closed", { module: "desktop:lifecycle" });
  if (process.platform !== "darwin") {
    logger.info("Quitting application", { module: "desktop:lifecycle" });
    app.quit();
  }
});
