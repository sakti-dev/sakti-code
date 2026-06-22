import { ipcMain } from "electron";
import { IPC } from "../../shared/channels";
import { logger } from "../lib/logger";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

interface LogPayload {
  level: Level;
  message: string;
}

export function registerLogHandler(): void {
  ipcMain.on(IPC.logMessage, (_event, data: LogPayload) => {
    logger[data.level](`[renderer] ${data.message}`);
  });
}
