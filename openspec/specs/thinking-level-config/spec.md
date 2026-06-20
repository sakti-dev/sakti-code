## Purpose

Configures how much "thinking" (extended reasoning) the underlying LLM is asked to do for a session. The thinking level is read from the session row at loop construction, threaded into the LLM streaming options, and can be overridden per-session via the per-session settings mechanism.

## Requirements

### Requirement: Thinking level is passed to LLM streaming
The system SHALL read the `thinkingLevel` from the session row at loop construction time and pass it to the LLM via `streamSimple`'s options. The `AgentConfig` interface SHALL gain an optional `thinkingLevel` field. `streamLLMResponse` SHALL pass this value to `streamSimple` as the `thinkingLevel` option.

#### Scenario: thinking level threaded through to streamSimple
- **WHEN** a session has `thinkingLevel: "high"` and a prompt is sent
- **THEN** `streamSimple` is called with `{ thinkingLevel: "high" }` in its options

#### Scenario: default thinking level when not set
- **WHEN** a session has `thinkingLevel: "off"` (the default)
- **THEN** `streamSimple` is called without a `thinkingLevel` option (pi-ai default behavior)

#### Scenario: thinking level from per-session settings overrides session config
- **WHEN** per-session settings contain a `thinking_level` key
- **THEN** this value SHALL override the session row's `thinkingLevel` for the current prompt
