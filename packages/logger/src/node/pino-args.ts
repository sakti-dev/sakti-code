import { describeError } from "../describe-error.ts";
import type { LogContext } from "../types.ts";

/**
 * Map one log call to pino's `(obj, message)` call shape.
 *
 * Pino's API is `pino[level](mergingObject, message)` — this produces that
 * `mergingObject` by spreading the call context and tagging the `layer`, then
 * folding a logged error into `error` via {@link describeError}.
 *
 * Returns a tuple `[obj, message]` the caller spreads into `pino[level](...obj, msg)`.
 * Pure (no I/O, no pino import) so it's unit-testable without the worker-thread
 * file transport that the real pino instance uses.
 *
 * The caller's `context` is spread into a fresh object, so it is never mutated
 * and never gains a stray `layer`/`error` key.
 */
export function toPinoCall(
  message: string,
  context: LogContext | undefined,
  error: unknown | undefined,
  layer: string
): [Record<string, unknown>, string] {
  const obj: Record<string, unknown> = { ...(context ?? {}), layer };
  if (error !== undefined) {
    obj.error = describeError(error);
  }
  return [obj, message];
}
