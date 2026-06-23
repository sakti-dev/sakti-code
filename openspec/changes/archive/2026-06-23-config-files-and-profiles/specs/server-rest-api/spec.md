## MODIFIED Requirements

### Requirement: Settings key/value store
The system SHALL expose endpoints for **global** application settings, file-backed by `settings.json` (see `app-config-files`): `GET /api/settings` (returns the parsed global settings object), `PUT /api/settings` (accepts a JSON body, deep-merged into `settings.json`, validated, atomic write). These endpoints SHALL NOT touch the `settings` DB table. Per-session runtime settings SHALL remain DB-backed and are exposed via the unchanged `GET`/`PATCH /api/sessions/:id/settings` routes (see `per-session-settings`).

#### Scenario: put then get round-trips via file
- **WHEN** `PUT /api/settings` with `{ "theme": "dark" }` then `GET /api/settings`
- **THEN** the PUT returns 204, `settings.json` contains `theme: "dark"`, and the GET returns it

#### Scenario: invalid body is rejected
- **WHEN** `PUT /api/settings` with a body that fails validation
- **THEN** the response is 400 and `settings.json` is unchanged

## ADDED Requirements

### Requirement: Profiles REST surface
The system SHALL expose `GET /api/profiles` returning the parsed, schema-validated contents of `profiles.json`, and `PUT /api/profiles` replacing the whole file atomically after validation. A `PUT` whose body is malformed JSON or violates the profiles schema SHALL return HTTP 400 and SHALL NOT modify the existing file. These routes SHALL be registered through the server's route-composition pattern and SHALL NOT edit the server foundation file directly.

#### Scenario: get returns parsed profiles
- **WHEN** `GET /api/profiles` is called
- **THEN** the response is the parsed JSON object from `profiles.json`

#### Scenario: put replaces the file
- **WHEN** `PUT /api/profiles` is called with a schema-valid body
- **THEN** the response is 204 and a subsequent `GET /api/profiles` returns the new content

#### Scenario: put with invalid body is rejected
- **WHEN** `PUT /api/profiles` is called with a body missing `defaultProfile`
- **THEN** the response is 400 and the existing `profiles.json` is unchanged

### Requirement: Auth REST surface
The system SHALL expose `GET /api/auth` returning a masked list of provider credentials (one entry per known provider: `{ provider, envVar, hasKey, maskedKey }`), `POST /api/auth/:provider` with body `{ key }` to set a provider's key, and `DELETE /api/auth/:provider` to remove it. `maskedKey` SHALL be the last four characters of the key prefixed by `...`, or null when no key is set. No response SHALL include a full API key. Setting an unknown provider or an empty/whitespace key SHALL return HTTP 400 and SHALL NOT modify `auth.json`. Writes SHALL set/clear the matching `process.env` variable.

#### Scenario: masked list
- **WHEN** `GET /api/auth` is called
- **THEN** the response is an array of `{ provider, envVar, hasKey, maskedKey }` entries with no full keys

#### Scenario: set then delete
- **WHEN** `POST /api/auth/openai` `{ key: "sk-test-1234567890abcdef" }` then `DELETE /api/auth/openai`
- **THEN** the POST returns 204 and sets `process.env.OPENAI_API_KEY`, the DELETE returns 204 and clears it, and a following `GET /api/auth` shows `hasKey: false` for openai

#### Scenario: unknown provider rejected
- **WHEN** `POST /api/auth/bogus` `{ key: "x" }`
- **THEN** the response is 400 and `auth.json` is unchanged

#### Scenario: empty key rejected
- **WHEN** `POST /api/auth/openai` `{ key: "   " }`
- **THEN** the response is 400 and `auth.json` is unchanged

## REMOVED Requirements

### Requirement: DB-backed model configs
**Reason**: Model configuration moves to `profiles.json` (see `provider-profiles`); the `model_configs` table is dropped (see `database-schema`). Model selection is now expressed as profiles (mode → model), not as per-project DB rows.
**Migration**: Callers of `GET /api/model-configs/global`, `GET /api/model-configs/projects/:projectId`, and `POST /api/model-configs` SHALL switch to `GET`/`PUT /api/profiles` and the project's `profileId` column.
