/**
 * # models.dev JSON shape (minimal subset)
 *
 * The typed view of `https://models.dev/api.json` that the catalog converter
 * reads. Only the fields we consume are declared; everything else passes
 * through as-unknown.
 *
 * Structure: top-level object keyed by provider id, each value is a
 * {@link ModelsDevProvider} with a nested `models` map keyed by model id.
 *
 * @see https://models.dev
 */

/** Per-model cost rates in USD per million tokens. */
export interface ModelsDevCost {
  cache_read?: number;
  cache_write?: number;
  input?: number;
  output?: number;
}

/** Token limits. */
export interface ModelsDevLimit {
  context?: number;
  input?: number;
  output?: number;
}

/** Input/output modality lists (e.g. `["text", "image"]`). */
export interface ModelsDevModalities {
  input?: string[];
  output?: string[];
}

/**
 * Structured reasoning support descriptor.
 * - `{ type: "effort", values: ["low","medium","high"] }` — tiered effort
 * - `{ type: "toggle" }` — on/off, no tiers
 * - `{ type: "disabled" }` — no reasoning
 */
export interface ModelsDevReasoningOption {
  type: "effort" | "toggle" | "disabled";
  values?: string[];
}

/**
 * Per-model entry in models.dev. `tool_call === true` is the gate — the
 * converter drops models that lack it (the agent loop requires tool support).
 *
 * `provider` (optional, model-level) overrides the provider-level `npm`/`api`
 * — used by aggregators like OpenCode Zen where different models on the same
 * provider route through different SDKs.
 */
export interface ModelsDevModel {
  attachment?: boolean;
  cost?: ModelsDevCost;
  family?: string;
  id: string;
  limit?: ModelsDevLimit;
  modalities?: ModelsDevModalities;
  name: string;
  /** Optional SDK/baseURL override at the model level (aggregator providers). */
  provider?: { api?: string; npm?: string };
  reasoning?: boolean;
  reasoning_options?: ModelsDevReasoningOption[];
  release_date?: string;
  status?: "active" | "deprecated" | "alpha";
  /** Gate: the converter drops models where this is not `true`. */
  tool_call?: boolean;
}

/**
 * Per-provider entry in models.dev.
 *
 * `npm` names the `@ai-sdk/*` factory package; `api` is the base URL; `env`
 * lists the conventional env var names that hold the API key (matches our
 * `getEnvApiKey` map).
 */
export interface ModelsDevProvider {
  api?: string;
  doc?: string;
  env?: string[];
  id: string;
  name: string;
  npm?: string;
}

/** Display metadata for a provider, derived from models.dev. */
export interface ProviderInfo {
  doc?: string;
  name: string;
}

/** Top-level shape: `{ "<provider-id>": ModelsDevProvider, ... }`. */
export type ModelsDevCatalog = Record<
  string,
  ModelsDevProvider & { models: Record<string, ModelsDevModel> }
>;
