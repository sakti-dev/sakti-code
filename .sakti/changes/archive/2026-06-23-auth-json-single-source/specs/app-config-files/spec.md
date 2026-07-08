## MODIFIED Requirements

### Requirement: Auth API never returns full keys
`GET /api/auth` SHALL return one entry per provider in pi-ai's `getProviders()` catalog with `{ provider, hasKey, maskedKey }` where `maskedKey` is the last four characters of the key prefixed by `...` (or `null` when `hasKey` is false). No REST response SHALL include the full API key for any provider. `hasKey` SHALL reflect the presence of a non-empty key stored for that provider in `auth.json` only — it SHALL NOT consider `process.env` or any ambient credential source. The response SHALL NOT include an `envVar` field.

#### Scenario: masked list returned
- **WHEN** `GET /api/auth` is called and a key `sk-abcdef1234567890` is stored for a provider
- **THEN** the response includes `{ hasKey: true, maskedKey: "...7890" }` and no field containing the full key

#### Scenario: set then list round-trips masked
- **WHEN** `POST /api/auth/openai` with `{ key: "sk-test-1234567890abcdef" }` then `GET /api/auth`
- **THEN** the openai entry has `hasKey: true` and `maskedKey: "...cdef"`

#### Scenario: every pi-ai provider appears in the list
- **WHEN** `GET /api/auth` is called
- **THEN** the response contains one entry for every provider id returned by pi-ai's `getProviders()` (e.g. `anthropic`, `openai`, `zai`, `cerebras`, `together`, `fireworks`, `huggingface`, `opencode`, …) — no provider is hidden by a hand-curated allowlist

#### Scenario: hasKey reflects auth.json only
- **WHEN** `process.env.OPENAI_API_KEY` is set in the launching shell but no key is stored in `auth.json` for `openai`
- **THEN** the openai entry in `GET /api/auth` has `hasKey: false` and `maskedKey: null`

## REMOVED Requirements

### Requirement: Credentials flow into process.env
**Reason**: This is a desktop app (Electron), not a CLI. Users do not export API keys into their shell before launching a GUI, so reading keys from `process.env` is wrong by design. The harness already accepts the API key explicitly via `getApiKeyAndHeaders` (`runner.ts:147-151` → `agent-harness.ts:512` → `agent-loop.ts:316-323`), so the env-var detour is unnecessary. Maintaining the provider→env-var map required to write into `process.env` duplicates pi-ai's internal mapping and has already drifted (the `KNOWN_PROVIDERS` constant listed only 8 of the 14 entries in `PROVIDER_ENV_MAP`, hiding providers like `zai`, `cerebras`, `together`, `fireworks`, `huggingface`, and `opencode` from the connection UI).
**Migration**: `auth.json` already stores `Record<provider, keyString>` — that file format is unchanged and keeps working. On startup the server no longer calls `auth.loadIntoEnv()`; `resolveAuth` reads keys via the new `ctx.auth.getApiKey(provider)` method (see "Credentials live only in auth.json" below). No user action is required; previously-saved keys continue to work. Users who relied on shell-exported env vars (e.g. `OPENAI_API_KEY`) must now save them through the UI — but since the UI was already the documented path, this affects only dev/test workflows, which can call `ctx.auth.set(provider, key)` directly.

## ADDED Requirements

### Requirement: Credentials live only in auth.json
The system SHALL treat `auth.json` as the single source of truth for provider API keys. The auth store (`apps/server/src/lib/auth-store.ts`) SHALL expose `getApiKey(provider): string | undefined` that returns the stored key for a provider directly from `auth.json` (or `undefined` when none is stored). The auth store SHALL NOT read from or write to `process.env` for credential storage — neither on `set(provider, key)`, on `delete(provider)`, nor on server startup. The previous `loadIntoEnv()` method SHALL be removed. `resolveAuth(ctx, session)` in `apps/server/src/agent/model-resolver.ts` SHALL obtain the API key by calling `ctx.auth.getApiKey(resolved.provider)` and SHALL NOT call pi-ai's `getEnvApiKey()`. If no key is stored for the resolved provider, `resolveAuth` SHALL return `undefined` (so the runner/route can surface a "no API key" error). Provider iteration in `list()` SHALL come from pi-ai's `getProviders()`; `set(provider, key)` SHALL validate the provider id against `getProviders()` and reject unknown providers. The auth store SHALL NOT contain any hand-curated constant mapping providers to env-var names or any hand-curated list of known provider ids.

#### Scenario: stored key is returned to the resolver
- **WHEN** `auth.set("openai", "sk-test")` has been called and `resolveAuth` runs for a session whose resolved provider is `openai`
- **THEN** `ctx.auth.getApiKey("openai")` returns `"sk-test"` and the harness receives `apiKey: "sk-test"` via `getApiKeyAndHeaders`

#### Scenario: no stored key yields undefined
- **WHEN** no key is stored in `auth.json` for the resolved provider
- **THEN** `ctx.auth.getApiKey(provider)` returns `undefined` and `resolveAuth` returns `undefined` — regardless of whether `process.env` happens to contain a matching variable

#### Scenario: set then delete round-trips through auth.json only
- **WHEN** `auth.set("zai", "sk-zai")` then `auth.delete("zai")`
- **THEN** `auth.getApiKey("zai")` returns `undefined`, no `process.env.ZAI_API_KEY` variable is created or removed, and `auth.json` no longer contains a `zai` entry

#### Scenario: set rejects unknown providers
- **WHEN** `auth.set("bogus", "sk-x")` is called
- **THEN** it returns `false` (or throws, depending on the store's existing convention) and `auth.json` is unchanged — because `"bogus"` is not in pi-ai's `getProviders()`

#### Scenario: provider list is never hand-curated
- **WHEN** pi-ai adds a new provider id to its catalog in a future version
- **THEN** that provider appears in `GET /api/auth` responses and is accepted by `POST /api/auth/<new-provider>` without any code change in the auth store — because the list is derived from `getProviders()`, not from a constant in this repository
