import type { OpenAICompletionsCompat } from "../types.ts";

/**
 * # Provider-level reasoning compat overrides
 *
 * `@ai-sdk/openai-compatible` is a generic factory — it doesn't know which
 * `providerOptions` shape each OpenAI-compatible provider expects for
 * reasoning. This table fills that gap: it maps models.dev provider ids to
 * the {@link OpenAICompletionsCompat} the transform layer (Phase 3) turns into
 * `providerOptions`.
 *
 * ### Why only `thinkingFormat`
 *
 * pi-ai carried a much larger compat surface (`supportsStore`, `maxTokensField`,
 * `requiresToolResultName`, …) because it hand-wrote the OpenAI completions
 * request. In the @ai-sdk-native world, `@ai-sdk/openai-compatible` handles
 * those request-shape concerns; we only need to tell it how to encode
 * **reasoning**, which is the one thing the generic factory cannot auto-detect.
 *
 * ### Source
 *
 * Each entry's `thinkingFormat` value is carried verbatim from pi-ai's
 * empirical per-provider knowledge (`packages/ai/scripts/generate-models.ts`).
 * Do not invent new values — the 10-value union in
 * {@link OpenAICompletionsCompat.thinkingFormat} is the complete set, and the
 * transform layer has one branch per value.
 *
 * ### First-party providers are absent
 *
 * `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, etc. handle
 * reasoning internally — no compat needed. Only providers routed through
 * `@ai-sdk/openai-compatible` appear here.
 *
 * Providers not in this table default to `{ thinkingFormat: "openai" }`
 * (i.e. `reasoning_effort`) in the converter.
 */
export const PROVIDER_COMPAT: Record<string, OpenAICompletionsCompat> = {
  /**
   * DeepSeek uses `thinking: { type }` + `reasoning_effort`.
   * supportsReasoningEffort: true (pi-ai auto-detection — deepseek is not in
   * the exclusion list at `openai-completions.ts:358-359`).
   */
  deepseek: { supportsReasoningEffort: true, thinkingFormat: "deepseek" },

  /** Z.AI (GLM) uses `thinking: { type: "enabled" }` + optional `reasoning_effort` (glm-5.2 only). */
  "zai-coding-plan": { thinkingFormat: "zai" },
  zai: { thinkingFormat: "zai" },
};

/**
 * The fallback compat for any `@ai-sdk/openai-compatible` provider not listed
 * in {@link PROVIDER_COMPAT}. Standard OpenAI `reasoning_effort`, supported.
 */
export const DEFAULT_OPENAI_COMPAT_COMPAT: OpenAICompletionsCompat = {
  supportsReasoningEffort: true,
  thinkingFormat: "openai",
};
