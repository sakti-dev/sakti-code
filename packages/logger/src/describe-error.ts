/**
 * Normalize any thrown/Logged value into a flat string for log output.
 *
 * - `Error` → its `.message` (the most useful single line).
 * - `string` → as-is.
 * - everything else → JSON, with circular references replaced by
 *   `"[Circular]"` so logging a cyclic object never throws.
 *
 * `undefined`/`null` become their string names rather than the JSON `"undefined"`
 * (which isn't valid JSON) — keeps every code path returning a non-empty line.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error === undefined) {
    return "undefined";
  }
  if (error === null) {
    return "null";
  }
  return safeStringify(error);
}

/**
 * JSON.stringify with a circular-reference-safe replacer.
 *
 * Tracks seen objects in a WeakSet; on the second encounter of the same
 * object reference, emits `"[Circular]"` instead of recursing (which would
 * throw `TypeError: Converting circular structure to JSON`). Primitives are
 * never tracked, so repeated scalar values still serialize normally.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, raw) => {
    if (raw === null || typeof raw !== "object") {
      return raw;
    }
    if (seen.has(raw)) {
      return "[Circular]";
    }
    seen.add(raw);
    return raw;
  });
}
