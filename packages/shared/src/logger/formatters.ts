/**
 * Pino formatters for @sakti-code/shared/logger
 */

import type { LoggerContext } from "./types";

/**
 * Create the prefix string for log messages
 * Format: [package:module] or [package] if no module
 */
export function createPrefix(context: LoggerContext): string {
  const parts: string[] = [context.package];

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
 * Pino log formatter that adds prefix to message
 */
export function logFormatter() {
  return {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
        // Keep this as a string so transport options stay clone-safe for worker threads.
        messageFormat: "{prefix} {msg}",
        customColors: "debug:blue,info:green,warn:yellow,error:red",
      },
    },
  };
}

/**
 * Custom formatter for structured output
 */
export function createCustomFormatter(packageName: string) {
  return {
    level: (label: string) => {
      return { level: label };
    },
    log: (object: Record<string, unknown>) => {
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
  };
}
