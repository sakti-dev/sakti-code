## MODIFIED Requirements

### Requirement: SettingsRepo manages key-value settings
`SettingsRepo` SHALL provide methods scoped to per-session runtime overrides: `get(key)`, `set(key, value)`, `getAll()`, and `getByPrefix(prefix)`. It SHALL be used ONLY for keys matching the `session:{sessionId}:{settingName}` convention. Global application settings SHALL NOT pass through `SettingsRepo`; they are read and written via the file-backed settings store (see `app-config-files`).

#### Scenario: Set and get a per-session setting
- **WHEN** `set("session:sess_1:auto_compaction", "true")` is called, then `get("session:sess_1:auto_compaction")` is called
- **THEN** `"true"` is returned

#### Scenario: Get nonexistent setting
- **WHEN** `get("session:sess_1:nope")` is called
- **THEN** null is returned

#### Scenario: Global settings do not use SettingsRepo
- **WHEN** a global preference such as theme is read or written
- **THEN** the operation goes through the file-backed settings store, not `SettingsRepo`

## REMOVED Requirements

### Requirement: ModelConfigRepo manages model configurations
**Reason**: Model configuration moves to `profiles.json` (see `provider-profiles`). There is no DB table backing it (`model_configs` is dropped — see `database-schema`), so the repo has nothing to read or write.
**Migration**: Callers that previously resolved a model via `ModelConfigRepo.getForProject(projectId)` / `getGlobalDefault()` SHALL instead resolve via the profile resolver (`profiles.json` + `project.profileId`), implemented in the agent-streaming model-resolution path. The `set` operation is replaced by `PUT /api/profiles`.
