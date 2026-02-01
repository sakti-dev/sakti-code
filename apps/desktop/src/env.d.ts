/// <reference types="vite/client" />

declare module "*.svg" {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    electron: {
      // Add electron-toolkit types if needed
      ipcRenderer?: {
        send: (channel: string, ...args: unknown[]) => void;
      };
    };
    ekacodeAPI: {
      server: {
        getConfig: () => Promise<{ baseUrl: string; token: string }>;
      };
      dialog: {
        openDirectory: () => Promise<string | null>;
        openFile: () => Promise<string | null>;
        saveFile: (options?: { defaultPath?: string }) => Promise<string | null>;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
        showItemInFolder: (fullPath: string) => Promise<void>;
      };
      app: {
        getVersion: () => Promise<string>;
        getPlatform: () => Promise<string>;
      };
      permissions: {
        sendResponse: (response: { id: string; approved: boolean }) => void;
        onRequest: (
          callback: (request: {
            id: string;
            toolName: string;
            args: Record<string, unknown>;
          }) => void
        ) => () => void;
      };
      fsWatcher: {
        startWatch: (workspacePath: string) => void;
        stopWatch: () => void;
        onEvent: (
          callback: (event: { type: "add" | "change" | "unlink"; path: string }) => void
        ) => () => void;
      };
    };
  }
}

export {};
