/**
 * The four severity levels we log at. Ordered for sorting/filtering.
 * Mirrors pino/console method names so the adapter mapping is trivial.
 */
export type LogLevel = "debug" | "error" | "info" | "warn";

/**
 * Structured key/value context attached to a log call.
 *
 * `domain`/`module`/`scope` are conventional tags (e.g. `domain: "LLM"`,
 * `module: "stream"`) used for filtering and console formatting, but any
 * arbitrary string key is allowed so callers can thread whatever detail
 * they need (model, attempt, baseURL, …) without extending the type.
 *
 * Extends `Record<string, unknown>` rather than being a closed shape so the
 * "arbitrary string keys" requirement holds at the type level.
 */
export interface LogContext extends Record<string, unknown> {
  domain?: string;
  module?: string;
  scope?: string;
}

/**
 * A single log record as passed to a {@link TelemetrySink}.
 * This is the wire shape forwarded over renderer→main IPC and recorded by
 * telemetry, so it must stay structured-cloneable (no functions/classes).
 */
export interface LogEntry {
  context?: LogContext;
  level: LogLevel;
  message: string;
}

/**
 * Message-first logger contract.
 *
 * `error` takes the error as its 2nd arg (not folded into context) so every
 * implementation can normalize it via `describeError` uniformly. `child`
 * returns a new logger that merges the given context into every subsequent
 * call — used to pin `domain`/`module` for a subsystem.
 *
 * This interface is implemented by: `noopLogger`, `createConsoleLogger`,
 * `createForwardingLogger` (renderer), and `createPinoLogger` (node).
 */
export interface Logger {
  child(context: LogContext): Logger;
  debug(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
}

/**
 * Telemetry destination (e.g. Axiom). Wired as a no-op seam for now; a real
 * sink is swapped in at the composition root later. `flush` is optional so
 * callers that have nothing to buffer don't need to stub it.
 */
export interface TelemetrySink {
  flush?(): Promise<void>;
  record(entry: LogEntry): void;
}

/**
 * Default no-op telemetry sink. Used everywhere until telemetry is enabled,
 * so logging call sites never have to null-check the sink.
 */
export const noopTelemetrySink: TelemetrySink = {
  record() {
    // Intentionally discards every entry: default sink until telemetry (Axiom)
    // is wired in at the composition root.
  },
};
