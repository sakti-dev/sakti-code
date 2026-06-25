/**
 * # Application-level retry loop
 *
 * Wraps a failed LLM turn with classification, exponential backoff, and UI
 * visibility. Lives in the server layer (not the agent loop, not the SDK) so
 * that retry state can surface to the user via typed `auto_retry_*` events on
 * the same WS channel as agent events.
 *
 * ## Why application-level retry?
 *
 * The SDK (`@sakti-code/llm`) runs with `maxRetries: 0` (fail fast). Retrying
 * at the SDK level hides failures from the user and offers no way to show a
 * "retrying in 4s…" banner or to cancel mid-backoff. By handling retry here,
 * we get full control over backoff timing, abort, and UI reporting — matching
 * pi's coding-agent design.
 *
 * ## Flow
 *
 * 1. Run a turn (`runTurn` → harness.prompt first, harness.continue after).
 * 2. If it failed, classify via `shouldRetry` (transient + budget remaining).
 * 3. Emit `auto_retry_start`, roll the session leaf back past the failed
 *    message, sleep with exponential backoff, then re-run the turn.
 * 4. Repeat until success, budget exhaustion, or abort.
 * 5. Emit a single `auto_retry_end` (success or final failure).
 *
 * @see docs/plans/2026-06-25-application-level-retry.md
 */

import type { AgentEvent } from "@sakti-code/agent";
import type { AssistantMessage } from "@sakti-code/llm";
import { isRetryableAssistantError } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";

// ─── pure decision helpers (unit-tested in isolation) ────────────────────────

/** Inputs for a single retry decision. */
export interface RetryDecisionInput {
  /** Number of retries already attempted (0 before the first retry). */
  attempt: number;
  /** Whether auto-retry is enabled in session settings. */
  autoRetryEnabled: boolean;
  /** Configured maximum retry attempts (from session settings). */
  maxRetries: number;
  /** The failed assistant message from the just-completed turn. */
  message: AssistantMessage;
}

/**
 * Decide whether the just-failed turn should be retried.
 *
 * Returns `true` only when ALL hold: auto-retry is enabled, the attempt budget
 * is not exhausted, and the error classifies as transient
 * ({@link isRetryableAssistantError}).
 */
export function shouldRetry(input: RetryDecisionInput): boolean {
  if (!input.autoRetryEnabled) {
    return false;
  }
  if (input.attempt >= input.maxRetries) {
    return false;
  }
  return isRetryableAssistantError(input.message);
}

/**
 * Compute the exponential backoff delay for a retry attempt.
 *
 * @param attempt - 1-based retry number (first retry = 1).
 * @param baseDelayMs - base delay from settings (e.g. 2000).
 * @returns `baseDelayMs * 2^(attempt - 1)` — so 2000 → 2s, 4s, 8s.
 */
export function computeRetryDelay(
  attempt: number,
  baseDelayMs: number
): number {
  return baseDelayMs * 2 ** (attempt - 1);
}

/** Parsed retry settings, derived from the flat session settings KV. */
export interface RetrySettings {
  baseDelayMs: number;
  enabled: boolean;
  maxRetries: number;
}

/**
 * Parse retry settings from the session settings map, applying pi's defaults
 * (maxRetries 3, baseDelayMs 2000) when keys are absent.
 */
export function parseRetrySettings(
  settings: Record<string, string>
): RetrySettings {
  return {
    enabled: settings.auto_retry === "true",
    baseDelayMs: Number.parseInt(settings.base_delay_ms ?? "2000", 10),
    maxRetries: Number.parseInt(settings.max_retries ?? "3", 10),
  };
}

// ─── abort-aware sleep ───────────────────────────────────────────────────────

/**
 * Sleep that resolves `true` after the full delay, or `false` as soon as the
 * signal aborts (either before or during the sleep). Used by the retry loop so
 * a user abort interrupts the backoff without rejecting the promise.
 */
export function abortableSleep(
  ms: number,
  signal: AbortSignal
): Promise<boolean> {
  return new Promise((resolve) => {
    // Already aborted before sleeping — resolve immediately.
    if (signal.aborted) {
      resolve(false);
      return;
    }
    // Resolve `false` on abort, removing the listener so we don't leak it.
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ─── the orchestration loop ──────────────────────────────────────────────────

/**
 * Injectable dependencies for {@link executeWithRetry}. Keeping these as a
 * callback interface makes the retry loop unit-testable without spinning up a
 * real harness/storage — the test supplies fakes.
 */
export interface RetryRunnerDeps {
  /** Forward an `auto_retry_start`/`auto_retry_end` event to the WS subscriber. */
  emit: (event: AgentEvent) => void;
  /** Optional logger for tracing retry lifecycle. When absent, no logs are emitted. */
  logger?: Logger;
  /** Roll the session leaf back past the failed message so the next turn re-runs it. */
  rollbackLeaf: () => Promise<void>;
  /** Run one turn. The first call runs `harness.prompt`, later calls run `harness.continue`. */
  runTurn: () => Promise<AssistantMessage>;
  /** Aborts the backoff sleep and stops retrying (wired to the run's abort). */
  signal: AbortSignal;
}

/**
 * Run a turn, retrying transient failures with exponential backoff and full UI
 * visibility. Emits `auto_retry_start` before each retry's backoff and a single
 * `auto_retry_end` once the outcome is final (success, budget exhausted, or
 * aborted). If the first turn succeeds, no retry events are emitted at all.
 *
 * The `finalError` field on a failed `auto_retry_end` is omitted when the
 * outcome is a success (respects `exactOptionalPropertyTypes`).
 */
export async function executeWithRetry(
  deps: RetryRunnerDeps,
  settings: RetrySettings
): Promise<void> {
  // Run the first turn. If retry is disabled we still ran the turn; we just
  // don't attempt any retries.
  deps.logger?.debug("turn attempt", {
    attempt: 0,
    maxRetries: settings.maxRetries,
  });
  let message = await deps.runTurn();
  if (!settings.enabled) {
    return;
  }

  deps.logger?.info("retry started", { maxRetries: settings.maxRetries });
  let attempt = 0;
  while (
    shouldRetry({
      message,
      attempt,
      maxRetries: settings.maxRetries,
      autoRetryEnabled: settings.enabled,
    })
  ) {
    attempt++;
    const delayMs = computeRetryDelay(attempt, settings.baseDelayMs);

    deps.logger?.error(
      "turn error",
      message.errorMessage ? new Error(message.errorMessage) : undefined,
      { attempt }
    );
    deps.logger?.debug("should retry", {
      attempt,
      maxRetries: settings.maxRetries,
      willRetry: true,
    });

    // Tell the UI a retry is coming (shows the banner + countdown).
    deps.emit({
      type: "auto_retry_start",
      attempt,
      delayMs,
      errorMessage: message.errorMessage ?? "Unknown error",
      maxAttempts: settings.maxRetries,
    });

    // Orphan the failed assistant message so continue() sees the preceding
    // user/toolResult message as the transcript tail.
    deps.logger?.warn("rolling back leaf", { attempt });
    await deps.rollbackLeaf();

    // Backoff — interruptible by abort. If aborted, report final failure.
    deps.logger?.debug("backoff", { delayMs, attempt });
    const slept = await abortableSleep(delayMs, deps.signal);
    if (!slept || deps.signal.aborted) {
      deps.logger?.warn("retry aborted", { attempt });
      deps.emit({
        type: "auto_retry_end",
        success: false,
        attempt,
        ...(message.errorMessage === undefined
          ? {}
          : { finalError: message.errorMessage }),
      });
      return;
    }

    // Re-run the turn (harness.continue under the hood).
    deps.logger?.debug("turn attempt", {
      attempt,
      maxRetries: settings.maxRetries,
    });
    message = await deps.runTurn();
  }

  // Only emit an end event if we actually retried. A clean first-turn success
  // emits nothing.
  if (attempt > 0) {
    // An aborted retried turn has stopReason "aborted" (not "error"), so the
    // stopReason check alone would mislabel an abort as success. The run's
    // abort signal is authoritative — if it fired, the retry did not succeed.
    const success = !deps.signal.aborted && message.stopReason !== "error";
    if (success) {
      deps.logger?.info("turn succeeded", { attempt });
    } else {
      deps.logger?.error("all retries exhausted", undefined, {
        attempts: attempt,
        errorMessage: message.errorMessage ?? "Unknown error",
      });
    }
    deps.emit({
      type: "auto_retry_end",
      success,
      attempt,
      // Only attach finalError when there is one (success has none).
      ...(success
        ? {}
        : { finalError: message.errorMessage ?? "Unknown error" }),
    });
  }
}
