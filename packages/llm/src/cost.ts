import type { Model, Usage } from "./types.ts";

/**
 * Compute and populate `usage.cost.*` from the model's rates and the token
 * counts in `usage`. Mutates `usage.cost` in place and returns the same
 * reference — callers that just need the value read the return; callers that
 * hold the `usage` object see the cost populated either way.
 *
 * Ported verbatim from pi-ai (`packages/ai/src/models.ts:385-395`). The
 * generic `<TApi>` parameter is gone — our {@link Model} is non-generic in
 * the ai-sdk-only world.
 *
 * ## Anthropic 1h cache writes
 *
 * Anthropic splits `cacheWrite` into short-retention (default) and 1h-
 * retention writes. The 1h writes are charged at **2× the base input rate**,
 * not the cacheWrite rate. When `usage.cacheWrite1h` is set, this function
 * applies that 2× premium to the long-retention portion:
 *
 * ```
 * shortWrite = cacheWrite - cacheWrite1h     // at cacheWrite rate
 * longWrite  = cacheWrite1h                  // at 2 × input rate
 * cacheWrite cost = (cacheWriteRate × shortWrite + inputRate × 2 × longWrite) / 1e6
 * ```
 *
 * Only Anthropic reports `cacheWrite1h`; for every other provider it's
 * absent and all writes use the standard cacheWrite rate.
 *
 * @param model - carries the $/million-token rates
 * @param usage - carries the token counts; `usage.cost` is populated in place
 * @returns `usage.cost` (same reference, for convenience)
 */
export function calculateCost(model: Model, usage: Usage): Usage["cost"] {
  // Anthropic charges 2x base input for 1h cache writes.
  const longWrite = usage.cacheWrite1h ?? 0;
  const shortWrite = usage.cacheWrite - longWrite;

  usage.cost.input = (model.cost.input / 1_000_000) * usage.input;
  usage.cost.output = (model.cost.output / 1_000_000) * usage.output;
  usage.cost.cacheRead = (model.cost.cacheRead / 1_000_000) * usage.cacheRead;
  usage.cost.cacheWrite =
    (model.cost.cacheWrite * shortWrite + model.cost.input * 2 * longWrite) /
    1_000_000;
  usage.cost.total =
    usage.cost.input +
    usage.cost.output +
    usage.cost.cacheRead +
    usage.cost.cacheWrite;

  return usage.cost;
}
