## Purpose

The auth store manages API keys for LLM providers in `auth.json` (locked at `0o600`). It provides `getApiKey(provider)` for resolving keys at runtime (used by the agent runner), and `list()`/`set()`/`delete()` for the REST API surface. The store never reads from or writes to `process.env` — it is the single source of truth.

## Requirements

### Requirement: AuthStore interface

The system SHALL define an `AuthStore` interface with methods: `getApiKey(provider): string | undefined`, `list(): AuthEntry[]`, `set(provider, key): boolean`, `delete(provider): boolean`.

#### Scenario: Interface contract
- **WHEN** a consumer depends on `AuthStore`
- **THEN** all four methods are available

### Requirement: File-backed storage in auth.json

The system SHALL store API keys in `auth.json` as a flat `Record<string, string>`. The file is locked at `0o600`. Reads and writes use file locking (`proper-lockfile`) with retry for concurrent access safety.

#### Scenario: First access creates file
- **WHEN** `auth.json` does not exist and a key is set
- **THEN** the parent directory and file are created with restricted permissions

#### Scenario: File locking for concurrent access
- **WHEN** two processes attempt to write simultaneously
- **THEN** one waits for the lock and succeeds after the other releases it

### Requirement: getApiKey resolves a provider key

The system SHALL read the key for a given provider from `auth.json`. If the provider has no entry, returns `undefined`.

#### Scenario: Key exists
- **WHEN** `getApiKey("anthropic")` and `auth.json` has `{ "anthropic": "sk-ant-..." }`
- **THEN** `"sk-ant-..."` is returned

#### Scenario: Key missing
- **WHEN** `getApiKey("anthropic")` and `auth.json` has no `"anthropic"` entry
- **THEN** `undefined` is returned

### Requirement: list returns masked entries for all known providers

The system SHALL iterate over `PROVIDERS` from the `@sakti-code/llm` catalog and return an `AuthEntry` per provider with `hasKey` (boolean), `maskedKey` (last 4 chars prefixed by `...`, or null), and `provider`.

#### Scenario: List with some keys set
- **WHEN** `list()` and `auth.json` has a key for `"anthropic"` but not `"openai"`
- **THEN** the result includes both providers; anthropic has `hasKey: true` and a masked key, openai has `hasKey: false` and `maskedKey: null`

### Requirement: set validates provider and key

The system SHALL only accept known provider IDs (from the catalog) or namespaced service keys (`websearch:<name>`). Empty or whitespace-only keys SHALL be rejected.

#### Scenario: Valid provider and key
- **WHEN** `set("anthropic", "sk-ant-1234")`
- **THEN** the key is written and `true` is returned

#### Scenario: Unknown provider rejected
- **WHEN** `set("bogus", "key")`
- **THEN** `false` is returned and `auth.json` is unchanged

#### Scenario: Empty key rejected
- **WHEN** `set("anthropic", "   ")`
- **THEN** `false` is returned

### Requirement: delete removes a provider key

The system SHALL remove a key for a given provider. Unknown providers return `false`.

#### Scenario: Delete existing key
- **WHEN** `delete("anthropic")` and the key exists
- **THEN** the key is removed and `true` is returned

#### Scenario: Delete nonexistent key
- **WHEN** `delete("anthropic")` and the key does not exist
- **THEN** `false` is returned

### Requirement: No process.env interaction

The system SHALL NOT read from or write to `process.env`. Keys persist only in `auth.json`.

#### Scenario: Env vars untouched
- **WHEN** `set("anthropic", "sk-test")` is called
- **THEN** `process.env` is unchanged
