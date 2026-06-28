import type { ThinkingLevel } from "../../types.ts";

/**
 * Per-level thinking-budget map for GLM-on-Z.ai (Anthropic Messages endpoint).
 *
 * Per `zcode-glm-best-practices.md §2` + the GLM-5.2 spec: GLM-5.2 surfaces
 * exactly two enabled budgets — ZCode's `high` (16 000) and `max` (32 000) —
 * plus `off`. The project's 5-tier `ThinkingLevel` UX collapses onto those
 * two: the lower three tiers map to `high`, the upper two to `max`.
 *
 *   minimal / low / medium  → 16 000  (zcode "high")
 *   high / xhigh            → 32 000  (zcode "max")
 *   off                     → disabled (handled by `buildProviderOptions`)
 */
export const ZAI_THINKING_BUDGETS: Record<ThinkingLevel, number> = {
  minimal: 16_000,
  low: 16_000,
  medium: 16_000,
  high: 32_000,
  xhigh: 32_000,
};
