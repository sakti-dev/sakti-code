/**
 * # Application-level retry loop
 *
 * Wraps a failed LLM turn with classification, exponential backoff, and UI
 * visibility. Lives in the agent package but owns no transport: the server
 * supplies the callbacks (`emit`, `runTurn`, `rollbackLeaf`, `signal`) so retry
 * state surfaces to the user via the same channel the caller chooses (in sakti,
 * typed `auto_retry_*` events on the WS channel).
 *
 * ## Why application-level retry?
 *
 * The SDK (`@sakti-code/llm`) runs with `maxRetries: 0` (fail fast). Retrying
 * at the SDK level hides failures from the user and offers no way to show a
 * "retrying in 4s…" banner or to cancel mid-backoff. Handling retry here gives
 * full control over backoff timing, abort, and UI reporting — matching pi's
 * coding-agent design.
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

import type { AssistantMessage } from "@sakti-code/llm";
import { isRetryableAssistantError } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import { Effect } from "effect";
import type { CompactionDecision, RunCompactionOutcome } from "../compaction/auto-compaction";
import type { AgentEvent } from "../types";

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
export function computeRetryDelay(attempt: number, baseDelayMs: number): number {
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
export function parseRetrySettings(settings: Record<string, string>): RetrySettings {
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
export function abortableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
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
 * Persistent state for the auto-compaction stuck-guard. Tracks consecutive
 * auto-compactions so {@link checkCompaction} can pause when the context
 * window is too small (≥2 compacts in a row that still leave the prompt over
 * threshold).
 *
 * The pure decision lives in `checkCompaction`; callers (the runner /
 * agent-run factory) own the persistence so the counter survives across run
 * calls and app restarts.
 */
export interface StuckGuardState {
  consecutiveCompacts: number;
  paused: boolean;
}

/**
 * Effect-typed retry deps. The callbacks return Effects instead of Promises,
 * so {@link executeWithRetryEffect} can `yield*` them directly without
 * `Effect.promise(() => deps.X())` bridges.
 *
 * `emit` stays sync (it just forwards an event to the WS subscriber — no
 * await needed). `signal` stays an `AbortSignal` because {@link abortableSleep}
 * uses it directly (Effect sleep + abort integration is future work).
 */
export interface RetryRunnerDepsEffect {
  readonly checkCompaction?: (
    message: AssistantMessage,
  ) => Effect.Effect<CompactionDecision, Error>;
  readonly emit: (event: AgentEvent) => void;
  readonly logger?: Logger;
  readonly rollbackLeaf: () => Effect.Effect<void, Error>;
  readonly runCompaction?: () => Effect.Effect<RunCompactionOutcome, Error>;
  readonly runTurn: () => Effect.Effect<AssistantMessage, Error>;
  readonly signal: AbortSignal;
}

/**
 * Run a turn, retrying transient failures with exponential backoff and full UI
 * visibility. Emits `auto_retry_start` before each retry's backoff and a single
 * `auto_retry_end` once the outcome is final (success, budget exhausted, or
 * aborted). If the first turn succeeds, no retry events are emitted at all.
 *
 * Effect-native: consumes {@link RetryRunnerDepsEffect} (Effect-typed callbacks).
 * Run via `Effect.runPromise` at the edge, or composed inside another Effect.
 * {@link executeWithRetry} is the Promise-based back-compat wrapper.
 */
export const executeWithRetryEffect = (
  deps: RetryRunnerDepsEffect,
  settings: RetrySettings,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    deps.logger?.debug("turn attempt", {
      attempt: 0,
      maxRetries: settings.maxRetries,
    });
    let message = yield* deps.runTurn();
    if (!settings.enabled) {
      yield* runCompactionPhaseEffect(deps, message);
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
        { attempt },
      );
      deps.logger?.debug("should retry", {
        attempt,
        maxRetries: settings.maxRetries,
        willRetry: true,
      });

      deps.emit({
        type: "auto_retry_start",
        attempt,
        delayMs,
        errorMessage: message.errorMessage ?? "Unknown error",
        maxAttempts: settings.maxRetries,
      });

      deps.logger?.warn("rolling back leaf", { attempt });
      yield* deps.rollbackLeaf();

      deps.logger?.debug("backoff", { delayMs, attempt });
      const slept = yield* Effect.promise(() => abortableSleep(delayMs, deps.signal));
      if (!slept || deps.signal.aborted) {
        deps.logger?.warn("retry aborted", { attempt });
        deps.emit({
          type: "auto_retry_end",
          success: false,
          attempt,
          ...(message.errorMessage === undefined ? {} : { finalError: message.errorMessage }),
        });
        return;
      }

      deps.logger?.debug("turn attempt", {
        attempt,
        maxRetries: settings.maxRetries,
      });
      message = yield* deps.runTurn();
    }

    if (attempt > 0) {
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
        ...(success ? {} : { finalError: message.errorMessage ?? "Unknown error" }),
      });
    }

    yield* runCompactionPhaseEffect(deps, message);
  });

/**
 * Post-turn compaction Effect: decide → emit start → run → emit end, retrying
 * the turn once on an overflow (`willRetry`).
 */
const runCompactionPhaseEffect = (
  deps: RetryRunnerDepsEffect,
  initialMessage: AssistantMessage,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (deps.checkCompaction === undefined || deps.runCompaction === undefined) {
      return;
    }
    let message = initialMessage;
    let overflowAttempts = 0;
    for (;;) {
      const decision = yield* deps.checkCompaction!(message);
      if (decision.action !== "compact" || decision.reason === undefined) {
        return;
      }
      // decision.action === "compact" only happens for threshold/overflow (the
      // stuck guard returns action "none"). Narrow so the event reason type
      // stays "threshold" | "overflow" — the stuck guard emits no event.
      const reason: "threshold" | "overflow" =
        decision.reason === "overflow" ? "overflow" : "threshold";

      if (reason === "overflow" && overflowAttempts > 0) {
        deps.logger?.error("overflow recovery exhausted", undefined, {
          reason,
        });
        deps.emit({
          type: "compaction_end",
          reason,
          aborted: false,
          willRetry: false,
          errorMessage:
            "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
        });
        return;
      }

      deps.logger?.info("compaction start", { reason });
      deps.emit({ type: "compaction_start", reason });

      const outcome = yield* deps.runCompaction!();
      if (outcome.ok) {
        deps.logger?.info("compaction done", {
          reason,
          tokensBefore: outcome.tokensBefore,
        });
        deps.emit({
          type: "compaction_end",
          reason,
          result: {
            summary: outcome.summary,
            firstKeptEntryId: outcome.firstKeptEntryId,
            tokensBefore: outcome.tokensBefore,
          },
          aborted: false,
          willRetry: decision.willRetry === true,
        });
      } else {
        deps.logger?.error("compaction failed", undefined, {
          reason,
          errorMessage: outcome.errorMessage,
        });
        deps.emit({
          type: "compaction_end",
          reason,
          aborted: false,
          willRetry: false,
          errorMessage: outcome.errorMessage,
        });
        return;
      }

      if (decision.willRetry !== true) {
        return;
      }
      overflowAttempts++;
      message = yield* deps.runTurn();
    }
  });
