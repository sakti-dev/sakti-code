/**
 * Intent-based loop control for XState agent orchestration
 *
 * This module provides loop control logic that prioritizes agent intent
 * (finishReason) over hard iteration limits. Safety limits are only
 * used as doom loop protection.
 */

import { createLogger } from "@ekacode/shared/logger";
import type { BuildPhase, LoopControlResult, PlanPhase } from "./types";
import { PHASE_SAFETY_LIMITS } from "./types";

const logger = createLogger("core:loop-control");

// Re-export safety limits for convenience
export { PHASE_SAFETY_LIMITS };

/**
 * Check loop control based on finishReason and iteration count
 *
 * Primary signal: finishReason from the LLM
 * - 'stop' → Agent is done (no more tools needed)
 * - 'tool-calls' → Agent wants to continue (has more work)
 * - null/undefined → Still streaming/thinking
 *
 * Safety signal: iteration count (doom loop protection only)
 * - Reaching safety limit indicates a potential bug or doom loop
 * - Agents should rarely hit these limits if working correctly
 *
 * @param params - Loop control parameters
 * @returns Whether to continue and the reason
 */
export function checkLoopControl(params: {
  iterationCount: number;
  finishReason: string | null | undefined;
  safetyLimit: number;
  phaseName: PlanPhase | BuildPhase | string;
}): LoopControlResult {
  const { iterationCount, finishReason, safetyLimit, phaseName } = params;

  // Primary: Let agent decide when done via finishReason
  if (finishReason === "stop") {
    return { shouldContinue: false, reason: "Agent signaled completion" };
  }

  if (finishReason === "tool-calls") {
    return { shouldContinue: true, reason: "Agent has more tool calls" };
  }

  // Safety: Doom loop protection (should rarely hit this)
  // Check this before the "still streaming" case to catch doom loops
  if (iterationCount >= safetyLimit) {
    logger.warn(`⚠️ ${phaseName} hit safety limit (${safetyLimit}), possible doom loop`, {
      phase: phaseName,
      iterationCount,
      safetyLimit,
    });
    return { shouldContinue: false, reason: "Safety limit reached" };
  }

  // Still streaming or no finish reason yet
  if (finishReason === null || finishReason === undefined) {
    return { shouldContinue: true, reason: "Still streaming" };
  }

  // Default: Continue if no finish reason yet
  return { shouldContinue: true, reason: "No finish reason yet" };
}
