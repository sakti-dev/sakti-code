/**
 * Preload Type Definitions
 *
 * TypeScript type definitions for the Ekacode API exposed to the renderer process
 */

import { ElectronAPI } from "@electron-toolkit/preload";

/**
 * Server configuration returned from main process
 */
export interface ServerConfig {
  baseUrl: string;
  token: string;
}

/**
 * Server APIs
 */
export interface ServerAPI {
  getConfig: () => Promise<ServerConfig>;
}

/**
 * Dialog APIs
 */
export interface DialogAPI {
  openDirectory: () => Promise<string | null>;
  openFile: () => Promise<string | null>;
  saveFile: (options?: { defaultPath?: string }) => Promise<string | null>;
}

/**
 * Shell APIs
 */
export interface ShellAPI {
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (fullPath: string) => Promise<void>;
}

/**
 * App APIs
 */
export interface AppAPI {
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
}

/**
 * Permission request from main process
 */
export interface PermissionRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Permission response to main process
 */
export interface PermissionResponse {
  id: string;
  approved: boolean;
}

/**
 * Permission APIs
 */
export interface PermissionAPI {
  sendResponse: (response: PermissionResponse) => void;
  onRequest: (callback: (request: PermissionRequest) => void) => () => void; // Returns unsubscribe function
}

/**
 * File system event types
 */
export type FsEventType = "add" | "change" | "unlink";

/**
 * File system event data
 */
export interface FsEvent {
  type: FsEventType;
  path: string;
}

/**
 * File System Watcher APIs (Stub for Phase 5)
 */
export interface FsWatcherAPI {
  startWatch: (workspacePath: string) => void;
  stopWatch: () => void;
  onEvent: (callback: (event: FsEvent) => void) => () => void; // Returns unsubscribe function
}

/**
 * Complete Ekacode API exposed to renderer
 */
export interface EkacodeAPI {
  /** Electron Toolkit APIs */
  electron: ElectronAPI;

  /** Server configuration */
  server: ServerAPI;

  /** File dialogs */
  dialog: DialogAPI;

  /** Shell operations */
  shell: ShellAPI;

  /** App information */
  app: AppAPI;

  /** Permission handling */
  permissions: PermissionAPI;

  /** File system watcher */
  fsWatcher: FsWatcherAPI;
}

/**
 * Extend global Window interface with Ekacode APIs
 */
declare global {
  interface Window {
    electron: ElectronAPI;
    ekacodeAPI: EkacodeAPI;
  }
}

export {};
