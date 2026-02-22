/**
 * Frontend console logger for desktop (SolidJS renderer)
 *
 * Browser-compatible logger using console methods.
 * Matches the backend Logger interface from @sakti-code/shared/logger.
 *
 * ## Environment Best Practices
 *
 * **Development**: Show all logs (debug level) for visibility
 * **Production**: Show only warnings and errors (warn level)
 *
 * ## Usage
 * ```ts
 * import { createLogger } from '@/lib/logger';
 *
 * const logger = createLogger("desktop:chat");
 * logger.info("Message received");
 * ```
 */

import type { Logger, LoggerContext } from "@sakti-code/shared/logger";

type LogLevelInternal = "debug" | "info" | "warn" | "error";

function formatTimestamp(): string {
  return new Date().toTimeString().split(" ")[0];
}

function createPrefix(context: LoggerContext): string {
  const parts = [context.package];
  if (context.module) parts.push(context.module);
  else if (context.agent) parts.push("agent", context.agent);
  else if (context.tool) parts.push("tool", context.tool);
  return `[${parts.join(":")}]`;
}

function formatContext(context: Record<string, unknown>): string {
  const entries = Object.entries(context).filter(([, v]) => v != null);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ");
}

/**
 * Get default log level based on environment
 */
export function getDefaultLogLevel(): "debug" | "info" | "warn" | "error" | "silent" {
  if (import.meta.env.VITE_LOG_LEVEL) {
    const level = import.meta.env.VITE_LOG_LEVEL.toLowerCase();
    if (["debug", "info", "warn", "error", "silent"].includes(level)) {
      return level as never;
    }
  }
  if (import.meta.env.MODE === "test") {
    return "warn";
  }
  return import.meta.env.DEV ? "debug" : "warn";
}

/**
 * Create a new console logger
 */
export function createConsoleLogger(
  packageName: string,
  config?: { level?: "debug" | "info" | "warn" | "error" | "silent" }
): Logger {
  const level = config?.level ?? getDefaultLogLevel();
  const levelPriority = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
  const baseContext: LoggerContext = { package: packageName };

  function shouldLog(logLevel: LogLevelInternal): boolean {
    return levelPriority[logLevel] >= levelPriority[level as LogLevelInternal];
  }

  function log(
    logLevel: LogLevelInternal,
    msg: string,
    context?: Partial<LoggerContext>,
    error?: Error
  ): void {
    if (!shouldLog(logLevel)) return;

    const mergedContext = { ...baseContext, ...context };
    const prefix = createPrefix(mergedContext);
    const contextStr = formatContext(mergedContext);

    const parts = [`${formatTimestamp()} ${prefix} ${msg}`];
    if (contextStr) parts.push(contextStr);

    const message = parts.join(" ");

    switch (logLevel) {
      case "debug":
        console.debug(message);
        break;
      case "info":
        console.info(message);
        break;
      case "warn":
        console.warn(message);
        break;
      case "error":
        console.error(message, error ?? "");
        break;
    }
  }

  return {
    debug: (msg: string, context?: Partial<LoggerContext>) => log("debug", msg, context),
    info: (msg: string, context?: Partial<LoggerContext>) => log("info", msg, context),
    warn: (msg: string, context?: Partial<LoggerContext>) => log("warn", msg, context),
    error: (msg: string, err?: Error, context?: Partial<LoggerContext>) =>
      log("error", msg, context, err),
  };
}
