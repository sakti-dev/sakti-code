import type { LanguageModelV4 } from "@ai-sdk/provider";
import { createZai } from "./zai-anthropic/index.ts";

/**
 * # Provider factory registry
 *
 * Maps `@ai-sdk/*` npm package names to lazy factory loaders. Each loader
 * dynamic-imports its package and returns the `create*` factory function.
 * The resolver ({@link ../resolve.ts}) looks up a model's `npm` field here,
 * falling back to a dynamic import of the raw package name when no entry
 * exists (for providers whose packages aren't bundled).
 *
 * Ported from opencode's `BUNDLED_PROVIDERS` (`provider/provider.ts:107-134`).
 * Every catalog npm package now has an explicit entry — no dynamic-import
 * fallback needed for catalog models.
 */

/**
 * A resolved provider SDK instance — the result of calling a factory. The
 * `languageModel(id)` method returns the @ai-sdk `LanguageModelV4` that gets
 * passed to `streamText`.
 *
 * `chat`/`responses` are optional sub-selection methods some providers expose
 * (Azure, OpenAI). The default `languageModel` path covers every provider.
 */
export interface ProviderSDK {
  languageModel(modelId: string): LanguageModelV4;
}

/**
 * Options passed to a provider factory when creating an SDK instance. These
 * are the common fields every `create*` factory accepts; provider-specific
 * extras flow through the index signature.
 */
export interface ProviderFactoryOptions {
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  /**
   * Model output-token ceiling (matches `Model.maxTokens`). Optional —
   * factories may use it to enforce a hard cap or reserve headroom (e.g. the
   * Z.ai provider reserves a slice for compaction output per
   * `zcode-glm-best-practices.md §4`).
   */
  maxTokens?: number;
  /** Provider display name (matches `Model.provider`). */
  name?: string;
  [key: string]: unknown;
}

/** A factory function: options → SDK instance. */
export type ProviderFactory = (opts: ProviderFactoryOptions) => ProviderSDK;

/** Lazy loader: dynamic-imports the package and returns its factory. */
export type ProviderFactoryLoader = () => Promise<ProviderFactory>;

/**
 * The bundled provider registry. Each value is a thunk so the heavy
 * `import("@ai-sdk/…")` only runs when that provider is actually used (first
 * request to a model on that provider).
 *
 * Each factory is cast to {@link ProviderFactory} because the @ai-sdk packages
 * declare specific, incompatible settings types (e.g. `createOpenAICompatible`
 * requires `baseURL`; `createAnthropic` does not). At the dispatch layer we
 * construct options uniformly from the model descriptor, and the catalog
 * guarantees the required fields per provider. The cast is the boundary where
 * provider-specific types give way to our uniform dispatch.
 *
 * The factory export names (`createAnthropic`, `createOpenAI`, …) are the
 * canonical @ai-sdk convention — verified against the installed packages'
 * `.d.ts` exports.
 */
export const BUNDLED_PROVIDERS: Record<string, ProviderFactoryLoader> = {
  "@ai-sdk/amazon-bedrock": () =>
    import("@ai-sdk/amazon-bedrock").then((m) => m.createAmazonBedrock as ProviderFactory),
  "@ai-sdk/amazon-bedrock/mantle": () =>
    import("@ai-sdk/amazon-bedrock/mantle").then((m) => m.createBedrockMantle as ProviderFactory),
  "@ai-sdk/anthropic": () =>
    import("@ai-sdk/anthropic").then((m) => m.createAnthropic as ProviderFactory),
  "@ai-sdk/azure": () => import("@ai-sdk/azure").then((m) => m.createAzure as ProviderFactory),
  "@ai-sdk/cerebras": () =>
    import("@ai-sdk/cerebras").then((m) => m.createCerebras as unknown as ProviderFactory),
  "@ai-sdk/cohere": () =>
    import("@ai-sdk/cohere").then((m) => m.createCohere as unknown as ProviderFactory),
  "@ai-sdk/deepinfra": () =>
    import("@ai-sdk/deepinfra").then((m) => m.createDeepInfra as unknown as ProviderFactory),
  // Vercel AI Gateway — createGateway is the package's alias for createGatewayProvider.
  "@ai-sdk/gateway": () =>
    import("@ai-sdk/gateway").then((m) => m.createGateway as ProviderFactory),
  "@ai-sdk/google": () =>
    import("@ai-sdk/google").then((m) => m.createGoogleGenerativeAI as ProviderFactory),
  "@ai-sdk/google-vertex": () =>
    import("@ai-sdk/google-vertex").then((m) => m.createVertex as ProviderFactory),
  // Vertex Anthropic models (Claude on GCP) — separate subpath export.
  "@ai-sdk/google-vertex/anthropic": () =>
    import("@ai-sdk/google-vertex/anthropic").then(
      (m) => m.createVertexAnthropic as ProviderFactory,
    ),
  "@ai-sdk/groq": () =>
    import("@ai-sdk/groq").then((m) => m.createGroq as unknown as ProviderFactory),
  "@ai-sdk/mistral": () =>
    import("@ai-sdk/mistral").then((m) => m.createMistral as ProviderFactory),
  "@ai-sdk/openai": () => import("@ai-sdk/openai").then((m) => m.createOpenAI as ProviderFactory),
  // The generic OpenAI-compatible factory — used by ~100 providers in the catalog
  // (deepseek, groq, zai, togetherai, etc.) that don't have a first-party @ai-sdk package.
  "@ai-sdk/openai-compatible": () =>
    import("@ai-sdk/openai-compatible").then((m) => m.createOpenAICompatible as ProviderFactory),
  "@ai-sdk/togetherai": () =>
    import("@ai-sdk/togetherai").then((m) => m.createTogetherAI as unknown as ProviderFactory),
  "@ai-sdk/vercel": () =>
    import("@ai-sdk/vercel").then((m) => m.createVercel as unknown as ProviderFactory),
  "@ai-sdk/xai": () => import("@ai-sdk/xai").then((m) => m.createXai as ProviderFactory),

  // Hand-rolled Z.ai Anthropic Messages provider (target zai/zai-coding-plan).
  // Local code (not a dynamic import) — speak Anthropic Messages to Z.ai's
  // anthropic-compatible endpoint with Z.ai-native speed/output_config.
  "@sakti-code/zai-anthropic": () => Promise.resolve(createZai as ProviderFactory),

  // Third-party provider packages
  "@openrouter/ai-sdk-provider": () =>
    import("@openrouter/ai-sdk-provider").then(
      (m) => m.createOpenRouter as unknown as ProviderFactory,
    ),
  "merge-gateway-ai-sdk-provider": () =>
    import("merge-gateway-ai-sdk-provider").then(
      (m) => m.createMergeGateway as unknown as ProviderFactory,
    ),
  "venice-ai-sdk-provider": () =>
    import("venice-ai-sdk-provider").then((m) => m.createVenice as unknown as ProviderFactory),
  "@aihubmix/ai-sdk-provider": () =>
    import("@aihubmix/ai-sdk-provider").then((m) => m.createAihubmix as unknown as ProviderFactory),
  "ai-gateway-provider": () =>
    import("ai-gateway-provider").then((m) => m.createAiGateway as unknown as ProviderFactory),
  "@jerome-benoit/sap-ai-provider-v2": () =>
    import("@jerome-benoit/sap-ai-provider-v2").then(
      (m) => m.createSAPAIProvider as unknown as ProviderFactory,
    ),
  "gitlab-ai-provider": () =>
    import("gitlab-ai-provider").then((m) => m.createGitLab as unknown as ProviderFactory),
};
