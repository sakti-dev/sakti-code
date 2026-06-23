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
`GET /api/auth` SHALL return one entry per known provider with `{ provider, envVar, hasKey, maskedKey }` where `maskedKey` is the last four characters of the key prefixed by `...` (or null when `hasKey` is false). No REST response SHALL include the full API key for any provider. Full keys SHALL only leave `auth.json` by being set into `process.env` for pi-ai's `getEnvApiKey()` to read.

#### Scenario: masked list returned
- **WHEN** `GET /api/auth` is called and a key `sk-abcdef1234567890` is stored for a provider
- **THEN** the response includes `{ hasKey: true, maskedKey: "...7890" }` and no field containing the full key

#### Scenario: set then list round-trips masked
- **WHEN** `POST /api/auth/openai` with `{ key: "sk-test-1234567890abcdef" }` then `GET /api/auth`
- **THEN** the openai entry has `hasKey: true` and `maskedKey: "...cdef"`

### Requirement: Credentials flow into process.env
On startup the system SHALL load every key in `auth.json` into the matching `process.env[envVar]` (provider→envVar map mirrors pi-ai's env-api-keys). `POST /api/auth/:provider` SHALL write the file and set the env var. `DELETE /api/auth/:provider` SHALL remove both. Setting an unknown provider or an empty/whitespace key SHALL be rejected with HTTP 400 and SHALL NOT modify env or file.

#### Scenario: startup populates env
- **WHEN** the server starts with `auth.json` containing `{ "anthropic": "sk-abc" }`
- **THEN** `process.env.ANTHROPIC_API_KEY` is `sk-abc`

#### Scenario: unknown provider rejected
- **WHEN** `POST /api/auth/bogus` with `{ key: "x" }`
- **THEN** the response is 400 and `auth.json` is unchanged

#### Scenario: empty key rejected
- **WHEN** `POST /api/auth/openai` with `{ key: "   " }`
- **THEN** the response is 400 and `auth.json` is unchanged

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
