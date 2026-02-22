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
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
    };
  }
}

export {};
