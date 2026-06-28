import type { ThinkingLevel } from "../../types.ts";

/**
 * Per-level thinking-budget map for GLM-on-Z.ai (Anthropic Messages endpoint).
 *
 * ZCode exposes only `max` / `high` / `nothink`; we graduate the 5 tiers so the
 * agent's thinking-level UX maps cleanly. Tunable constant.
 *
 * The minimum (2000) is above Anthropic's 1024-token floor; the maximum
 * (32000) is zcode's `max`. `medium` == `high` matches zcode's `high` preset.
 */
export const ZAI_THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  minimal: 2000,
  low: 8000,
  medium: 16_000,
  high: 16_000,
  xhigh: 32_000,
};
