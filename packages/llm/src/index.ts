/**
 * # `@sakti-code/llm` — @ai-sdk-native LLM runtime
 *
 * The greenfield successor to `@earendil-works/pi-ai`. Routes every provider
 * through `@ai-sdk/*` factories driven by models.dev's `npm` field, so there
 * is zero hand-written per-provider API code.
 *
 * ## Package layout
 *
 * ```
 * src/
 * ├─ types.ts          message contract + Model descriptor (Phase 1 ✓)
 * ├─ auth/
 * │   ├─ types.ts      ModelAuth / AuthResult (Phase 1 ✓)
 * │   └─ env.ts        getEnvApiKey / findEnvKeys (Phase 1 ✓)
 * ├─ cost.ts           calculateCost (Phase 1 ✓)
 * ├─ catalog/
 * │   ├─ types.ts      models.dev JSON shape (Phase 1 ✓)
 * │   ├─ convert.ts    convertModelsDevModel (Phase 1 ✓)
 * │   ├─ compat.ts     PROVIDER_COMPAT thinkingFormat table (Phase 1 ✓)
 * │   ├─ generated.ts  4147 models / 142 providers (committed; regenerated)
 * │   └─ index.ts      catalog entry point (Phase 1 ✓)
 * ├─ provider/         BUNDLED_PROVIDERS + resolveLanguageModel (Phase 2)
 * │   └─ transform.ts  buildProviderOptions from compat (Phase 3)
 * ├─ messages.ts       Message[] → @ai-sdk CoreMessage[] (Phase 4)
 * └─ stream.ts         stream(req) → { fullStream, result } (Phase 4)
 * ```
 *
 * ## What the agent imports
 *
 * The agent loop imports message types + `stream` from here, then iterates
 * `stream(...).fullStream` natively. No `AssistantMessageEvent` protocol, no
 * adapter — that was the whole point of the pivot.
 *
 * @see docs/plans/2026-06-25-sakti-llm-ai-sdk-native.md
 */

// Auth: env-key resolution. Full login/OAuth orchestration is server-owned.
export { findEnvKeys, getEnvApiKey } from "./auth/env.ts";
export type { AuthResult, ModelAuth } from "./auth/types.ts";
// Generated model catalog from models.dev (142 providers, matches opencode).
export { ALL_MODELS, CATALOG, PROVIDERS } from "./catalog/index.ts";
// Cost computation (mutates usage.cost in place; Anthropic 1h cache premium).
export { calculateCost } from "./cost.ts";
// Message conversion: Message[] → @ai-sdk ModelMessage[].
export { toModelMessages } from "./messages.ts";
export type {
  ProviderFactory,
  ProviderFactoryLoader,
  ProviderFactoryOptions,
  ProviderSDK,
} from "./provider/registry.ts";
// Provider resolution: Model + auth → @ai-sdk LanguageModelV3.
export { BUNDLED_PROVIDERS } from "./provider/registry.ts";
export type { ResolveOptions } from "./provider/resolve.ts";
export {
  clearResolveCache,
  resolveBaseURL,
  resolveLanguageModel,
} from "./provider/resolve.ts";
// Compat transform: thinkingFormat → providerOptions + session-affinity headers.
export { buildHeaders, buildProviderOptions } from "./provider/transform.ts";
export type { FinishResult, StreamRequest, StreamResult } from "./stream.ts";
// Stream entry point: the single function the agent loop calls.
export {
  mapFinishReason,
  mapUsage,
  stream,
  streamWithModel,
} from "./stream.ts";
// Message contract + Model descriptor (the shapes ~20 consumers depend on).
export * from "./types.ts";
