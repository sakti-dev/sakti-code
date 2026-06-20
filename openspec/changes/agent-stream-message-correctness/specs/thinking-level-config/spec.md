## MODIFIED Requirements

### Requirement: Thinking level is passed to LLM streaming
The system SHALL read the `thinkingLevel` from the session row at loop construction time and pass it to the LLM via `streamSimple`'s options. The `AgentConfig` interface SHALL have an optional `thinkingLevel` field. `streamLLMResponse` SHALL pass this value to `streamSimple` under the **`reasoning`** option key — pi-ai's `SimpleStreamOptions` reads `reasoning?: ThinkingLevel`, NOT `thinkingLevel`, so the level is mapped from our `thinkingLevel` config name to pi-ai's `reasoning` option name at the streaming boundary. (Our `AgentConfig.thinkingLevel` and the `thinking_level` per-session setting names are unchanged; only the pi-ai boundary key is `reasoning`.)

#### Scenario: thinking level threaded through to streamSimple as `reasoning`
- **WHEN** a session has `thinkingLevel: "high"` and a prompt is sent
- **THEN** `streamSimple` is called with `{ reasoning: "high" }` in its options (NOT `{ thinkingLevel: "high" }`)

#### Scenario: reasoning is actually engaged (not silently dropped)
- **WHEN** a reasoning-capable model is used with `thinkingLevel: "high"`
- **THEN** the model receives the reasoning/thinking directive and the stream yields `thinking_delta` events (the level is no longer a silent no-op due to a wrong field name)

#### Scenario: default thinking level when not set
- **WHEN** a session has `thinkingLevel: "off"` (the default)
- **THEN** `streamSimple` is called without a `reasoning` option (pi-ai default behavior)

#### Scenario: thinking level from per-session settings overrides session config
- **WHEN** per-session settings contain a `thinking_level` key
- **THEN** this value SHALL override the session row's `thinkingLevel` for the current prompt
