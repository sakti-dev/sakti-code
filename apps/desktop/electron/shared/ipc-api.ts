import type { ServerConfig } from "./server-config";

export interface SaktiDesktopAPI {
  server: {
    getConfig(): Promise<ServerConfig>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
}
