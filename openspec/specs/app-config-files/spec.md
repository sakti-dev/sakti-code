## Purpose

File-backed application configuration under a Pi-style config home (`~/.sakti/agent/`), isolating credentials (`auth.json`), model profiles (`profiles.json`), and global app behavior (`settings.json`) into separate JSON files with locking, response masking, env-var flow-through, and a one-time non-destructive migration from the legacy `~/.config/sakti-code/` location.

## Requirements

### Requirement: Pi-style config home at ~/.sakti/agent/
The system SHALL locate all file-backed configuration under `~/.sakti/agent/` (computed as `join(homedir(), ".sakti", "agent")`). The path SHALL be overridable end-to-end by the `SAKTI_AGENT_DIR` environment variable. The directory SHALL be created with mode `0o700` if absent. The system SHALL NOT read configuration from the legacy `~/.config/sakti-code/` location except during the one-time migration.

#### Scenario: default config home
- **WHEN** `SAKTI_AGENT_DIR` is unset
- **THEN** config is read from and written to `~/.sakti/agent/`

#### Scenario: env override
- **WHEN** `SAKTI_AGENT_DIR=/custom/dir` is set
- **THEN** all config files are resolved under `/custom/dir/`

#### Scenario: directory created with restrictive mode
- **WHEN** the config home does not exist on first run
- **THEN** it is created with mode `0o700`

### Requirement: One JSON file per concern
The system SHALL split configuration into separate JSON files under the config home, each with a single responsibility: `auth.json` (credentials), `profiles.json` (model selection — see `provider-profiles`), and `settings.json` (global app behavior). The system SHALL NOT store credentials in `profiles.json` or `settings.json`, and SHALL NOT store model selection or app behavior in `auth.json`.

#### Scenario: credentials isolated to auth.json
- **WHEN** a provider API key is written
- **THEN** it is stored in `auth.json` and not in any other config file

#### Scenario: app behavior isolated to settings.json
- **WHEN** a global app preference (e.g. theme) is written
- **THEN** it is stored in `settings.json` and not in `auth.json` or `profiles.json`

### Requirement: Secret file is locked and mode-restricted
Writes to `auth.json` SHALL be performed under an exclusive file lock (using `proper-lockfile`, lockfile placed next to `auth.json`) and the file SHALL be created and maintained with mode `0o600`. If `auth.json` does not exist, it SHALL be initialized as `{}` with mode `0o600` before the first locked operation. The parent config directory SHALL be mode `0o700`.

#### Scenario: concurrent writes are serialized
- **WHEN** two writes to `auth.json` race
- **THEN** the file lock serializes them and the final content reflects a consistent order (no torn write)

#### Scenario: auth file created with 0600
- **WHEN** `auth.json` does not exist and a credential is set
- **THEN** the file is created with mode `0o600` before the write

#### Scenario: lock released on error
- **WHEN** a locked write throws
- **THEN** the lock is released (no stale lockfile blocks subsequent operations)

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

### Requirement: Global settings file-backed, per-session settings unchanged
`GET /api/settings` and `PUT /api/settings` SHALL read and write global app preferences in `settings.json` (deep-merged on write). The `settings` DB table SHALL be retained ONLY for per-session runtime overrides keyed `session:{id}:*` (see `per-session-settings`, unchanged). Global keys SHALL NOT be read from or written to the DB after migration.

#### Scenario: global setting round-trips via file
- **WHEN** `PUT /api/settings` with `{ theme: "dark" }` then `GET /api/settings`
- **THEN** the response includes `theme: "dark"` and `settings.json` contains the value

#### Scenario: per-session settings remain DB-backed
- **WHEN** `PATCH /api/sessions/:id/settings` sets `auto_compaction: true`
- **THEN** the value is stored in the `settings` table under `session:<id>:auto_compaction` (not in `settings.json`)

### Requirement: One-time non-destructive migration
On first start after upgrade, the system SHALL migrate legacy configuration exactly once (guarded by a `~/.sakti/agent/.migrated` sentinel): copy (not move) `~/.config/sakti-code/api-keys.json` into `auth.json` when present; seed `profiles.json` from any global `model_configs` row if present; seed `settings.json` from non-`session:` rows of the `settings` table. On any parse error the legacy source SHALL be left intact and the migration for that source SHALL be skipped. The sentinel SHALL be written only after successful completion.

#### Scenario: legacy api-keys copied on first start
- **WHEN** the server starts for the first time after upgrade and `~/.config/sakti-code/api-keys.json` exists
- **THEN** its contents are copied into `~/.sakti/agent/auth.json` and the legacy file is preserved

#### Scenario: migration does not repeat
- **WHEN** the server starts a second time after a successful migration
- **THEN** no migration steps run (sentinel present)

#### Scenario: corrupt legacy file is skipped
- **WHEN** the legacy `api-keys.json` contains malformed JSON
- **THEN** the migration skips it, leaves the file in place, and starts with an empty `auth.json`
