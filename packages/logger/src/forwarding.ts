import { formatLine, mergeContext } from "./console.ts";
import type { LogContext, LogEntry, Logger, LogLevel } from "./types.ts";

/**
 * Capture the console methods at module load. If something later reassigns
 * `console.info` etc. we keep printing to the original DevTools sink — and a
 * throwing transport never silences the console output.
 */
const CONSOLE: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.log(line),
  error: (line) => console.error(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Circular-reference-safe deep clone via JSON round-trip.
 *
 * On the second encounter of the same object reference the replacer returns
 * `undefined`, which `JSON.stringify` treats as "drop this key" — so cycles
 * are silently removed rather than throwing. This guarantees the forwarded
 * {@link LogEntry} is structured-cloneable across the renderer→main IPC
 * boundary (which would otherwise throw on cyclic values).
 */
function cloneSafe(value: LogContext): LogContext {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(value, (_key, raw) => {
      if (raw === null || typeof raw !== "object") {
        return raw;
      }
      if (seen.has(raw)) {
        return;
      }
      seen.add(raw);
      return raw;
    })
  );
}

/**
 * Build a logger that (a) prints a formatted line to the DevTools console and
 * (b) forwards a **sanitized** {@link LogEntry} to `transport` (the renderer's
 * IPC bridge to the desktop log file).
 *
 * - The error arg is folded into `context.error` via `describeError`.
 * - The whole context is {@link cloneSafe}-cloned so circular/non-serializable
 *   values never reach IPC (which would throw).
 * - `transport` is wrapped in try/catch: an IPC failure (renderer bridge down)
 *   never breaks logging or the console output.
 * - `child()` returns a forwarding logger with the given context pinned, so a
 *   subsystem can fix its domain/module once.
 */
export function createForwardingLogger(
  transport: (entry: LogEntry) => void,
  options?: { minLevel?: LogLevel }
): Logger {
  const minRank =
    options?.minLevel === undefined ? 0 : LEVEL_RANK[options.minLevel];

  const make = (defaultContext: LogContext): Logger => {
    const send = (
      level: LogLevel,
      message: string,
      context?: LogContext,
      error?: unknown
    ): void => {
      const merged = mergeContext(defaultContext, context, error);
      const sanitized = cloneSafe(merged);
      const isEmpty = Object.keys(sanitized).length === 0;
      const entry: LogEntry = {
        level,
        message,
        ...(isEmpty ? {} : { context: sanitized }),
      };

      // Console output respects minLevel (suppress debug in production, etc.)
      if (LEVEL_RANK[level] >= minRank) {
        CONSOLE[level](formatLine(message, isEmpty ? undefined : sanitized));
      }

      // Transport always fires — the IPC bridge decides what to persist.
      try {
        transport(entry);
      } catch {
        // IPC bridge down: the console sink above already handled it.
      }
    };

    return {
      child: (context) => make({ ...defaultContext, ...context }),
      debug: (message, context) => send("debug", message, context),
      error: (message, error, context) =>
        send("error", message, context, error),
      info: (message, context) => send("info", message, context),
      warn: (message, context) => send("warn", message, context),
    };
  };

  return make({});
}
