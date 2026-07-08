## ADDED Requirements

### Requirement: Profiles resolve model selection per mode
The system SHALL store model-selection profiles as JSON in `~/.sakti/agent/profiles.json` (path overridable by `SAKTI_AGENT_DIR`). A profile SHALL map runtime modes to a model reference: `models.default` SHALL be required, and `models.intake`, `models.plan`, `models.build` SHALL be optional. Each model reference SHALL have `provider` and `model`, and MAY have `thinkingLevel`. The file SHALL name a `defaultProfile` id. The system SHALL resolve the active profile for a project as `project.profileId ?? defaultProfile`, then resolve the model as `profile.models[<current mode>] ?? profile.models.default`. Until runtime modes ship, the current mode SHALL always resolve to `default`.

#### Scenario: default model is always resolved today
- **WHEN** a session runs for a project whose profile has only `models.default` set
- **THEN** the resolved model is `models.default`'s provider/model

#### Scenario: mode override is ignored until modes ship
- **WHEN** a profile has `models.plan` set but runtime modes are not yet implemented
- **THEN** the resolved model is still `models.default` (the `plan` key is accepted but unused)

#### Scenario: project profileId overrides defaultProfile
- **WHEN** `defaultProfile` is `"balanced"` but `project.profileId` is `"fast"`
- **THEN** the `"fast"` profile's models are used for that project

#### Scenario: missing default model is an error
- **WHEN** the resolved profile's `models.default` is absent
- **THEN** model resolution throws an error mentioning the missing default model

### Requirement: Profiles file is hand-editable JSON
The system SHALL read and parse `profiles.json` as plain JSON on demand and SHALL validate it against the profiles schema before use. The whole file SHALL be replaceable via a single `PUT /api/profiles` operation that validates first and writes atomically (write-to-temp then rename) on success. Invalid JSON or schema-violating bodies SHALL be rejected with HTTP 400 and SHALL NOT modify the existing file.

#### Scenario: valid whole-file replace
- **WHEN** `PUT /api/profiles` is sent with a schema-valid body
- **THEN** the response is 204 and a subsequent `GET /api/profiles` returns the written content

#### Scenario: invalid body does not corrupt the file
- **WHEN** `PUT /api/profiles` is sent with a body missing the required `defaultProfile` field
- **THEN** the response is 400 and the existing `profiles.json` is unchanged

#### Scenario: malformed JSON is rejected
- **WHEN** `PUT /api/profiles` is sent with a body that is not valid JSON
- **THEN** the response is 400 and the existing `profiles.json` is unchanged

### Requirement: Profiles support hybrid vision fallback
A profile MAY declare a `hybrid` block with `enabled` (boolean) and `vision: { provider, model }`. When `hybrid.enabled` is true and a vision-capable model is required, the system SHALL use `hybrid.vision`. When `hybrid.enabled` is true but `vision` is absent, the system SHALL surface a user-facing indication that hybrid fallback is enabled but no vision model is selected.

#### Scenario: hybrid vision model resolved when enabled
- **WHEN** a profile has `hybrid.enabled: true` and `hybrid.vision` set
- **THEN** the vision model resolves to the declared provider/model

#### Scenario: hybrid enabled without vision model is reported
- **WHEN** a profile has `hybrid.enabled: true` and no `hybrid.vision`
- **THEN** the profiles read exposes a state indicating hybrid is enabled but incomplete

### Requirement: Projects reference a profile
The `projects` table SHALL have a nullable `profileId` text column. A null value SHALL mean "use `defaultProfile` from `profiles.json`". Setting a project's profile SHALL be done by updating `profileId` via the existing projects update route. The system SHALL NOT delete or rename a profile that is referenced by `defaultProfile` or any project's `profileId` without an explicit override.

#### Scenario: project with null profileId uses defaultProfile
- **WHEN** a project has `profileId = null` and `defaultProfile = "balanced"`
- **THEN** the project resolves its model from the `"balanced"` profile

#### Scenario: setting profileId changes the active profile
- **WHEN** a project's `profileId` is updated from null to `"fast"`
- **THEN** subsequent model resolution for that project uses the `"fast"` profile
