## Context

Today the auth store (`apps/server/src/lib/auth-store.ts`) persists API keys to `auth.json` and *also* mirrors each write into `process.env` so pi-ai's `getEnvApiKey()` can find them at prompt time. The mirroring requires a hand-maintained `PROVIDER_ENV_MAP` (provider id → env-var name) and a hand-maintained `KNOWN_PROVIDERS` list that drives `list()`. The two constants drift against each other and against pi-ai's own catalog: `KNOWN_PROVIDERS` lists 8 providers, `PROVIDER_ENV_MAP` lists 14, pi-ai ships ~25. The symptom that surfaced this was connecting `zai` (write succeeds via `PROVIDER_ENV_MAP`) but never seeing it as connected in the UI (because `list()` iterates `KNOWN_PROVIDERS`, which omits `zai`).

The agent streaming layer, however, is already shaped to receive the API key explicitly: `runPrompt` calls `resolveAuth(ctx, session)` to obtain `{ model, provider, apiKey }`, then passes a `getApiKeyAndHeaders = async () => ({ apiKey: auth.apiKey })` callback into the `AgentHarness` constructor (`runner.ts:147-151`). The harness threads the key into every stream call (`agent-harness.ts:512`), and `agent-loop.ts:316-323` passes `apiKey` into pi-ai's `streamFunction` via the `apiKey:` option. The only reason `process.env` is on the credential path at all is that `resolveAuth` calls `getEnvApiKey(provider)` instead of asking the auth store directly.

The Pi reference implementation (`openspec/references/pi/packages/coding-agent/src/core/auth-storage.ts`) shows the pattern: auth credentials are resolved by `AuthStorage.getApiKey(provider)`, which checks the file (and OAuth/runtime/env fallbacks) and returns the value; pi-ai's stream call receives that value explicitly. Pi supports OAuth and CLI `--api-key` flags, which is why their resolver is layered. We are a desktop app with neither, so we can collapse to the simple path: auth.json → `getApiKey` → harness.

## Goals / Non-Goals

**Goals:**
- Make `auth.json` the single source of truth for provider API keys — no `process.env` writes, no `process.env` reads on the credential hot path.
- Eliminate the hand-curated `PROVIDER_ENV_MAP`, `KNOWN_PROVIDERS`, and `PROVIDER_ENV_VARS` constants from `auth-store.ts`. Derive the provider catalog from pi-ai's `getProviders()`.
- Preserve the existing `auth.json` file format (`Record<provider, keyString>`) — zero migration.
- Keep the harness wiring (`getApiKeyAndHeaders` callback) untouched. The change is localized to the auth store + one line in `resolveAuth` + one deleted line in `create-server.ts`.
- Keep the REST contract stable except for the documented `envVar` field drop.

**Non-Goals:**
- OAuth device-flow login (pi supports it; desktop can add it later behind the same `getApiKey` interface).
- CLI `--api-key` runtime override (we have no CLI surface).
- UI-side catalog refactor (`PROVIDER_CATALOG` in `models-settings.tsx` is still hardcoded). That is a separate UI change; this change only ensures the backend tells the truth about which providers exist and which are connected.
- Ambient env-var detection for "the user exported `OPENAI_API_KEY` in their shell" — by design, we ignore these. The desktop app's source of truth is what the user saved through the UI.
- `findEnvKeys` Proxy trick to derive env-var names — unnecessary once we stop caring about env-var names entirely.
- Per-provider credential typing (`{ type: "api_key", key }` discriminated unions). Pi needs this for OAuth-vs-api_key dispatch; we only have API keys, so plain string values are fine.

## Decisions

### D1. `getApiKey(provider)` is a new method on `AuthStore`; `loadIntoEnv()` is deleted

**Decision:** Add `getApiKey(provider: string): string | undefined` to the `AuthStore` interface that returns the stored key for a provider from `auth.json` (under the existing file lock) or `undefined` when absent. Delete `loadIntoEnv()` entirely.

**Rationale:** The runner needs the actual key value (not just `hasKey`) to thread through `getApiKeyAndHeaders`. `getApiKey` is the obvious counterpart to `set`/`delete`/`list`. Deleting `loadIntoEnv()` removes the last reason for the auth store to touch `process.env`.

**Alternatives considered:**
- *Keep `loadIntoEnv()` as a no-op for backward compat.* Rejected — the spec change is explicitly BREAKING on this internal contract, and a no-op method on an internal interface is dead weight.
- *Make `getApiKey` async.* Rejected — the existing `set`/`delete`/`list` are all synchronous (the lock is sync via `proper-lockfile`'s `lockSync`), and `resolveAuth` is on the synchronous side of `runPrompt`. Async would cascade into `resolveAuth` becoming async for no real benefit (no I/O that isn't already sync).

### D2. `set()` and `delete()` stop touching `process.env`

**Decision:** Remove the `process.env[envVar] = trimmed` line from `set()` and the `delete process.env[envVar]` line from `delete()`. Both methods continue to update `auth.json` under the existing lock with mode `0o600`.

**Rationale:** With `loadIntoEnv()` gone and `resolveAuth` reading from `getApiKey()`, nothing reads `process.env` for credentials. Writing to it is pure noise that also leaks keys into the environment of child processes (e.g. the agent's bash tool inherits `process.env` — today, every prompt spawns shells that can `echo $ANTHROPIC_API_KEY`). Stopping the writes is a security improvement, not just a simplification.

### D3. `list()` iterates `getProviders()`; drop `KNOWN_PROVIDERS`

**Decision:** Replace `for (const provider of KNOWN_PROVIDERS)` in `list()` with `for (const provider of getProviders())` imported from `@earendil-works/pi-ai`. Each entry still produces `{ provider, hasKey, maskedKey }`. The `envVar` field is dropped.

**Rationale:** `getProviders()` is the authoritative catalog — it is what `/api/models/available` already returns to the UI for the model picker, so auth and models now agree by construction. Dropping `envVar` from the response is forced: nothing computes it anymore (the map is gone), and the UI never rendered it.

**Alternatives considered:**
- *Keep `envVar` in the response, computed via `findEnvKeys(provider, truthyEnvProxy)`.* Rejected — the UI does not display it, and the Proxy trick is brittle (relies on pi-ai's internal filtering behavior staying lookup-based). If we ever need to show "this provider expects `OPENAI_API_KEY`" as helper text, we can add it back via a small read-only endpoint that uses the Proxy approach; but that is a UI concern, not a credential concern.
- *Filter out OAuth-only providers (e.g. `github-copilot`).* Deferred — `getProviders()` returns them, but `set()` for those providers will save the key in `auth.json` and `getApiKey()` will return it. Whether the resulting stream call succeeds is up to pi-ai; if it fails, the user sees the error at prompt time. UI-side filtering belongs in the (out-of-scope) UI catalog refactor.

### D4. `set()` validates against `getProviders()`

**Decision:** Replace the `if (!envVar) return false` check (which used `PROVIDER_ENV_MAP`) with `if (!getProviders().includes(provider as KnownProvider)) return false`. Cache `getProviders()` at module load (it is a static catalog derived from pi-ai's model registry).

**Rationale:** Preserves the existing "reject unknown provider with HTTP 400" contract without reintroducing a hand-rolled allowlist. The validation is purely a guard against typos in the URL path; it does not gate whether the key would actually work.

**Alternatives considered:**
- *Skip validation entirely.* Rejected — `POST /api/auth/bogus` would silently save a key that can never be used, breaking the existing 400 contract and the existing auth-store tests.
- *Validate against `findEnvKeys(provider, truthyEnvProxy) !== undefined`.* Rejected — equivalent to `getProviders()` for the API-key-supporting subset, but opaque. `getProviders().includes(...)` is readable.

### D5. `resolveAuth` reads `ctx.auth.getApiKey(provider)`; drop the `getEnvApiKey` import

**Decision:** In `apps/server/src/agent/model-resolver.ts`, change `resolveAuth` from `const apiKey = getEnvApiKey(resolved.provider)` to `const apiKey = ctx.auth.getApiKey(resolved.provider)`. Drop the `getEnvApiKey` import; keep `getModel`.

**Rationale:** One-line change that completes the loop. `runner.ts` and `routes/sessions/compaction.ts` already consume `resolveAuth`'s `apiKey` field via the existing harness/route wiring — no downstream changes needed. The error message in `runner.ts:135-137` (`No API key for <provider> in env`) gets a one-word tweak to `No API key for <provider>` to match the new reality.

### D6. The `auth.json` file format is unchanged

**Decision:** Keep `auth.json` as `Record<string, string>` (provider id → raw key string). Do not adopt pi's `{ type: "api_key", key }` discriminated-union shape.

**Rationale:** We have no OAuth credentials, no runtime overrides, no per-provider env scopes — introducing a sum type now is speculative complexity. If/when OAuth lands, the format change can be a separate spec with its own migration (reading legacy string values as `{ type: "api_key", key }`).

## Risks / Trade-offs

- **[Regression] Existing dev workflows that rely on `OPENAI_API_KEY=...` in the shell to run server tests.** → Mitigation: test helpers already construct the auth store via `createAuthStore(join(tmpDir, "auth.json"))` and call `auth.set(provider, key)` directly (`apps/server/src/__tests__/helpers.ts`, `apps/server/src/__tests__/llm-helpers.ts`). Audit the remaining test files for `process.env.OPENAI_API_KEY = "..."` patterns and convert them to `ctx.auth.set("openai", "test-key")`. The faux-LLM helper (`llm-helpers.ts`) keeps setting `process.env.OPENAI_API_KEY` *only* for pi-ai's internal faux-provider registration, which is unrelated to credential resolution — that stays.
- **[Regression] `runner.ts` error message text changes.** → Mitigation: search for snapshots/tests asserting on `/No API key for .* in env/` and update them. The new message drops ` in env`.
- **[Behavior change] Shell-exported keys are now ignored.** → Mitigation: this is the intended behavior for a desktop app, called out in the proposal and specs. Document in the changelog. Users who were double-setting keys (shell + UI) see no change; users who were shell-only must now save through the UI once.
- **[Security improvement, not a risk] `process.env` no longer contains user keys.** → The agent's bash tool inherits `process.env`; today a prompt can `env | grep API_KEY` and exfiltrate. After this change, it cannot. This is a side benefit, not a regression. (Note: pi-ai itself may still read ambient env vars via `getEnvApiKey` for its own internal purposes, e.g. faux-provider test setup; we are only removing our auth store's writes, not disabling pi-ai's reads elsewhere.)
- **[Drift risk] `getProviders()` returns OAuth-only providers that have no API-key flow.** → Accepted: they appear in `GET /api/auth` as `hasKey: false` (or `true` if the user saves a key that may not work), and the UI catalog (out of scope) decides whether to surface them. No correctness issue at the auth layer.
- **[Test isolation] Removing env writes means earlier test runs no longer pollute later ones via `process.env`.** → Strict improvement; tests that previously had to `delete process.env.OPENAI_API_KEY` in `afterEach` can drop that cleanup.

## Migration Plan

This change is internal and backward-compatible at the persistence layer:

1. **No user-facing migration.** `auth.json` format is unchanged. On the next server start after deploy, the server simply stops calling `loadIntoEnv()`; previously-saved keys continue to load via `getApiKey()`.
2. **Deploy in a single commit** — there is no value in phasing. The auth-store rewrite, `resolveAuth` swap, and `create-server.ts` line removal land together. Tests are updated in the same commit.
3. **Rollback strategy.** Revert the commit. `auth.json` is forward- and backward-compatible (same shape), so reverting restores the `loadIntoEnv()` write-on-startup path and re-populates `process.env` from `auth.json`. No data loss.
4. **Changelog entry.** Under `### Changed` (or `### Fixed` — the `zai` bug is the user-visible symptom): note that API keys are now read exclusively from `auth.json`, that shell-exported env vars are no longer consulted, and that the `envVar` field is removed from `GET /api/auth` responses.

## Open Questions

None. The design is fully determined by the existing harness wiring (which already accepts explicit API keys) and pi's reference (which validates the auth.json-direct pattern). The only judgment call — whether to filter OAuth-only providers in `list()` — is deferred to the UI-catalog refactor.
