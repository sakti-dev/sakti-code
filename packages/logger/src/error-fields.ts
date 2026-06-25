import { describeError } from "./describe-error.ts";
import type { LogContext } from "./types.ts";

/**
 * The known AI SDK / HTTP error fields that explain *why* a provider call
 * failed. Extracted so they survive into structured logs — `describeError`
 * alone only keeps `.message`, hiding the status code and the upstream
 * response body (the actual diagnosis for gateway errors like
 * `"Upstream request failed"`).
 *
 * Field set mirrors `@ai-sdk/provider`'s `APICallError` (`url`,
 * `requestBodyValues`, `statusCode`, `responseHeaders`, `responseBody`,
 * `isRetryable`) plus the generic `status`/`data` some adapters add.
 * `requestBodyValues` is deliberately omitted: it is large and can echo
 * secrets/PII back into a log file.
 */
const HTTP_ERROR_FIELDS = [
  "url",
  "statusCode",
  "status",
  "responseBody",
  "responseHeaders",
  "isRetryable",
  "data",
] as const;

/**
 * Pull diagnostic fields off any thrown value into a flat {@link LogContext}.
 *
 * - Non-errors / undefined → `{}` (nothing to surface).
 * - `Error` → `name`, `message`, the {@link HTTP_ERROR_FIELDS} that are set,
 *   and a recursively-described `cause` (string, never a nested object so it
 *   is structured-clone/IPC-safe and never re-triggers redaction).
 *
 * Reads via the safe accessor so a malformed / non-`Error`-shaped object never
 * throws here — logging must never be the thing that crashes.
 */
export function extractErrorFields(error: unknown): LogContext {
  if (!(error instanceof Error)) {
    return {};
  }

  const fields: LogContext = {
    name: error.name,
    message: error.message,
  };

  const source = error as Error & Record<string, unknown>;
  for (const key of HTTP_ERROR_FIELDS) {
    const value = safeGet(source, key);
    if (value !== undefined) {
      fields[key] = value;
    }
  }

  const cause = safeGet(source, "cause");
  if (cause !== undefined) {
    fields.cause = describeError(cause);
  }

  return fields;
}

/** Read a property off an object without throwing if the accessor is hostile. */
function safeGet(target: object, key: string): unknown {
  try {
    return (target as Record<string, unknown>)[key];
  } catch {
    return;
  }
}
