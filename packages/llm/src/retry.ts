import type { AssistantMessage } from "./types.ts";

/**
 * # Transient error classifier for retry decisions
 *
 * Ported from pi-ai (`packages/ai/src/utils/retry.ts`). This carries
 * production-hardened knowledge of which provider/transport errors are worth
 * retrying vs. which represent permanent failures (billing, quota, auth).
 *
 * Used by the server's WS runner to decide whether a failed assistant turn
 * should be retried with exponential backoff.
 *
 * ## Classification rules
 *
 * 1. `stopReason !== "error"` → not retryable (the turn didn't fail).
 * 2. No `errorMessage` → not retryable (nothing to classify).
 * 3. Error matches {@link NON_RETRYABLE_LIMIT_PATTERN} → NOT retryable
 *    (billing, quota, subscription limits — these fail identically every time).
 * 4. Error matches {@link RETRYABLE_ERROR_PATTERN} → retryable
 *    (overloaded, rate limit, network, timeout, stream failures).
 * 5. Neither pattern matches → NOT retryable (unknown error, fail fast).
 *
 * Note that the non-retryable check runs FIRST: a message containing both a
 * limit term and a transient term is treated as non-retryable.
 */

/**
 * Build a single case-insensitive regex from a list of alternative patterns.
 * Patterns may contain regex syntax (e.g. `.?` to tolerate "rate limit" vs
 * "ratelimit"). Top-level literal per biome `useTopLevelRegex`.
 */
function buildProviderErrorPattern(patterns: readonly string[]): RegExp {
  return new RegExp(patterns.join("|"), "i");
}

/**
 * Errors that represent permanent provider/account limits.
 * These must NOT be retried — they'll fail identically every time, and retrying
 * just burns the user's budget / keeps them waiting on a hopeless loop.
 */
const NON_RETRYABLE_LIMIT_PATTERN = buildProviderErrorPattern([
  // OpenCode Go/free-tier limits returned as 429 JSON error types by OpenCode's
  // Zen API. These are subscription/account limits, not transient throttles.
  "GoUsageLimitError",
  "FreeUsageLimitError",

  // OpenCode Go subscription-limit text asks users to enable available-balance
  // usage after rolling/weekly/monthly limits are reached.
  "Monthly usage limit reached",
  "available balance",

  // Generic quota/budget/billing exhaustion. `insufficient_quota` is OpenAI's
  // quota/billing error code; the other strings cover common gateway wording.
  "insufficient_quota",
  "out of budget",
  "quota exceeded",
  "billing",
]);

/**
 * Errors that are typically transient — worth retrying after a backoff delay.
 * Each entry is annotated with the real-world incident that motivated it.
 * Pattern syntax allows `.?` between words to match "rate limit" / "ratelimit".
 */
const RETRYABLE_ERROR_PATTERN = buildProviderErrorPattern([
  // Generic provider load, HTTP status, and server-side transient failures.
  "overloaded",
  "rate.?limit",
  "too many requests",
  "429",
  "500",
  "502",
  "503",
  "504",
  "service.?unavailable",
  "server.?error",
  "internal.?error",

  // Wrapper/provider text for transient upstream failures, including OpenRouter
  // "Provider returned error" responses (#2264).
  "provider.?returned.?error",

  // Network, proxy, and fetch transport failures. This includes OpenAI Codex
  // raw-fetch failures such as "upstream connect", "connection refused", and
  // "reset before headers" (#733), plus OpenRouter connection drops (#3317).
  "network.?error",
  "connection.?error",
  "connection.?refused",
  "connection.?lost",
  "other side closed",
  "fetch failed",
  "upstream.?connect",
  "reset before headers",
  "socket hang up",
  "timed.?out",
  "timeout",
  "terminated",

  // WebSocket transports can report close/error text instead of HTTP/fetch text.
  "websocket.?closed",
  "websocket.?error",

  // Premature stream endings from SDKs and transports. Anthropic can throw
  // "stream ended without ..." and "Anthropic stream ended before message_stop"
  // (#4433); Bedrock/Smithy can throw an HTTP/2 no-response error (#3594).
  "ended without",
  "stream ended before message_stop",
  "http2 request did not get a response",

  // Provider-requested retry delay cap failures should flow through the outer
  // retry policy so callers can surface/abort the backoff (#1123).
  "retry delay",

  // Explicit retry guidance emitted mid-stream by OpenAI Responses and Bedrock
  // stream exceptions (#6019).
  "you can retry your request",
  "try your request again",
  "please retry your request",
]);

/**
 * Classify whether a failed assistant message looks like a transient provider
 * or transport error, so the caller can decide if the turn should be retried.
 *
 * This does NOT implement retry policy. Callers should first handle context
 * overflow separately (that needs compaction, not retry), then apply their own
 * retry budget, backoff, and reporting before restarting the turn.
 */
export function isRetryableAssistantError(message: AssistantMessage): boolean {
  // Not a failed turn, or a failed turn with no diagnostic text — nothing to
  // classify.
  if (message.stopReason !== "error" || !message.errorMessage) {
    return false;
  }
  const errorMessage = message.errorMessage;
  // Permanent limits screen FIRST so a message mixing both terms (e.g. a
  // provider throttling text that also mentions billing) is not retried.
  if (NON_RETRYABLE_LIMIT_PATTERN.test(errorMessage)) {
    return false;
  }
  return RETRYABLE_ERROR_PATTERN.test(errorMessage);
}
