import type { JSONObject, LanguageModelV4Usage } from "@ai-sdk/provider";

/**
 * Input shape — accepts the parsed zod shape (where optional fields can be
 * `undefined` as well as `number | null`).
 */
export interface ZaiUsageInput {
  cache_creation_input_tokens?: number | null | undefined;
  cache_read_input_tokens?: number | null | undefined;
  input_tokens: number;
  output_tokens: number;
}

/**
 * # convertZaiUsage — Z.ai usage → V4 `LanguageModelV4Usage`
 *
 * Ported from `@ai-sdk/anthropic/convert-anthropic-usage.ts`, stripped of the
 * iterations/fallback handling (Z.ai surfaces neither).
 *
 * **B1 invariant:** `inputTokens.noCache = input_tokens` (the non-cached
 * subset). The project's `stream.ts:mapUsage` reads this so `calculateCost`
 * doesn't double-charge cached tokens.
 *
 * `cacheWrite1h` is intentionally not surfaced (GLM reports no 1h split);
 * `outputTokens.reasoning` stays `undefined` (Anthropic folds thinking into
 * `output_tokens`).
 */
export function convertZaiUsage({
  usage,
  rawUsage,
}: {
  usage: ZaiUsageInput;
  rawUsage?: JSONObject;
}): LanguageModelV4Usage {
  const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;

  return {
    inputTokens: {
      total: inputTokens + cacheCreationTokens + cacheReadTokens,
      noCache: inputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheCreationTokens,
    },
    outputTokens: {
      total: outputTokens,
      text: undefined,
      reasoning: undefined,
    },
    raw: rawUsage ?? (usage as unknown as JSONObject),
  };
}
