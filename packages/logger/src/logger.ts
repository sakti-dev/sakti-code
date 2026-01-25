/**
 * Core logger implementation using Pino
 */

import pino from "pino";
import { createPrefix } from "./formatters";
import type { Logger, LoggerConfig, LoggerContext } from "./types";

/**
 * Create a new logger instance
 */
export function createLogger(packageName: string, config?: Partial<LoggerConfig>): Logger {
  const finalConfig = {
    level: config?.level || "info",
    prettyPrint: config?.prettyPrint ?? false,
    fileOutput: config?.fileOutput ?? false,
    filePath: config?.filePath,
    redact: config?.redact || [],
  };

  const transports = pino.transport({
    targets: [
      finalConfig.prettyPrint
        ? {
            target: "pino-pretty",
            level: finalConfig.level,
            options: {
              colorize: true,
              translateTime: "HH:MM:ss",
              ignore: "pid,hostname",
              messageFormat: (log: Record<string, unknown>) => {
                const prefix = (log.prefix as string) || "";
                const msg = (log.msg as string) || "";
                return prefix ? `${prefix} ${msg}` : msg;
              },
              customColors: "debug:blue,info:green,warn:yellow,error:red",
            },
          }
        : {
            target: "pino/file",
            level: finalConfig.level,
            options: {
              destination: finalConfig.filePath || 1, // 1 = stdout
              mkdir: true,
            },
          },
    ],
  });

  const pinoLogger = pino(
    {
      level: finalConfig.level,
      redact: finalConfig.redact,
      formatters: {
        log(object: Record<string, unknown>) {
          const { time, ...rest } = object;
          const prefix = createPrefix({
            package: (rest.package as string) || packageName,
            module: rest.module as string | undefined,
            agent: rest.agent as string | undefined,
            tool: rest.tool as string | undefined,
          });
          return {
            ...object,
            prefix,
            time: time || new Date().toISOString(),
          };
        },
      },
    },
    transports
  );

  // Create base context
  const baseContext: LoggerContext = {
    package: packageName,
  };

  return createLoggerInterface(pinoLogger, baseContext);
}

/**
 * Create the Logger interface from Pino instance
 */
function createLoggerInterface(pinoLogger: pino.Logger, baseContext: LoggerContext): Logger {
  return {
    debug(msg: string, context?: Partial<LoggerContext>): void {
      pinoLogger.debug({ ...baseContext, ...context }, msg);
    },

    info(msg: string, context?: Partial<LoggerContext>): void {
      pinoLogger.info({ ...baseContext, ...context }, msg);
    },

    warn(msg: string, context?: Partial<LoggerContext>): void {
      pinoLogger.warn({ ...baseContext, ...context }, msg);
    },

    error(msg: string, err?: Error, context?: Partial<LoggerContext>): void {
      if (err) {
        pinoLogger.error({ ...baseContext, ...context, err: serializeError(err) }, msg);
      } else {
        pinoLogger.error({ ...baseContext, ...context }, msg);
      }
    },

    child(context: Partial<LoggerContext>): Logger {
      const newContext = { ...baseContext, ...context };
      return createLoggerInterface(pinoLogger.child(context), newContext);
    },
  };
}

/**
 * Serialize Error for JSON logging
 */
function serializeError(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
    cause: err.cause,
  };
}
