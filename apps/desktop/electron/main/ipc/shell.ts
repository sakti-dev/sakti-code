import { ipcMain, shell } from "electron";
import { IPC } from "../../shared/channels";
import { logger } from "../lib/logger";
import { isProtocolAllowed } from "../lib/protocol";

export function registerShellHandlers(): void {
  ipcMain.handle(IPC.shellOpenExternal, async (_event, url: string) => {
    if (!isProtocolAllowed(url)) {
      logger.warn("blocked openExternal:", url);
      throw new Error(`URL protocol not allowed: ${url}`);
    }
    await shell.openExternal(url);
  });
}
