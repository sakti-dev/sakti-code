## MODIFIED Requirements

### Requirement: Model resolution from stored config
The system SHALL resolve the pi-ai `Model` for a session by resolving the active profile from `profiles.json` and the session's project: the active profile id is `project.profileId ?? profiles.defaultProfile`; the model reference is `profile.models[<current runtime mode>] ?? profile.models.default`. Until runtime modes ship, the current mode SHALL always be `default`. Resolution SHALL call `getModel(provider, modelId)` using only values from the resolved model reference and SHALL pass the reference's `thinkingLevel` (defaulting to `"off"`) into the session config. The resolved profile JSON SHALL be cached keyed on the file's `mtimeMs` so an external edit to `profiles.json` is reflected on the next resolution without a server restart. API keys SHALL NOT be read from the DB or profiles file by the resolver — they come from `process.env` via pi-ai (set by the auth file store on startup and on write). If the resolved profile or its `models.default` is missing, the resolver SHALL throw an error mentioning the missing profile/default.

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
