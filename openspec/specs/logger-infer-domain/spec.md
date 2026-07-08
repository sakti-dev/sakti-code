## Purpose

Domain inference determines which DOMAIN tag a log line belongs to, used for the `[DOMAIN:ACTION]` prefix in console-formatted output. It supports explicit domain, keyword-based inference from module/scope, and a fallback default.

## Requirements

### Requirement: Explicit domain in context always wins

When the context contains an explicit `domain` key, the system SHALL return that value, ignoring any module/scope-based inference.

#### Scenario: Explicit domain overrides module hint
- **WHEN** the context has `{ domain: "LLM", module: "auth" }`
- **THEN** the domain is `"LLM"` (not `"AUTH"`)

### Requirement: Domain is inferred from module/scope keywords

When no explicit domain is set, the system SHALL infer the domain by matching keywords in the `module` and `scope` fields. Known mappings include: `auth` → `"AUTH"`, `db` → `"DB"`, `server` → `"SERVER"`, `session` → `"SESSION"`, `tool` → `"TOOL"`, `ws`/`websocket` → `"WS"`, `chat` → `"CHAT"`.

#### Scenario: Module "auth" infers AUTH
- **WHEN** the context is `{ module: "auth" }`
- **THEN** the domain is `"AUTH"`

#### Scenario: Module "ws-client" infers WS
- **WHEN** the context is `{ module: "ws-client" }`
- **THEN** the domain is `"WS"`

#### Scenario: Scope "websocket-handler" infers WS
- **WHEN** the context is `{ scope: "websocket-handler" }`
- **THEN** the domain is `"WS"`

#### Scenario: Module "db-repo" infers DB
- **WHEN** the context is `{ module: "db-repo" }`
- **THEN** the domain is `"DB"`

#### Scenario: Module "chat-input" infers CHAT
- **WHEN** the context is `{ module: "chat-input" }`
- **THEN** the domain is `"CHAT"`

### Requirement: Unmatched contexts default to UI

When no explicit domain or known keyword is matched, the system SHALL default to `"UI"`.

#### Scenario: Empty context defaults to UI
- **WHEN** the context is empty
- **THEN** the domain is `"UI"`
