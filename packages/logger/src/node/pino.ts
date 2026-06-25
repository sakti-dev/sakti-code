import { join } from "node:path";
import pino from "pino";
import type {
  LogContext,
  LogEntry,
  Logger,
  LogLevel,
  TelemetrySink,
} from "../types.ts";
import { noopTelemetrySink } from "../types.ts";
import { toPinoCall } from "./pino-args.ts";

/**
 * Secret-bearing fields redacted from every record by default. Covers the
 * shapes API keys / auth headers typically take (top-level + nested under a
 * provider/options object). Callers can override via `redactPaths`.
 */
const DEFAULT_REDACT = [
  "*.apiKey",
  "*.authorization",
  "*.cookie",
  "apiKey",
  "err.responseHeaders.authorization",
  "err.responseHeaders.cookie",
  "headers.authorization",
  "headers.cookie",
];

/** The slice of a pino instance the adapter actually calls. */
export interface PinoLike {
  debug(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Options handed to the pino factory: level + redaction (+ roll transport in production). */
export interface PinoOptions {
  level: string;
  redact: { paths: string[]; censor: string };
  transport?: { target: string; options: Record<string, unknown> };
}

/** Injectable pino constructor (production omits → real pino + pino-roll). */
export type PinoFactory = (opts: PinoOptions) => PinoLike;

export interface PinoLoggerOptions {
  /** Log file basename, placed inside `logDir`. */
  dest: string;
  /** Tagged on every record (`layer: "agent"` etc.) so files stay self-describing. */
  layer: string;
  /** Minimum level to emit (default `info`). */
  level?: LogLevel;
  /** Directory the rolling log file is written to. */
  logDir: string;
  /** Test injection: a fake pino so the adapter is unit-testable without the worker-thread transport. */
  pinoFactory?: PinoFactory;
  /** Override the default redact paths. */
  redactPaths?: string[];
  /** Telemetry sink (default no-op; Axiom wired in later at the composition root). */
  telemetry?: TelemetrySink;
}

/** Merge a child's pinned context with a per-call context (undefined when neither is present). */
const mergeCtx = (
  defaultCtx: LogContext | undefined,
  context?: LogContext
): LogContext | undefined => {
  if (defaultCtx === undefined && context === undefined) {
    return;
  }
  return { ...(defaultCtx ?? {}), ...(context ?? {}) };
};

/**
 * Build the real pino instance: redaction + a `pino-roll` transport (daily
 * rotation, 10 MB size cap, auto-mkdir) writing to `logDir/dest`.
 *
 * Only reachable via the `./node` subpath — the renderer imports `"."` only, so
 * pino/pino-roll never enter the renderer bundle.
 */
function createRealPino(
  opts: PinoOptions,
  logDir: string,
  dest: string
): PinoLike {
  const instance = pino(
    { level: opts.level, redact: opts.redact },
    pino.transport({
      target: "pino-roll",
      options: {
        file: join(logDir, dest),
        frequency: "daily",
        size: "10m",
        mkdir: true,
      },
    })
  );
  return instance as unknown as PinoLike;
}

/**
 * Build a {@link Logger} backed by a pino instance.
 *
 * Each call maps to `pino[level](obj, msg)` via {@link toPinoCall} (context
 * merged + `layer` tagged + error folded), and is also handed to the telemetry
 * sink. `child()` returns a logger with extra pinned context but shares the
 * same underlying pino instance.
 */
export function createPinoLogger(opts: PinoLoggerOptions): Logger {
  const telemetry = opts.telemetry ?? noopTelemetrySink;
  const layer = opts.layer;
  const pinoOptions: PinoOptions = {
    level: opts.level ?? "info",
    redact: { paths: opts.redactPaths ?? DEFAULT_REDACT, censor: "[REDACTED]" },
  };
  const pinoInstance =
    opts.pinoFactory === undefined
      ? createRealPino(pinoOptions, opts.logDir, opts.dest)
      : opts.pinoFactory(pinoOptions);

  const make = (defaultCtx: LogContext | undefined): Logger => {
    const send = (
      level: LogLevel,
      message: string,
      context?: LogContext,
      error?: unknown
    ): void => {
      const merged = mergeCtx(defaultCtx, context);
      const [obj, msg] = toPinoCall(message, merged, error, layer);
      pinoInstance[level](obj, msg);
      const entry: LogEntry = {
        level,
        message,
        ...(merged === undefined ? {} : { context: merged }),
      };
      telemetry.record(entry);
    };

    return {
      child: (context) => make({ ...(defaultCtx ?? {}), ...context }),
      debug: (message, context) => send("debug", message, context),
      error: (message, error, context) =>
        send("error", message, context, error),
      info: (message, context) => send("info", message, context),
      warn: (message, context) => send("warn", message, context),
    };
  };

  return make(undefined);
}
