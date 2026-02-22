/**
 * Desktop Logger Module
 *
 * Provides logging for Electron main process and IPC handler for renderer logs.
 * Uses console in renderer/preload (sandbox-safe) and pino in main process.
 */

import { createLogger as createPinoLogger } from "@sakti-code/shared/logger";
import { ipcMain } from "electron";

// Main process logger uses pino
const mainLogger = createPinoLogger("desktop:main");

/**
 * Log level type
 */
type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Log context for additional metadata
 */
interface LogContext {
  package?: string;
  module?: string;
  agent?: string;
  tool?: string;
  [key: string]: unknown;
}

/**
 * Logger interface matching @sakti-code/shared/logger
 */
export interface Logger {
  debug(msg: string, context?: Partial<LogContext>): void;
  info(msg: string, context?: Partial<LogContext>): void;
  warn(msg: string, context?: Partial<LogContext>): void;
  error(msg: string, err?: Error, context?: Partial<LogContext>): void;
  child(context: Partial<LogContext>): Logger;
}

/**
 * Create a prefix string for log messages
 * Format: [package:module] or [package] if no module
 */
function createPrefix(context: LogContext): string {
  const parts: string[] = [context.package || "desktop"];

  if (context.module) {
    parts.push(context.module);
  } else if (context.agent) {
    parts.push("agent", context.agent);
  } else if (context.tool) {
    parts.push("tool", context.tool);
  }

  return `[${parts.join(":")}]`;
}

/**
 * Console-based logger for renderer/preload processes
 * Sends logs to main process via IPC
 */
function createRendererLogger(packageName: string, baseContext: LogContext = {}): Logger {
  const sendLog = (level: LogLevel, msg: string, context?: Partial<LogContext>, err?: Error) => {
    const fullContext = { package: packageName, ...baseContext, ...context };
    const prefix = createPrefix(fullContext);

    // Send to main process via IPC (non-blocking)
    try {
      // Use a global electronAPI if available (injected by preload)
      const electronAPI = (
        globalThis as unknown as {
          electron?: { ipcRenderer?: { send: (channel: string, ...args: unknown[]) => void } };
        }
      ).electron;
      if (electronAPI?.ipcRenderer) {
        electronAPI.ipcRenderer.send("log:message", {
          level,
          message: `${prefix} ${msg}`,
          context: fullContext,
          error: err ? { name: err.name, message: err.message, stack: err.stack } : undefined,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {
      // IPC not available, fall back to console
    }

    // Also log to renderer console for development
    const consoleMsg = `${prefix} ${msg}`;
    switch (level) {
      case "debug":
        console.debug(consoleMsg);
        break;
      case "info":
        console.info(consoleMsg);
        break;
      case "warn":
        console.warn(consoleMsg);
        break;
      case "error":
        console.error(consoleMsg, err || "");
        break;
    }
  };

  return {
    debug(msg: string, context?: Partial<LogContext>) {
      sendLog("debug", msg, context);
    },
    info(msg: string, context?: Partial<LogContext>) {
      sendLog("info", msg, context);
    },
    warn(msg: string, context?: Partial<LogContext>) {
      sendLog("warn", msg, context);
    },
    error(msg: string, err?: Error, context?: Partial<LogContext>) {
      sendLog("error", msg, context, err);
    },
    child(context: Partial<LogContext>) {
      return createRendererLogger(packageName, { ...baseContext, ...context });
    },
  };
}

/**
 * Console-only logger for preload (when IPC is not yet available)
 */
function createConsoleLogger(packageName: string, baseContext: LogContext = {}): Logger {
  const log = (level: LogLevel, msg: string, context?: Partial<LogContext>, err?: Error) => {
    const fullContext = { package: packageName, ...baseContext, ...context };
    const prefix = createPrefix(fullContext);
    const consoleMsg = `${prefix} ${msg}`;

    switch (level) {
      case "debug":
        console.debug(consoleMsg);
        break;
      case "info":
        console.info(consoleMsg);
        break;
      case "warn":
        console.warn(consoleMsg);
        break;
      case "error":
        console.error(consoleMsg, err || "");
        break;
    }
  };

  return {
    debug(msg: string, context?: Partial<LogContext>) {
      log("debug", msg, context);
    },
    info(msg: string, context?: Partial<LogContext>) {
      log("info", msg, context);
    },
    warn(msg: string, context?: Partial<LogContext>) {
      log("warn", msg, context);
    },
    error(msg: string, err?: Error, context?: Partial<LogContext>) {
      log("error", msg, context, err);
    },
    child(context: Partial<LogContext>) {
      return createConsoleLogger(packageName, { ...baseContext, ...context });
    },
  };
}

/**
 * Create a logger appropriate for the current environment
 *
 * - Main process: Uses pino logger
 * - Renderer/Preload: Uses console + IPC to main process
 */
export function createLogger(packageName: string, context?: Partial<LogContext>): Logger {
  // Check if we're in the main process
  if (process.type === "browser") {
    // Main process - use pino logger with context
    return {
      debug(msg: string, ctx?: Partial<LogContext>) {
        mainLogger.debug(msg, { ...context, ...ctx });
      },
      info(msg: string, ctx?: Partial<LogContext>) {
        mainLogger.info(msg, { ...context, ...ctx });
      },
      warn(msg: string, ctx?: Partial<LogContext>) {
        mainLogger.warn(msg, { ...context, ...ctx });
      },
      error(msg: string, err?: Error, ctx?: Partial<LogContext>) {
        mainLogger.error(msg, err, { ...context, ...ctx });
      },
      child(ctx: Partial<LogContext>) {
        return createLogger(packageName, { ...context, ...ctx });
      },
    };
  }

  // Renderer or preload - use IPC-based logger
  return createRendererLogger(packageName, context);
}

/**
 * Create a simple console logger for preload (sandbox-safe, no IPC dependency)
 */
export function createConsoleOnlyLogger(
  packageName: string,
  context?: Partial<LogContext>
): Logger {
  return createConsoleLogger(packageName, context);
}

/**
 * Setup IPC handler for renderer logs in main process
 * Call this in the main process setup
 */
export function setupLogHandler(): void {
  ipcMain.on(
    "log:message",
    (
      _event,
      data: {
        level: LogLevel;
        message: string;
        context: LogContext;
        error?: { name: string; message: string; stack?: string };
        timestamp: string;
      }
    ) => {
      const { level, message, context, error } = data;

      switch (level) {
        case "debug":
          mainLogger.debug(message, context);
          break;
        case "info":
          mainLogger.info(message, context);
          break;
        case "warn":
          mainLogger.warn(message, context);
          break;
        case "error":
          if (error) {
            const err = new Error(error.message);
            err.name = error.name;
            err.stack = error.stack;
            mainLogger.error(message, err, context);
          } else {
            mainLogger.error(message, undefined, context);
          }
          break;
      }
    }
  );
}

// Export the main logger for direct use
export { mainLogger };
