## Why

This is a desktop app (Electron), not a CLI. Reading API keys from `process.env` is wrong by design: users do not export keys in their shell before launching a GUI, and tunneling credentials through `process.env` forces us to maintain a hand-rolled `PROVIDER_ENV_MAP` constant that duplicates pi-ai's internal provider→env-var mapping. The duplicate has already drifted — `KNOWN_PROVIDERS` lists only 8 of the 14 providers in `PROVIDER_ENV_MAP`, so connecting e.g. `zai` succeeds on write but never appears connected in the UI. The harness already takes the API key explicitly via `getApiKeyAndHeaders` (`runner.ts:147-151` → `agent-harness.ts:512` → `agent-loop.ts:316-323`); the env-var indirection is a leftover from the CLI-inspired architecture and is the only reason `PROVIDER_ENV_MAP` / `KNOWN_PROVIDERS` / `loadIntoEnv()` exist. `auth.json` (already locked + `0o600`) should be the single source of truth.

## What Changes

- **BREAKING (internal contract)**: `resolveAuth` (`apps/server/src/agent/model-resolver.ts`) SHALL read the API key from `ctx.auth.getApiKey(provider)` instead of pi-ai's `getEnvApiKey(provider)`. The key flows to the harness unchanged via the existing `getApiKeyAndHeaders` callback.
- The auth store (`apps/server/src/lib/auth-store.ts`) SHALL add a `getApiKey(provider): string | undefined` method that reads `auth.json` directly. It SHALL NOT write to or read from `process.env` for credential storage.
- The auth store SHALL drop `PROVIDER_ENV_MAP`, `KNOWN_PROVIDERS`, `PROVIDER_ENV_VARS`, and `loadIntoEnv()`. Provider iteration in `list()` SHALL come from pi-ai's `getProviders()`.
- `apps/server/src/create-server.ts` SHALL stop calling `auth.loadIntoEnv()` on startup.
- The auth store SHALL validate `set(provider, key)` against pi-ai's `getProviders()` (rejects unknown providers with HTTP 400 — unchanged externally).
- `GET /api/auth` response entries SHALL drop the `envVar` field (UI never rendered it; no third-party consumers). Response shape becomes `{ provider, hasKey, maskedKey }`.
- `hasKey` SHALL reflect the presence of a key in `auth.json` only (no env-var fallback), so the UI's connected/not-connected indicator reflects what the user actually saved through the app.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `app-config-files`: replace the "Credentials flow into process.env" requirement with a "Credentials live only in auth.json" requirement; update the masked-list requirement to drop `envVar` from the response shape.
- `agent-streaming`: update the "Model resolution from stored config" requirement so the resolver reads the API key from `ctx.auth` (auth.json) instead of `process.env` via pi-ai's `getEnvApiKey()`.

## Impact

- **Code**: `apps/server/src/lib/auth-store.ts` (rewrite of constants + `list()`/`set()`/`delete()` + new `getApiKey()`, removal of `loadIntoEnv()`); `apps/server/src/agent/model-resolver.ts` (one-line swap in `resolveAuth` + import drop); `apps/server/src/create-server.ts` (remove `loadIntoEnv()` call); `apps/desktop/src/components/settings/tabs/models-settings.tsx` (drop unused `envVar` field from `ApiKeyInfo`).
- **APIs**: `GET /api/auth` response entries drop the `envVar` field. Endpoint paths and HTTP semantics are otherwise unchanged.
- **Dependencies**: drops one direct usage of `getEnvApiKey` from `@earendil-works/pi-ai` in app code (the package is still used for `getModel`, `getProviders`, streaming). pi-ai's env-var machinery remains available for ambient env detection elsewhere if ever needed, but is no longer on the credential hot path.
- **Persistence**: `auth.json` file format is unchanged (`Record<provider, keyString>`). No migration; existing files keep working.
- **Tests**: auth-store tests drop their `process.env` assertions and gain `getApiKey` round-trip coverage; model-resolver tests switch from seeding `process.env` to seeding `ctx.auth.set(...)`; the `loadIntoEnv` test is removed.
- **Out of scope**: hardcoding provider/model lists in the UI (`PROVIDER_CATALOG` in `models-settings.tsx`) — that is a separate UI-catalog change. OAuth support — not needed for desktop API-key flow. The `findEnvKeys` Proxy trick — unnecessary once we stop caring about env-var names entirely.
