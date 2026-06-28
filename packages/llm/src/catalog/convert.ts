import type { Model, OpenAICompletionsCompat } from "../types.ts";
import { DEFAULT_OPENAI_COMPAT_COMPAT, PROVIDER_COMPAT } from "./compat.ts";
import type { ModelsDevModel, ModelsDevProvider } from "./types.ts";

/**
 * The factory package for generic OpenAI-compatible providers. Models whose
 * `npm` resolves to this need our help to encode reasoning (see
 * {@link PROVIDER_COMPAT}); everything else is handled by its first-party
 * `@ai-sdk/*` factory.
 */
const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";

/**
 * Convert a models.dev model entry into our {@link Model} descriptor.
 *
 * Ports opencode's `fromModelsDevModel` (`provider/provider.ts:1188-1231`)
 * to plain TS, mapping to our `Model<"ai-sdk">` shape. Returns `null` when
 * the model lacks `tool_call: true` — the agent loop requires tool support,
 * so non-tool models are dropped at catalog generation time.
 *
 * ### Field mapping
 * - `id`, `name` ← verbatim from models.dev
 * - `api` ← literal `"ai-sdk"` (every model routes through an @ai-sdk factory)
 * - `provider` ← `provider.id`
 * - `baseUrl` ← `provider.api` (model-level `provider.api` overrides for aggregators)
 * - `npm` ← `model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible"`
 * - `reasoning` ← `model.reasoning ?? false`
 * - `input` ← `["text"]`, plus `"image"` when `modalities.input` includes it
 * - `cost` ← snake_case → camelCase rename (`cache_read` → `cacheRead`)
 * - `contextWindow` ← `limit.context`, `maxTokens` ← `limit.output`
 * - `compat` ← see {@link resolveCompat}
 */
export function convertModelsDevModel(
  provider: ModelsDevProvider,
  model: ModelsDevModel
): Model | null {
  // Gate: the agent loop requires tool support, so drop any model that isn't
  // confirmed tool-capable. models.dev always emits tool_call (verified
  // empirically: 5308/5308 models), so in practice this drops the ~1150
  // models with tool_call === false. opencode keeps non-tool models because
  // it supports plain-chat modes; we drop them because our agent can't drive
  // them. Not a bug — a deliberate tool-only-agent constraint. (B3)
  if (model.tool_call !== true) {
    return null;
  }

  // model.provider (aggregator override) wins over the provider-level fields.
  const npm = model.provider?.npm ?? provider.npm ?? OPENAI_COMPATIBLE_NPM;
  const baseUrl = model.provider?.api ?? provider.api ?? "";

  const input: ("text" | "image")[] = model.modalities?.input?.includes("image")
    ? ["text", "image"]
    : ["text"];

  // Resolve once so the conditional spread narrows `undefined` out cleanly
  // (exactOptionalPropertyTypes rejects double-call ternaries here).
  const compat = resolveCompat(provider.id, npm);

  const converted: Model = {
    api: "ai-sdk",
    baseUrl,
    contextWindow: model.limit?.context ?? 4096,
    cost: {
      cacheRead: model.cost?.cache_read ?? 0,
      cacheWrite: model.cost?.cache_write ?? 0,
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
    },
    id: model.id,
    input,
    maxTokens: model.limit?.output ?? 4096,
    name: model.name,
    npm,
    provider: provider.id,
    reasoning: model.reasoning === true,
    ...(model.status ? { status: model.status } : {}),
    ...(compat ? { compat } : {}),
  };

  return applyZaiAnthropicOverride(provider.id, converted);
}

/**
 * Repoint `zai` / `zai-coding-plan` providers to the hand-rolled
 * `@sakti-code/zai-anthropic` factory + Z.ai's Anthropic-compatible baseURL,
 * and drop the openai-compat `compat` block (our model reads `providerOptions.zai`
 * directly). All other providers stay on whatever models.dev chose.
 *
 * Survives regeneration because it lives in the generator. See design doc
 * §"Catalog override (choice: G — generation-time)".
 */
function applyZaiAnthropicOverride(providerId: string, model: Model): Model {
  if (providerId !== "zai" && providerId !== "zai-coding-plan") {
    return model;
  }
  // Both zai and zai-coding-plan use the SAME Anthropic endpoint; the
  // coding-plan vs regular subscription is selected by API key, not URL path.
  // (We previously tried https://api.z.ai/api/coding/anthropic — 404s.)
  const { compat: _compat, ...rest } = model;
  return {
    ...rest,
    npm: "@sakti-code/zai-anthropic",
    baseUrl: "https://api.z.ai/api/anthropic",
  };
}

/**
 * Resolve the {@link OpenAICompletionsCompat} for a model, if any.
 *
 * - First-party `@ai-sdk/*` factories (anything other than
 *   `@ai-sdk/openai-compatible`) handle reasoning internally → no compat.
 * - `@ai-sdk/openai-compatible` providers get compat from
 *   {@link PROVIDER_COMPAT}, falling back to the standard OpenAI
 *   `reasoning_effort` shape ({@link DEFAULT_OPENAI_COMPAT_COMPAT}).
 *
 * Returns `undefined` when no compat is needed (first-party providers).
 */
function resolveCompat(
  providerId: string,
  npm: string
): OpenAICompletionsCompat | undefined {
  if (npm !== OPENAI_COMPATIBLE_NPM) {
    return;
  }
  return PROVIDER_COMPAT[providerId] ?? DEFAULT_OPENAI_COMPAT_COMPAT;
}
