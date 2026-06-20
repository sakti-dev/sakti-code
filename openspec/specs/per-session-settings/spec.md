## Purpose

Per-session runtime settings let a user override agent-loop defaults (compaction, retry, steering, follow-up behaviour) for a single session without affecting other sessions. Settings are stored in the shared `settings` table under a `session:{id}:{name}` key convention, exposed via REST routes, and loaded into the agent loop at construction time.

## Requirements

### Requirement: Per-session runtime settings stored in settings table
The system SHALL store per-session runtime settings in the existing `settings` table using the key convention `session:{sessionId}:{settingName}`. The following settings SHALL be supported:
- `auto_compaction` — boolean string `"true"`/`"false"` enabling automatic compaction during turns
- `auto_retry` — boolean string `"true"`/`"false"` enabling automatic retry on transient errors
- `max_retries` — integer string `"3"` overriding the global max retry count
- `steering_mode` — string `"all"` or `"one-at-a-time"` controlling how steer messages are processed
- `follow_up_mode` — string `"all"` or `"one-at-a-time"` controlling how follow-up messages are processed

#### Scenario: settings persisted via key convention
- **WHEN** `auto_compaction` is set to `"true"` for session `sess_123`
- **THEN** a row exists in the `settings` table with `key = "session:sess_123:auto_compaction"` and `value = "true"`

### Requirement: Settings route reads and writes per-session settings
The system SHALL expose `GET /api/sessions/:id/settings` returning a JSON object of all per-session settings (merged with defaults). `PATCH /api/sessions/:id/settings` SHALL accept a partial JSON body and update only the provided keys.

#### Scenario: read settings returns defaults for unset keys
- **WHEN** `GET /api/sessions/:id/settings` is called for a session with no stored settings
- **THEN** the response is `{ auto_compaction: false, auto_retry: true, max_retries: 3, steering_mode: "all", follow_up_mode: "all" }`

#### Scenario: write then read round-trips
- **WHEN** `PATCH /api/sessions/:id/settings` with `{ auto_compaction: true }` then `GET /api/sessions/:id/settings`
- **THEN** the response has `auto_compaction: true` and all other keys at defaults

#### Scenario: unknown session returns 404
- **WHEN** `GET /api/sessions/nope/settings` or `PATCH /api/sessions/nope/settings` is called
- **THEN** the response status is 404

### Requirement: SettingsRepo gains bulk-prefix query
The `SettingsRepo` class SHALL gain a `getByPrefix(prefix: string)` method that returns all settings keys matching the given prefix as an array of `{ key, value }` pairs.

#### Scenario: bulk-prefix returns matching keys
- **WHEN** `getByPrefix("session:sess_123:")` is called and three settings exist for that session
- **THEN** an array of 3 `{ key, value }` objects is returned

### Requirement: Loop loads per-session settings at construction
The `runPrompt` function SHALL load per-session settings at loop construction time and pass them to `createAgentLoop`. Settings SHALL override the corresponding defaults in `AgentConfig`. Settings SHALL be loaded via `SettingsRepo.getByPrefix`.

#### Scenario: settings loaded at prompt start
- **WHEN** `runPrompt` is called for a session with `max_retries: "5"` in its settings
- **THEN** the `AgentConfig.maxRetries` is 5 (not the global default of 3)

#### Scenario: changed settings take effect on next prompt
- **WHEN** a user updates `auto_retry` to `false` while a prompt is running
- **THEN** the change does NOT affect the running prompt; the next prompt uses `auto_retry: false`
