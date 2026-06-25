import type { LogEntry, Logger, LogLevel } from "@sakti-code/logger";
import { ipcMain } from "electron";
import { IPC } from "../../shared/channels";

/**
 * Register the renderer→desktop.log IPC sink. The renderer forwards sanitized
 * {@link LogEntry}s (via the forwarding logger); main re-emits them through the
 * desktop pino logger, tagging `origin: "renderer"` so renderer lines are
 * distinguishable from main-process lines in desktop.log.
 */
export function registerLogHandler(desktopLogger: Logger): void {
  ipcMain.on(IPC.logMessage, (_event, entry: LogEntry) => {
    const level = entry.level as LogLevel;
    const fn = desktopLogger[level];
    fn.call(desktopLogger, entry.message, {
      ...(entry.context ?? {}),
      origin: "renderer",
    });
  });
}
