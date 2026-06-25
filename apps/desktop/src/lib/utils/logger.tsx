import {
  createDomainLogger as _createDomainLogger,
  describeError as _describeError,
  createForwardingLogger,
  type LogContext,
  type LogEntry,
  type Logger,
} from "@sakti-code/logger";

// Re-export the types + helpers the rest of the renderer already imports.
export type { LogContext, Logger } from "@sakti-code/logger";
/** Domains are free-form strings (kept as an alias for backwards compatibility). */
export type LogDomain = string;
export const describeError = _describeError;

/**
 * Forward renderer log entries to the main process (→ desktop.log) over the
 * preload IPC bridge. The {@link createForwardingLogger} also prints every line
 * to the DevTools console, so logs are visible locally even if the bridge is
 * missing (tests / non-Electron). The transport is guarded so a missing
 * `window.sakti.log` never throws.
 */
const transport = (entry: LogEntry): void => {
  const sakti = (
    window as unknown as {
      sakti?: { log?: { send(e: LogEntry): void } };
    }
  ).sakti;
  try {
    sakti?.log?.send(entry);
  } catch {
    // Bridge unavailable — the forwarding logger already printed to console.
  }
};

/** Singleton forwarding logger wired to the desktop.log IPC bridge. */
export const logger: Logger = createForwardingLogger(transport, {
  minLevel: import.meta.env.DEV ? "debug" : "info",
});

/** Derive a child logger that pins the given context (e.g. `{ module }`). */
export const createLogger = (context: LogContext = {}): Logger =>
  logger.child(context);

/** Pin a domain upfront (convenience over `{ domain }`). */
export const createDomainLogger = _createDomainLogger;
