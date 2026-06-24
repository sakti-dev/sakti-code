import type { ProviderEnv, ProviderHeaders } from "../types.ts";

/**
 * # Auth result types
 *
 * These are the shapes that flow OUT of auth resolution and INTO the stream
 * layer. The full login/OAuth orchestration (credential stores, login prompts,
 * token refresh) is **server-owned** and intentionally NOT ported here —
 * packages/llm only resolves API keys; the server resolves stored credentials
 * and passes the resulting `apiKey` string to `stream()`.
 *
 * Ported from pi-ai (`packages/ai/src/auth/types.ts`), trimmed to the result
 * surface. The dropped types (`ProviderAuth`, `ApiKeyAuth`, `OAuthAuth`,
 * `CredentialStore`, `AuthLoginCallbacks`, `AuthEvent`, `AuthPrompt`) describe
 * the login flow the server runs against `~/.sakti/agent/auth.json`; they have
 * no consumer inside packages/llm.
 */

/**
 * Request auth for a single model request.
 *
 * Everything the stream layer needs to authenticate fits one of these three
 * fields — if a value can't be expressed as `apiKey`, `headers`, or `baseUrl`,
 * it's provider *config*, not auth.
 *
 * - `apiKey` — bearer token / API key passed to the @ai-sdk factory's `apiKey` option
 * - `baseUrl` — overrides `Model.baseUrl` (e.g. a proxy or regional endpoint)
 * - `headers` — extra HTTP headers (or `null` to suppress a default header)
 */
export interface ModelAuth {
  apiKey?: string;
  baseUrl?: string;
  headers?: ProviderHeaders;
}

/**
 * Result of resolving auth for a model.
 *
 * `auth` is what the stream layer consumes. The optional fields are metadata:
 * - `env` — provider-scoped env values resolved from credentials (regional
 *   settings, endpoint placeholders). Merged into the request env.
 * - `source` — human-readable label for the status UI
 *   (e.g. `"OPENAI_API_KEY"`, `"auth.json"`, `"OAuth"`). Surfaces in the
 *   settings panel so users can see where each provider's key came from.
 */
export interface AuthResult {
  auth: ModelAuth;
  env?: ProviderEnv;
  source?: string;
}
