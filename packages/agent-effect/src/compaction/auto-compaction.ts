import {
  type AssistantMessage,
  isContextOverflow,
  type Model,
} from "@sakti-code/llm";
import { Effect } from "effect";
import {
  type CompactionSettings,
  calculateContextTokens,
  compact,
  estimateContextTokens,
  prepareCompaction,
  shouldCompact,
} from "../compaction.ts";
import type { SessionShape } from "../harness/session.ts";
import type { SessionTreeEntry, ThinkingLevel } from "../harness/types.ts";
import type { AgentMessage } from "../types.ts";

/**
 * # Auto-compaction policy
 *
 * Ports pi's `_checkCompaction` + `_runAutoCompaction` (from
 * `openspec/references/pi/packages/coding-agent/src/core/agent-session.ts`).
 * The agent loop itself does not compact (neither does pi's); this module
 * supplies the per-turn policy (decide + run) and is hooked into the turn
 * loop by the server via {@link CheckCompactionInput} / {@link RunCompactionDeps}.
 *
 * The pure primitives (`shouldCompact`, `estimateContextTokens`,
 * `calculateContextTokens`, `prepareCompaction`, `compact`) live alongside in
 * `../compaction.ts`; this module supplies the policy that calls them per turn.
 *
 * It owns no I/O of its own: persistence goes through the `Session`
 * (`SessionStorage`) interface, and the model + API key are injected by the
 * caller — so it has no dependency on app config (`profiles.json` / `auth.json`).
 *
 * Known limitation (inherited from pi): when the last assistant reports
 * present-but-empty usage (e.g. z.ai's degenerate `finishReason:"other"`
 * turns), the threshold fallback only counts tokens after that message, so a
 * session that spirals into all-empty-usage turns won't trip the threshold. The
 * overflow path catches explicit overflow errors; silent empty-usage spirals
 * need a fresh turn with real usage to re-arm the estimate.
 */

/** Reason the compaction check fired. */
export type CompactionReason = "threshold" | "overflow";

/** Outcome of {@link checkCompaction} — a pure decision over inputs. */
export interface CompactionDecision {
  action: "none" | "compact";
  reason?: CompactionReason;
  /** True when an overflowed turn should be retried after compaction. */
  willRetry?: boolean;
}

/** Inputs to {@link checkCompaction}. All pure — no I/O. */
export interface CheckCompactionInput {
  /** The current model's context window; 0 if unknown (disables threshold). */
  contextWindow: number;
  /**
   * Timestamp (ms) of the latest compaction entry, if any. A turn whose message
   * predates it is skipped so stale pre-compaction usage can't retrigger.
   */
  latestCompactionTimestamp?: number;
  /** The assistant message produced by the just-finished turn. */
  message: AssistantMessage;
  /** The full live transcript (for the zero-usage estimate fallback). */
  messages: AgentMessage[];
  /** Resolved compaction settings. */
  settings: CompactionSettings;
}

/**
 * Decide whether the just-finished turn needs compaction. `[PORT]` of pi's
 * `_checkCompaction` (agent-session.ts:1816): enabled guard → skip aborted →
 * stale-usage guard → overflow (`isContextOverflow`, `willRetry =
 * stopReason !== "stop"`) → threshold with the zero-usage fallback.
 */
export function checkCompaction(
  input: CheckCompactionInput
): CompactionDecision {
  const { message, settings } = input;

  if (!settings.enabled) {
    return { action: "none" };
  }

  // Post-turn hook always skips aborted turns (pi's default skipAbortedCheck).
  if (message.stopReason === "aborted") {
    return { action: "none" };
  }

  // Stale-usage guard: a message older than the latest compaction boundary
  // carries pre-compaction usage and must not retrigger.
  if (
    input.latestCompactionTimestamp !== undefined &&
    message.timestamp <= input.latestCompactionTimestamp
  ) {
    return { action: "none" };
  }

  // Case 1: overflow. willRetry is false for a silent stop-overflow (the answer
  // already completed; continue() can't resume from it) and true for an error.
  if (
    input.contextWindow > 0 &&
    isContextOverflow(message, input.contextWindow)
  ) {
    return {
      action: "compact",
      reason: "overflow",
      willRetry: message.stopReason !== "stop",
    };
  }
  // Overflow can also be an explicit error even without a known window (error
  // message patterns don't need contextWindow).
  if (input.contextWindow === 0 && isContextOverflow(message)) {
    return {
      action: "compact",
      reason: "overflow",
      willRetry: message.stopReason !== "stop",
    };
  }

  if (input.contextWindow <= 0) {
    return { action: "none" };
  }

  // Case 2: threshold. For error/zero-usage messages, estimate from the
  // transcript so persistent API failures or malformed zero-usage responses can
  // still compact (pi agent-session.ts:1876-1900).
  const directContextTokens = message.usage
    ? calculateContextTokens(message.usage)
    : 0;
  let contextTokens: number;
  if (message.stopReason === "error" || directContextTokens === 0) {
    const estimate = estimateContextTokens(input.messages);
    if (estimate.lastUsageIndex === null) {
      return { action: "none" }; // No usage data at all.
    }
    const usageMsg = input.messages[estimate.lastUsageIndex];
    if (
      usageMsg !== undefined &&
      input.latestCompactionTimestamp !== undefined &&
      usageMsg.role === "assistant" &&
      (usageMsg as AssistantMessage).timestamp <=
        input.latestCompactionTimestamp
    ) {
      return { action: "none" }; // Usage source is pre-compaction (stale).
    }
    contextTokens = estimate.tokens;
  } else {
    contextTokens = directContextTokens;
  }

  if (shouldCompact(contextTokens, input.contextWindow, settings)) {
    return { action: "compact", reason: "threshold", willRetry: false };
  }
  return { action: "none" };
}

/** Dependencies for {@link runAutoCompaction} — the actual summary + persist. */
export interface RunCompactionDeps {
  apiKey: string;
  model: Model;
  session: SessionShape;
  settings: CompactionSettings;
  thinkingLevel?: ThinkingLevel;
}

/** Outcome of a compaction run. */
export type RunCompactionOutcome =
  | {
      ok: true;
      summary: string;
      firstKeptEntryId: string;
      tokensBefore: number;
    }
  | { ok: false; errorMessage: string };

/**
 * Run one compaction: prepare → summarize (LLM) → persist. `[PORT]` of pi's
 * `_runAutoCompaction` (minus extension hooks; sakti has no extension system).
 * Uses the standalone `compact()` (not `harness.compact()`, which is idle-gated
 * and can't run mid-loop) and persists via `session.appendCompaction()`. The
 * harness rebuilds context from storage next turn, so no in-place message
 * mutation is needed (unlike pi).
 */
// @migration TODO: remove when auto-compaction.ts migrates to Effect (Phase Compaction)
export async function runAutoCompaction(
  deps: RunCompactionDeps
): Promise<RunCompactionOutcome> {
  const entries: SessionTreeEntry[] = await Effect.runPromise(
    deps.session.getBranch()
  );
  const preparation = prepareCompaction(entries, deps.settings);
  if (!preparation.ok) {
    return { ok: false, errorMessage: preparation.error.message };
  }
  if (!preparation.value) {
    return { ok: false, errorMessage: "Nothing to compact" };
  }

  const result = await compact(
    preparation.value,
    deps.model,
    deps.apiKey,
    undefined,
    undefined,
    undefined,
    deps.thinkingLevel
  );
  if (!result.ok) {
    return { ok: false, errorMessage: result.error.message };
  }

  await Effect.runPromise(
    deps.session.appendCompaction(
      result.value.summary,
      result.value.firstKeptEntryId,
      result.value.tokensBefore,
      result.value.details
    )
  );

  return {
    ok: true,
    summary: result.value.summary,
    firstKeptEntryId: result.value.firstKeptEntryId,
    tokensBefore: result.value.tokensBefore,
  };
}

/**
 * Parse compaction settings from the flat session-settings KV. `[PORT]` of pi's
 * `getCompactionSettings` (settings-manager.ts:754). Defaults are pi-faithful
 * (enabled true, reserve 16384, keepRecent 20000). The legacy `auto_compaction`
 * key (previously dead config) is resurrected as the enabled toggle.
 */
export function parseCompactionSettings(
  settings: Record<string, string>
): CompactionSettings {
  return {
    enabled: settings.auto_compaction !== "false",
    reserveTokens: Number.parseInt(
      settings.compaction_reserve_tokens ?? "16384",
      10
    ),
    keepRecentTokens: Number.parseInt(
      settings.compaction_keep_recent_tokens ?? "20000",
      10
    ),
  };
}
