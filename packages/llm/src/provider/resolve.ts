import type { LanguageModelV3, LanguageModelV4 } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import type { Model } from "../types.ts";
import type {
  ProviderFactory,
  ProviderFactoryLoader,
  ProviderFactoryOptions,
  ProviderSDK,
} from "./registry.ts";
import { BUNDLED_PROVIDERS } from "./registry.ts";

/**
 * # Provider resolution
 *
 * Turns a {@link Model} descriptor + auth options into an @ai-sdk
 * `LanguageModelV4` ready for `streamText`. This is the @ai-sdk-native
 * replacement for pi-ai's per-provider stream dispatch — there is no
 * per-API implementation module; every provider routes through its
 * `@ai-sdk/*` factory.
 *
 * Ports opencode's `resolveSDK` (`provider/provider.ts:1639-1771`) +
 * `getLanguage` (`:1801-1829`) to plain TS. Dropped:
 * - opencode's `Instance`/`State`/Effect plumbing → plain function + cache map.
 * - opencode's custom `fetch` SSE wrapper (`:1703-1734`) → `@ai-sdk/*` handles fetch.
 * - opencode's `Npm.add` auto-install → assume the package is present (clear
 *   error if not).
 * - opencode's custom `modelLoaders` plugin hooks → not applicable.
 *
 * ## Caching
 *
 * SDK instances are cached per `npm + factory-options` pair so repeated
 * requests to the same provider reuse the HTTP client / auth state. The
 * `LanguageModelV4` itself is NOT cached (it's a cheap lookup on the SDK).
 * Call {@link clearResolveCache} in tests to isolate.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Caller-supplied resolution options. These take precedence over the model's
 * own fields (e.g. `options.baseURL` wins over `model.baseUrl`).
 */
export interface ResolveOptions {
  /** API key for the provider. Wins over env resolution. */
  apiKey?: string;
  /** Override base URL. Wins over `model.baseUrl`. */
  baseURL?: string;
  /**
   * Env map for `${VAR}` substitution in the base URL (e.g. Cloudflare's
   * `${CLOUDFLARE_ACCOUNT_ID}`). Defaults to `process.env` when unset.
   */
  env?: Record<string, string | undefined>;
  /** Extra HTTP headers (merged with `model.headers`; model wins on conflict). */
  headers?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Matches `${VAR}` placeholders in a base URL for env substitution. */
const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Resolve `${VAR}` placeholders in a URL from an env map.
 *
 * - `${VAR}` → the env value when present.
 * - `${VAR}` → left as-is when the env has no value (lets the provider SDK
 *   handle the missing value, matching opencode's behavior at `:1678-1681`).
 * - Empty/whitespace URL → `undefined` (signals "use the factory default").
 *
 * Ported from opencode's baseURL resolution (`provider.ts:1664-1683`).
 */
export function resolveBaseURL(
  url: string,
  env: Record<string, string | undefined>,
): string | undefined {
  if (!url) {
    return;
  }
  return url.replace(ENV_VAR_PATTERN, (placeholder, key: string) => {
    const value = env[key];
    return value ?? placeholder;
  });
}

/**
 * Merge headers: options headers first, model headers override on conflict.
 *
 * Matches opencode's merge order (`provider.ts:1687-1691`): the caller's
 * per-request headers supplement the model's static headers, but the model's
 * static headers win when both set the same name (they carry provider-correct
 * values like Copilot's `Editor-Version`).
 */
function mergeHeaders(
  modelHeaders: Record<string, string> | undefined,
  optionsHeaders: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!(modelHeaders || optionsHeaders)) {
    return;
  }
  return { ...optionsHeaders, ...modelHeaders };
}

/**
 * Build the options object passed to the provider factory, applying base URL
 * resolution, apiKey, and header merge.
 */
function buildFactoryOptions(model: Model, options: ResolveOptions): ProviderFactoryOptions {
  const env = options.env ?? processEnvRecord();
  // Empty string is treated as "unset" (not a real override): `??` alone would
  // keep "" (not nullish), then resolveBaseURL("") → undefined, silently
  // discarding the model's real base URL.
  const rawBaseURL =
    options.baseURL !== "" && options.baseURL !== undefined ? options.baseURL : model.baseUrl;
  const baseURL = resolveBaseURL(rawBaseURL, env);

  const headers = mergeHeaders(model.headers, options.headers);

  return {
    name: model.provider,
    ...(baseURL ? { baseURL } : {}),
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(headers ? { headers } : {}),
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
    // Force-enable usage reporting for the generic openai-compatible factory.
    // Without this, ~100 catalog providers (deepseek, groq, zai, togetherai,
    // …) may silently return zero usage, breaking cost tracking. First-party
    // factories (anthropic, openai, google, …) report usage natively and
    // ignore this setting. Mirrors opencode's openai-compatible plugin
    // (plugin/provider/openai-compatible.ts: `if (options.includeUsage !==
    // false) options.includeUsage = true`).
    ...(model.npm === "@ai-sdk/openai-compatible" ? { includeUsage: true } : {}),
  };
}

/** Read `process.env` as a `Record<string, string | undefined>` (node-safe). */
function processEnvRecord(): Record<string, string | undefined> {
  return typeof process === "undefined" ? {} : process.env;
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache of resolved SDK instances, keyed by `npm + factory-options` JSON.
 * Lets repeated requests to the same provider reuse the SDK's HTTP client.
 */
const sdkCache = new Map<string, ProviderSDK>();

/** Compute the cache key for an SDK given its npm + resolved options. */
function sdkCacheKey(npm: string, opts: ProviderFactoryOptions): string {
  return JSON.stringify({ npm, opts });
}

/**
 * Clear the SDK cache. Exported for tests so each test gets a clean cache.
 * Production code does NOT call this — the cache is process-lifetime.
 */
export function clearResolveCache(): void {
  sdkCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic-import fallback (OC-FALLBACK, provider.ts:1747-1767)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a provider factory from an arbitrary npm package via dynamic import.
 *
 * Used when `model.npm` isn't in {@link BUNDLED_PROVIDERS} — e.g. the catalog
 * references `@ai-sdk/groq` but we didn't bundle it. The package must be
 * installed by the user; if not, Node's import resolver throws a clear error.
 *
 * Ported from opencode (`:1747-1767`), skipping opencode's `Npm.add` auto-install
 * (we're a desktop app — can't auto-install at runtime). The heuristic: find
 * the export whose name starts with `create` and call it.
 */
async function loadFactoryFromNpm(
  npm: string,
  factoryOpts: ProviderFactoryOptions,
): Promise<ProviderSDK> {
  const mod = (await import(npm)) as Record<string, unknown>;
  const createKey = Object.keys(mod).find((key) => key.startsWith("create"));
  if (!createKey) {
    throw new Error(
      `Provider package ${npm} has no create* export. ` +
        "Ensure the package is installed and exports a factory function.",
    );
  }
  const factory = mod[createKey] as ProviderFactory;
  return factory(factoryOpts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a {@link Model} to an @ai-sdk `LanguageModelV4`.
 *
 * Flow:
 * 1. Build factory options (base URL with env substitution, apiKey, merged headers).
 * 2. Look up the factory in `factoryMap` (defaults to {@link BUNDLED_PROVIDERS}).
 *    Found → call it. Not found → fall back to dynamic `import(npm)`.
 * 3. Cache the SDK by `npm + options` so repeated requests reuse it.
 * 4. Return `sdk.languageModel(model.id)`.
 *
 * The `factoryMap` parameter is for tests — inject fake factories to verify
 * option passing without real API setup.
 *
 * @throws when `model.npm` is absent, or the npm package can't be loaded.
 */
export async function resolveLanguageModel(
  model: Model,
  options: ResolveOptions,
  factoryMap: Record<string, ProviderFactoryLoader> = BUNDLED_PROVIDERS,
): Promise<LanguageModelV4> {
  const npm = model.npm;
  if (!npm) {
    throw new Error(
      `Model ${model.provider}/${model.id} has no npm provider factory — ` +
        "the catalog must set Model.npm for @ai-sdk routing.",
    );
  }

  const factoryOpts = buildFactoryOptions(model, options);

  // Cache lookup (skipped when a non-default factoryMap is injected, so tests
  // always get a fresh SDK and can assert on factory calls).
  const usingDefaultMap = factoryMap === BUNDLED_PROVIDERS;
  const cacheKey = sdkCacheKey(npm, factoryOpts);
  if (usingDefaultMap) {
    const cached = sdkCache.get(cacheKey);
    if (cached) {
      return ensureV4(cached.languageModel(model.id));
    }
  }

  // Factory dispatch: bundled registry first, dynamic-import fallback second.
  const loader = factoryMap[npm];
  let sdk: ProviderSDK;
  if (loader) {
    const factory = await loader();
    sdk = factory(factoryOpts);
  } else {
    sdk = await loadFactoryFromNpm(npm, factoryOpts);
  }

  if (usingDefaultMap) {
    sdkCache.set(cacheKey, sdk);
  }

  return ensureV4(sdk.languageModel(model.id));
}

/**
 * Ensure a language model is `LanguageModelV4`. First-party providers
 * (`@ai-sdk/openai@4`, `@ai-sdk/anthropic@4`, …) already return V4; some
 * third-party providers still return V3. `wrapLanguageModel` with empty
 * middleware converts V3 → V4 (the interfaces are structurally identical
 * except for `specificationVersion`).
 */
function ensureV4(model: LanguageModelV4 | LanguageModelV3): LanguageModelV4 {
  return model.specificationVersion === "v4" ? model : wrapLanguageModel({ model, middleware: [] });
}
