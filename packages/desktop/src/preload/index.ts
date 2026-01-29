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

/**
 * Ekacode API exposed to renderer process
 *
 * Provides:
 * - Server configuration
 * - File dialogs (open directory, open file, save file)
 * - Shell operations (open external, show in folder)
 * - App information (version, platform)
 * - Permission events (request, response)
 * - File watcher events (start, stop)
 */
const ekacodeAPI = {
  // ============================================================
  // Electron Toolkit APIs
  // ============================================================
  electron: electronAPI,

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

    /**
     * Open file picker dialog
     * @returns Promise resolving to selected file path or null if canceled
     */
    openFile: () => ipcRenderer.invoke("dialog:openFile"),

    /**
     * Open save file dialog
     * @param options - Optional default path
     * @returns Promise resolving to selected file path or null if canceled
     */
    saveFile: (options?: { defaultPath?: string }) =>
      ipcRenderer.invoke("dialog:saveFile", options),
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

    /**
     * Show file in system's file manager
     * @param fullPath - The full path to the file
     */
    showItemInFolder: (fullPath: string) => ipcRenderer.invoke("shell:showItemInFolder", fullPath),
  },

  // ============================================================
  // App APIs
  // ============================================================
  app: {
    /**
     * Get the application version
     * @returns Promise resolving to version string
     */
    getVersion: () => ipcRenderer.invoke("app:getVersion"),

    /**
     * Get the current platform (darwin, linux, win32)
     * @returns Promise resolving to platform string
     */
    getPlatform: () => ipcRenderer.invoke("app:getPlatform"),
  },

  // ============================================================
  // Permission APIs
  // ============================================================
  permissions: {
    /**
     * Send permission response to main process
     * @param response - Permission response with id and approval status
     */
    sendResponse: (response: { id: string; approved: boolean }) =>
      ipcRenderer.send("permission:response", response),

    /**
     * Listen for permission requests from main process
     * @param callback - Function to call when permission is requested
     * @returns Unsubscribe function
     */
    onRequest: (
      callback: (request: { id: string; toolName: string; args: Record<string, unknown> }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        request: {
          id: string;
          toolName: string;
          args: Record<string, unknown>;
        }
      ) => callback(request);

      ipcRenderer.on("permission:request", listener);

      return () => {
        ipcRenderer.removeListener("permission:request", listener);
      };
    },
  },

  // ============================================================
  // File System Watcher APIs (Stub for Phase 5)
  // ============================================================
  fsWatcher: {
    /**
     * Request to start watching a directory for changes
     * @param workspacePath - Path to the workspace directory
     */
    startWatch: (workspacePath: string) => ipcRenderer.send("fs:watch-start", workspacePath),

    /**
     * Request to stop watching for changes
     */
    stopWatch: () => ipcRenderer.send("fs:watch-stop"),

    /**
     * Listen for file system events
     * @param callback - Function to call when file system changes occur
     * @returns Unsubscribe function
     */
    onEvent: (callback: (event: { type: "add" | "change" | "unlink"; path: string }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          type: "add" | "change" | "unlink";
          path: string;
        }
      ) => callback(data);

      ipcRenderer.on("fs:event", listener);

      return () => {
        ipcRenderer.removeListener("fs:event", listener);
      };
    },
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
    console.error("Failed to expose APIs to renderer:", error);
  }
} else {
  // Fallback for when context isolation is disabled (not recommended)
  console.warn(
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
