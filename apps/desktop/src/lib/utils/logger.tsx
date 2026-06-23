type LogLevel = "debug" | "error" | "info" | "warn";

const LOG_VALUE_NEEDS_QUOTES_PATTERN = /[\s"=]/;
const INTERNAL_CONTEXT_KEYS = new Set(["domain", "module", "prefix", "scope"]);

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

export type LogDomain =
  | "AUTH"
  | "CHAT"
  | "DB"
  | "SERVER"
  | "SESSION"
  | "TOOL"
  | "UI"
  | "WS";

export type LogContext = Record<string, unknown> & {
  domain?: LogDomain;
  module?: string;
  scope?: string;
};

export interface Logger {
  child(context: LogContext): Logger;
  debug(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
}

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

const toAction = (message: string): string =>
  toSnakeCase(message).toUpperCase();

const toDomain = (context: LogContext): LogDomain => {
  if (context.domain !== undefined) {
    return context.domain;
  }

  const module = String(context.module ?? "ui").toLowerCase();
  const scope = context.scope == null ? "" : String(context.scope);
  const candidates = `${module}:${scope.toLowerCase()}`;

  if (candidates.includes("auth")) {
    return "AUTH";
  }
  if (candidates.includes("db")) {
    return "DB";
  }
  if (candidates.includes("server")) {
    return "SERVER";
  }
  if (candidates.includes("session")) {
    return "SESSION";
  }
  if (candidates.includes("tool")) {
    return "TOOL";
  }
  if (candidates.includes("ws") || candidates.includes("websocket")) {
    return "WS";
  }
  if (candidates.includes("chat")) {
    return "CHAT";
  }
  return "UI";
};

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

const formatContext = (
  defaultContext: LogContext,
  context?: LogContext,
  error?: unknown
): string => {
  const merged = {
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

const createBaseLogger = (defaultContext: LogContext = {}): Logger => {
  const log = (
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: unknown
  ): void => {
    emit(
      level,
      `[${toDomain(defaultContext)}:${toAction(message)}] ${message}${formatContext(defaultContext, context, error)}`
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

export const createLogger = (context: LogContext = {}): Logger =>
  createBaseLogger(context);

export const createDomainLogger = (
  domain: LogDomain,
  context: Omit<LogContext, "domain"> = {}
): Logger => createBaseLogger({ ...context, domain });

export const logger = createLogger();
