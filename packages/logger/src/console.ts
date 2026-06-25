import { describeError } from "./describe-error.ts";
import { inferDomain } from "./infer-domain.ts";
import type { LogContext, Logger, LogLevel } from "./types.ts";

/** Values containing whitespace, quotes, or `=` are JSON-quoted so the `key=value` log lines stay unambiguous. */
const LOG_VALUE_NEEDS_QUOTES_PATTERN = /[\s"=]/;

/** Tags that are part of the line's `[DOMAIN:ACTION]` prefix or context routing, not user data, so they're excluded from the `key=value` tail. */
const INTERNAL_CONTEXT_KEYS = new Set(["domain", "module", "prefix", "scope"]);

/** Route a level to the matching console method (debug goes to console.log for visibility). */
const emit = (level: LogLevel, line: string): void => {
  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "debug":
      console.log(line);
      break;
    default:
      console.info(line);
  }
};

const toSnakeCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s:]+/g, "_")
    .toLowerCase();

/** Upper-snake-case the message into an ACTION tag (e.g. "User clicked" → "USER_CLICKED"). */
const toAction = (message: string): string =>
  toSnakeCase(message).toUpperCase();

const formatValue = (value: unknown): string => {
  if (typeof value === "string") {
    return LOG_VALUE_NEEDS_QUOTES_PATTERN.test(value)
      ? JSON.stringify(value)
      : value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return String(value);
  }
  return JSON.stringify(value);
};

/** Render the merged default+call context as a ` key=value key=value` tail (empty string if nothing to show). */
const formatContext = (
  defaultContext: LogContext,
  context?: LogContext,
  error?: unknown
): string => {
  const merged: LogContext = {
    ...defaultContext,
    ...(context ?? {}),
  };

  if (error !== undefined) {
    merged.error = describeError(error);
  }

  const entries = Object.entries(merged).filter(
    ([key]) => !INTERNAL_CONTEXT_KEYS.has(key)
  );
  if (entries.length === 0) {
    return "";
  }

  return ` ${entries
    .map(([key, value]) => `${toSnakeCase(key)}=${formatValue(value)}`)
    .join(" ")}`;
};

/**
 * Build a console logger that tags every line `[DOMAIN:ACTION] message key=value …`.
 *
 * `defaultContext` is merged into every call (used by `child()` to pin a
 * domain/module for a subsystem). This is the direct port of the renderer's
 * previous `createBaseLogger`.
 */
const createBaseLogger = (defaultContext: LogContext = {}): Logger => {
  const log = (
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: unknown
  ): void => {
    emit(
      level,
      `[${inferDomain(defaultContext)}:${toAction(message)}] ${message}${formatContext(defaultContext, context, error)}`
    );
  };

  return {
    child(context: LogContext): Logger {
      return createBaseLogger({ ...defaultContext, ...context });
    },
    debug(message: string, context?: LogContext): void {
      log("debug", message, context);
    },
    error(message: string, error?: unknown, context?: LogContext): void {
      log("error", message, context, error);
    },
    info(message: string, context?: LogContext): void {
      log("info", message, context);
    },
    warn(message: string, context?: LogContext): void {
      log("warn", message, context);
    },
  };
};

export const createConsoleLogger = (context: LogContext = {}): Logger =>
  createBaseLogger(context);

/** Convenience alias kept for parity with the previous renderer logger API. */
export const createLogger = (context: LogContext = {}): Logger =>
  createBaseLogger(context);

/** Pin a domain upfront (`createDomainLogger("AUTH")`) — convenience over passing `{ domain }`. */
export const createDomainLogger = (
  domain: string,
  context: Omit<LogContext, "domain"> = {}
): Logger => createBaseLogger({ ...context, domain });
