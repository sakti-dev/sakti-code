import { type Logger, noopLogger } from "@sakti-code/logger";
import { createPinoLogger } from "@sakti-code/logger/node";

const PREFIX = "[desktop:main]";

/**
 * Console-style logger for the main process's own startup/diagnostics output
 * (kept varargs + prefixed so existing `logger.info("…", value)` call sites are
 * unchanged).
 */
export const logger = {
  debug: (...args: unknown[]): void => console.debug(PREFIX, ...args),
  info: (...args: unknown[]): void => console.info(PREFIX, ...args),
  warn: (...args: unknown[]): void => console.warn(PREFIX, ...args),
  error: (...args: unknown[]): void => console.error(PREFIX, ...args),
};

/**
 * Build the pino-backed file logger that renderer log entries are centralized
 * into (`desktop.log` under `logDir`). The caller (main, which has `app`)
 * supplies the resolved `logDir` so this module stays free of Electron imports.
 * If pino initialization fails, a no-op logger is returned so app startup and
 * renderer logging (which always has its own console sink) never break.
 */
export function createDesktopLogger(logDir: string): Logger {
  try {
    return createPinoLogger({ dest: "desktop.log", layer: "desktop", logDir });
  } catch {
    return noopLogger;
  }
}
