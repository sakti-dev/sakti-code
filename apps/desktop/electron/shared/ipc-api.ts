import type { LogEntry } from "@sakti-code/logger";
import type { ServerConfig } from "./server-config";

export interface SaktiDesktopAPI {
  log: {
    /** Forward a renderer log entry to the main process → desktop.log (fire-and-forget). */
    send(entry: LogEntry): void;
  };
  server: {
    getConfig(): Promise<ServerConfig>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
}
