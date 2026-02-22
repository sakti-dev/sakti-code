/**
 * IPC Handlers Module
 * Bridge between renderer and main process
 *
 * Provides:
 * - Server configuration
 * - File dialogs (open directory)
 * - Shell operations (open external)
 */

import { createLogger } from "@ekacode/shared/logger";
import { dialog, ipcMain, shell } from "electron";

const logger = createLogger("desktop:ipc");

/**
 * Allowed URL protocols for shell:openExternal
 *
 * Security: Only allow safe protocols to prevent malicious URL execution.
 * - http:, https: - Web URLs
 * - mailto: - Email links
 * - tel: - Phone numbers
 *
 * Blocked protocols include:
 * - file:, javascript:, data: - Potential security risks
 * - shell: - Could execute arbitrary commands
 */
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:", "ftp:", "sftp:"]);

/**
 * Validate URL protocol for security
 *
 * @param url - The URL to validate
 * @returns true if the URL protocol is allowed, false otherwise
 * @throws Error if the URL is malformed
 */
function validateUrlProtocol(url: string): boolean {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol;

    if (!ALLOWED_URL_PROTOCOLS.has(protocol)) {
      logger.warn("Blocked URL with disallowed protocol", {
        module: "desktop:ipc",
        url,
        protocol,
      });
      return false;
    }

    return true;
  } catch (error) {
    // URL is malformed
    logger.error("Invalid URL format", error instanceof Error ? error : undefined, {
      module: "desktop:ipc",
      url,
    });
    return false;
  }
}

/**
 * Server configuration interface
 */
export interface ServerConfig {
  port: number;
  token: string;
}

/**
 * Setup IPC handlers
 *
 * Registers all IPC handlers for communication between renderer and main process.
 *
 * @param serverConfig - Server configuration from startServer()
 */
export function setupIPCHandlers(serverConfig: ServerConfig): void {
  logger.info("Setting up IPC handlers", { module: "desktop:ipc" });

  /**
   * Get server configuration
   * Returns base URL and token for renderer to connect to the API
   */
  ipcMain.handle("get-server-config", async _event => {
    logger.debug("Server config requested", {
      module: "desktop:ipc",
      channel: "get-server-config",
    });

    return {
      baseUrl: `http://127.0.0.1:${serverConfig.port}`,
      token: serverConfig.token,
    };
  });

  /**
   * Open project directory dialog
   * Allows user to select a project directory
   */
  ipcMain.handle("dialog:openDirectory", async () => {
    logger.debug("Open directory dialog requested", {
      module: "desktop:ipc",
      channel: "dialog:openDirectory",
    });

    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Project Directory",
    });

    if (result.canceled || result.filePaths.length === 0) {
      logger.debug("Directory dialog canceled", {
        module: "desktop:ipc",
        channel: "dialog:openDirectory",
      });
      return null;
    }

    const selectedPath = result.filePaths[0];
    logger.debug("Directory selected", {
      module: "desktop:ipc",
      channel: "dialog:openDirectory",
      path: selectedPath,
    });

    return selectedPath;
  });

  /**
   * Open external URL
   * Opens a URL in the system's default browser
   *
   * Security: Validates URL protocol before opening to prevent
   * malicious URL execution. Only allows safe protocols.
   */
  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    logger.debug("Open external URL requested", {
      module: "desktop:ipc",
      channel: "shell:openExternal",
      url,
    });

    // Validate URL protocol for security
    if (!validateUrlProtocol(url)) {
      const error = new Error(
        `URL protocol not allowed or URL is malformed. ` +
          `Allowed protocols: ${Array.from(ALLOWED_URL_PROTOCOLS).join(", ")}`
      );
      logger.error("URL validation failed", error, {
        module: "desktop:ipc",
        url,
      });
      throw error;
    }

    await shell.openExternal(url);

    logger.debug("External URL opened", {
      module: "desktop:ipc",
      channel: "shell:openExternal",
      url,
    });
  });

  logger.info("IPC handlers registered", { module: "desktop:ipc" });
}
