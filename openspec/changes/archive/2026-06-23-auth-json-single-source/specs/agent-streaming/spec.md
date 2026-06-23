## MODIFIED Requirements

### Requirement: Model resolution from stored config
The system SHALL resolve the pi-ai `Model` for a session by resolving the active profile from `profiles.json` and the session's project: the active profile id is `project.profileId ?? profiles.defaultProfile`; the model reference is `profile.models[<current runtime mode>] ?? profile.models.default`. Until runtime modes ship, the current mode SHALL always be `default`. Resolution SHALL call `getModel(provider, modelId)` using only values from the resolved model reference and SHALL pass the reference's `thinkingLevel` (defaulting to `"off"`) into the session config. The resolved profile JSON SHALL be cached keyed on the file's `mtimeMs` so an external edit to `profiles.json` is reflected on the next resolution without a server restart. API keys SHALL be read from `ctx.auth.getApiKey(provider)` (the auth store backed by `auth.json`) — NOT from `process.env` and NOT from the DB or profiles file. If `ctx.auth.getApiKey(provider)` returns `undefined`, `resolveAuth` SHALL return `undefined` so the caller (runner, compaction route) surfaces a "no API key" error. If the resolved profile or its `models.default` is missing, the resolver SHALL throw an error mentioning the missing profile/default.

#### Scenario: resolves via default model
- **WHEN** a session's project resolves to a profile whose `models.default` is set
- **THEN** the harness's model is the one resolved from `models.default`

#### Scenario: project profileId overrides defaultProfile
- **WHEN** `profiles.defaultProfile` is `"balanced"` but the session's `project.profileId` is `"fast"`
- **THEN** the harness's model is resolved from the `"fast"` profile's `models.default`

#### Scenario: cache invalidates on file change
- **WHEN** `profiles.json` is edited externally (mtime changes) and a subsequent `runPrompt` resolves the model
- **THEN** the new profile content is used (not the cached pre-edit copy)

#### Scenario: no default model available
- **WHEN** the resolved profile has no `models.default`
- **THEN** `runPrompt` throws an error mentioning the missing default model

#### Scenario: API key resolved from auth.json
- **WHEN** `runPrompt` runs for a session whose resolved provider is `openai` and `ctx.auth.getApiKey("openai")` returns a stored key
- **THEN** the harness receives that key via `getApiKeyAndHeaders` and pi-ai's stream function is called with `apiKey: <stored key>`

#### Scenario: missing key surfaces an error
- **WHEN** `ctx.auth.getApiKey(provider)` returns `undefined` for the resolved provider
- **THEN** `resolveAuth` returns `undefined`, `runPrompt` throws an error matching `/No API key for <provider>/`, and pi-ai's stream function is NOT called

#### Scenario: env vars are not consulted
- **WHEN** `process.env.OPENAI_API_KEY` is set in the launching shell but `auth.json` has no `openai` entry
- **THEN** `resolveAuth` returns `undefined` for an `openai`-provider session (the shell-exported variable is ignored)
