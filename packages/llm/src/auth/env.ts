import type { ProviderEnv } from "../types.ts";

/**
 * # Environment API-key resolution
 *
 * Maps provider ids to the conventional env var that holds their API key
 * (e.g. `openai` → `OPENAI_API_KEY`, `anthropic` → `ANTHROPIC_API_KEY`).
 *
 * Ported from pi-ai (`packages/ai/src/env-api-keys.ts`). Two things were
 * dropped in the port:
 *
 * 1. **Bun sandbox fallback** — pi-ai reads `/proc/self/environ` to work
 *    around a Bun-compiled-binary bug. sakti-code runs on Node via nub, so
 *    `process.env` is always authoritative.
 * 2. **Ambient credential checks for Vertex (ADC) and Bedrock (AWS profiles)**
 *    — pi-ai probed `~/.config/gcloud/…` and `AWS_*` env vars itself. In the
 *    @ai-sdk-native world, `@ai-sdk/google-vertex` and `@ai-sdk/amazon-bedrock`
 *    resolve those ambient sources internally, so packages/llm only needs to
 *    surface explicit API keys.
 */

/**
 * Resolve a provider env value: scoped overrides win over `process.env`.
 *
 * Uses `||` (not `??`) so empty strings count as unset — matches pi-ai
 * semantics where an empty env var is treated as "not configured".
 *
 * @param name - env var name, e.g. `"OPENAI_API_KEY"`
 * @param env - optional provider-scoped overrides (takes precedence)
 */
function getProviderEnvValue(
  name: string,
  env?: ProviderEnv
): string | undefined {
  return (
    env?.[name] ||
    (typeof process === "undefined" ? undefined : process.env[name]) ||
    undefined
  );
}

/**
 * Known API-key environment variables per provider.
 *
 * Returns the candidate env var names in **precedence order** — the first set
 * value wins. Two providers have multi-variable precedence:
 * - `anthropic` → `ANTHROPIC_OAUTH_TOKEN` (Pro/Max OAuth) wins over `ANTHROPIC_API_KEY`
 * - `github-copilot` → `COPILOT_GITHUB_TOKEN`
 *
 * Every other provider maps 1:1. Verbatim mapping from pi-ai; do not reorder
 * entries without confirming the provider's documented env var name.
 *
 * Returns `undefined` for unknown providers (no env var to check).
 */
function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
  // GitHub Copilot uses a single GitHub token, not a provider-specific key.
  if (provider === "github-copilot") {
    return ["COPILOT_GITHUB_TOKEN"];
  }

  // Anthropic: an OAuth token (from Claude Pro/Max login) takes precedence
  // over a raw API key. Both authenticate the same `@ai-sdk/anthropic` factory.
  if (provider === "anthropic") {
    return ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];
  }

  // 1:1 provider → env var map. Order doesn't matter here (one entry each);
  // kept alphabetical-ish by provider for skim-ability.
  const envMap: Record<string, string> = {
    "ant-ling": "ANT_LING_API_KEY",
    "azure-openai-responses": "AZURE_OPENAI_API_KEY",
    "cloudflare-ai-gateway": "CLOUDFLARE_API_KEY",
    "cloudflare-workers-ai": "CLOUDFLARE_API_KEY",
    cerebras: "CEREBRAS_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    "fireworks-ai": "FIREWORKS_API_KEY",
    google: "GEMINI_API_KEY",
    "google-vertex": "GOOGLE_CLOUD_API_KEY",
    // HF uses the generic token env var, not a provider-namespaced one.
    huggingface: "HF_TOKEN",
    "kimi-coding": "KIMI_API_KEY",
    "minimax-cn": "MINIMAX_CN_API_KEY",
    minimax: "MINIMAX_API_KEY",
    "moonshotai-cn": "MOONSHOT_API_KEY",
    // CN variant shares the same env var as the international Moonshot API.
    moonshotai: "MOONSHOT_API_KEY",
    mistral: "MISTRAL_API_KEY",
    nvidia: "NVIDIA_API_KEY",
    openai: "OPENAI_API_KEY",
    "opencode-go": "OPENCODE_API_KEY",
    // Both opencode variants share one env var.
    opencode: "OPENCODE_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    togetherai: "TOGETHER_API_KEY",
    "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
    xai: "XAI_API_KEY",
    "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
    "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
    "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
    xiaomi: "XIAOMI_API_KEY",
    "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
    zai: "ZAI_API_KEY",
  };

  const envVar = envMap[provider];
  return envVar ? [envVar] : undefined;
}

/**
 * Find which env vars for a provider are currently configured.
 *
 * Returns the subset of the provider's candidate env vars (in precedence
 * order) that have a non-empty value. Used by the status UI to show "this
 * provider is configured via X" without exposing the key itself.
 *
 * Returns `undefined` for unknown providers OR when none of the candidate
 * vars are set.
 *
 * @example
 *   findEnvKeys("anthropic") // → ["ANTHROPIC_API_KEY"] (only API_KEY set)
 *   findEnvKeys("anthropic") // → ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"] (both set)
 */
export function findEnvKeys(
  provider: string,
  env?: ProviderEnv
): string[] | undefined {
  const envVars = getApiKeyEnvVars(provider);
  if (!envVars) {
    return;
  }

  const found = envVars.filter((envVar) => !!getProviderEnvValue(envVar, env));
  return found.length > 0 ? found : undefined;
}

/**
 * Resolve an API key for a provider from environment variables.
 *
 * Returns the value of the **first** configured env var in the provider's
 * precedence order (so `ANTHROPIC_OAUTH_TOKEN` wins over `ANTHROPIC_API_KEY`
 * when both are set). Returns `undefined` for unknown providers or when no
 * candidate var is set.
 *
 * This only resolves explicit API keys. Ambient credentials (AWS profiles,
 * Google ADC) are resolved internally by the `@ai-sdk/*` factory at stream
 * time — not our concern here.
 *
 * @example
 *   getEnvApiKey("openai") // → process.env.OPENAI_API_KEY
 *   getEnvApiKey("anthropic") // → ANTHROPIC_OAUTH_TOKEN ?? ANTHROPIC_API_KEY
 */
export function getEnvApiKey(
  provider: string,
  env?: ProviderEnv
): string | undefined {
  const envKeys = findEnvKeys(provider, env);
  if (envKeys?.[0]) {
    return getProviderEnvValue(envKeys[0], env);
  }
  return;
}
