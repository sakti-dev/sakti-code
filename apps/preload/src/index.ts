/**
 * Preload Script
 * Exposes safe IPC API to renderer process
 *
 * This script runs in the renderer's context but has access to Node.js APIs
 * through Electron's preload mechanism. It exposes a safe, typed API to the
 * renderer via contextBridge.
 */

import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer } from "electron";

// Simple console-based logger for preload (sandbox-safe, no external dependencies)
// Logs are prefixed and sent to main process via IPC when available
const logger = {
  debug: (...args: unknown[]) => {
    console.debug("[desktop:preload]", ...args);
  },
  info: (...args: unknown[]) => {
    console.info("[desktop:preload]", ...args);
  },
  warn: (...args: unknown[]) => {
    console.warn("[desktop:preload]", ...args);
  },
  error: (...args: unknown[]) => {
    console.error("[desktop:preload]", ...args);
  },
};

/**
 * Send log message to main process via IPC
 */
function sendLog(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>
) {
  try {
    ipcRenderer.send("log:message", {
      level,
      message,
      context: { package: "desktop:renderer", ...context },
      timestamp: new Date().toISOString(),
    });
  } catch {
    // IPC might not be ready, fall back to console
  }
}

/**
 * Create a logger for the renderer process
 */
function createRendererLogger(packageName: string, baseContext: Record<string, unknown> = {}) {
  const prefix = `[${packageName}]`;

  return {
    debug: (msg: string, context?: Record<string, unknown>) => {
      console.debug(prefix, msg);
      sendLog("debug", `${prefix} ${msg}`, { ...baseContext, ...context });
    },
    info: (msg: string, context?: Record<string, unknown>) => {
      console.info(prefix, msg);
      sendLog("info", `${prefix} ${msg}`, { ...baseContext, ...context });
    },
    warn: (msg: string, context?: Record<string, unknown>) => {
      console.warn(prefix, msg);
      sendLog("warn", `${prefix} ${msg}`, { ...baseContext, ...context });
    },
    error: (msg: string, err?: Error, context?: Record<string, unknown>) => {
      console.error(prefix, msg, err);
      sendLog("error", `${prefix} ${msg}`, { ...baseContext, ...context, error: err?.message });
    },
  };
}

/**
 * Ekacode API exposed to renderer process
 *
 * Provides:
 * - Server configuration
 * - File dialogs (open directory)
 * - Shell operations (open external)
 */
const ekacodeAPI = {
  // ============================================================
  // Electron Toolkit APIs
  // ============================================================
  electron: electronAPI,

  // ============================================================
  // Logger API (for renderer process)
  // ============================================================
  logger: {
    /**
     * Create a logger instance for the renderer
     * @param packageName - Package name for the logger (e.g., 'desktop:renderer')
     * @returns Logger instance with debug, info, warn, error methods
     */
    create: (packageName: string) => createRendererLogger(packageName),
  },

  // ============================================================
  // Server APIs
  // ============================================================
  server: {
    /**
     * Get server configuration for connecting to the local API
     * @returns Promise resolving to { baseUrl: string, token: string }
     */
    getConfig: () => ipcRenderer.invoke("get-server-config"),
  },

  // ============================================================
  // Dialog APIs
  // ============================================================
  dialog: {
    /**
     * Open directory picker dialog
     * @returns Promise resolving to selected directory path or null if canceled
     */
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  },

  // ============================================================
  // Shell APIs
  // ============================================================
  shell: {
    /**
     * Open URL in system's default browser
     * @param url - The URL to open
     */
    openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  },
};

// Use `contextBridge` APIs to expose APIs to renderer
// This ensures the renderer cannot access Node.js APIs directly
if (process.contextIsolated) {
  try {
    // Expose Electron Toolkit APIs
    contextBridge.exposeInMainWorld("electron", electronAPI);

    // Expose Ekacode APIs
    contextBridge.exposeInMainWorld("ekacodeAPI", ekacodeAPI);
  } catch (error) {
    logger.error("Failed to expose APIs to renderer", error);
  }
} else {
  // Fallback for when context isolation is disabled (not recommended)
  logger.warn(
    "Context isolation is disabled. This is not secure and should only be used for development."
  );
  window.electron = electronAPI;
  window.ekacodeAPI = ekacodeAPI;
}

// Type definitions for TypeScript
export type EkacodeAPI = typeof ekacodeAPI;

// Extend Window interface for TypeScript
declare global {
  interface Window {
    electron: typeof electronAPI;
    ekacodeAPI: EkacodeAPI;
  }
}
