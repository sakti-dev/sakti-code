import type { LogContext, Logger } from "./types.ts";

const noop = (): void => {
  // Intentionally does nothing — this is the discard sink for no-op logging.
};

/**
 * Build a `Logger` whose every method is a no-op.
 *
 * Each logger param defaults to this so existing callers/tests that don't pass
 * a logger are unaffected (zero regressions). `child()` returns a fresh
 * no-op logger rather than `this`, mirroring how real loggers branch — so a
 * child derived from a no-op is still a no-op.
 */
function createNoopLogger(): Logger {
  const self: Logger = {
    child: (_context: LogContext) => createNoopLogger(),
    debug: noop,
    error: noop,
    info: noop,
    warn: noop,
  };
  return self;
}

export const noopLogger: Logger = createNoopLogger();
