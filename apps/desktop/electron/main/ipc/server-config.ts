import { ipcMain } from "electron";
import { IPC } from "../../shared/channels";
import type { ServerConfig } from "../../shared/server-config";

export function registerServerConfigHandler(
  getConfig: () => ServerConfig
): void {
  ipcMain.handle(IPC.getServerConfig, () => getConfig());
}
