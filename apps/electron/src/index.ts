/**
 * Electron Main Process
 *
 * Entry point for the Ekacode desktop application.
 * Manages the main window, server initialization, and IPC handlers.
 */

import { startServer } from "@ekacode/server";
import { createLogger } from "@ekacode/shared/logger";
import { shutdown } from "@ekacode/shared/shutdown";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Import IPC handlers module
import { setupIPCHandlers } from "./ipc";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = createLogger("desktop");

let mainWindow: BrowserWindow | null = null;
let serverConfig: { port: number; token: string } | null = null;
let isShuttingDown = false;

/**
 * Create the main application window
 */
function createWindow(): void {
  logger.info("Creating main window", { module: "desktop:lifecycle" });

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../../preload/dist/index.cjs"),
      sandbox: true,
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

  // Load renderer
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools();
    logger.debug("Loaded dev renderer URL", {
      module: "desktop:lifecycle",
      url: process.env["ELECTRON_RENDERER_URL"],
    });
  } else {
    mainWindow.loadFile(join(__dirname, "../../desktop/index.html"));
    logger.debug("Loaded production renderer", {
      module: "desktop:lifecycle",
    });
  }
}

/**
 * Initialize the ekacode server
 */
async function initServer(): Promise<void> {
  logger.info("Starting ekacode server", { module: "desktop:server" });

  try {
    const server = await startServer();
    serverConfig = { port: server.port, token: server.token };

    // Register cleanup with centralized shutdown manager
    shutdown.register(
      "electron-server",
      async () => {
        // Server will be cleaned up by @ekacode/server shutdown
        logger.info("Electron server shutdown complete", { module: "desktop:lifecycle" });
      },
      20
    );

    logger.info(`Server started on port ${server.port}`, {
      module: "desktop:server",
      port: server.port,
    });
  } catch (error) {
    logger.error("Failed to start server", error instanceof Error ? error : undefined, {
      module: "desktop:server",
    });
    throw error;
  }
}

/**
 * Application ready handler
 */
app.whenReady().then(async () => {
  logger.info("Application ready", { module: "desktop:lifecycle" });

  // Set app user model ID for Windows
  electronApp.setAppUserModelId("com.ekacode.app");

  // Watch for keyboard shortcuts
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
    logger.debug("Browser window created", {
      module: "desktop:lifecycle",
    });
  });

  // Initialize server
  await initServer();

  // Setup IPC handlers with server config
  if (serverConfig) {
    setupIPCHandlers(serverConfig);
  }

  // Create main window
  createWindow();

  // Handle activation (macOS)
  app.on("activate", function () {
    logger.debug("Activate event", { module: "desktop:lifecycle" });
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * All windows closed handler
 */
app.on("window-all-closed", () => {
  logger.info("All windows closed", { module: "desktop:lifecycle" });
  if (process.platform !== "darwin") {
    logger.info("Quitting application", { module: "desktop:lifecycle" });
    app.quit();
  }
});

/**
 * Before quit handler
 */
app.on("before-quit", async event => {
  if (!isShuttingDown) {
    event.preventDefault();
    isShuttingDown = true;
    logger.info("Application quitting gracefully", { module: "desktop:lifecycle" });
    await shutdown.shutdown();
    app.quit();
  }
});
