## Purpose

Configures how much "thinking" (extended reasoning) the underlying LLM is asked to do for a session. The thinking level is read from the session row at loop construction, threaded into the LLM streaming options, and can be overridden per-session via the per-session settings mechanism.

## Requirements

### Requirement: Thinking level is passed to LLM streaming
The system SHALL read the `thinkingLevel` from the session row at loop construction time and pass it to the LLM via `streamSimple`'s options. The `AgentConfig` interface SHALL have an optional `thinkingLevel` field. `streamLLMResponse` SHALL pass this value to `streamSimple` under the **`reasoning`** option key — pi-ai's `SimpleStreamOptions` reads `reasoning?: ThinkingLevel`, NOT `thinkingLevel` — so our `thinkingLevel` config name is mapped to pi-ai's `reasoning` option name at the streaming boundary. The option SHALL be set **only when** the model advertises reasoning capability AND a non-off level is configured: `if (model.reasoning && thinkingLevel && thinkingLevel !== "off") options.reasoning = thinkingLevel` — matching pi's gate at `compaction.ts:537`. (pi-ai does not gate reasoning internally; the caller must, as pi does.) Our `AgentConfig.thinkingLevel` and the `thinking_level` per-session setting names are unchanged; only the pi-ai boundary key and the capability gate change.

#### Scenario: thinking level threaded through to streamSimple as `reasoning`
- **WHEN** a session has `thinkingLevel: "high"` and the configured model advertises `reasoning: true`
- **THEN** `streamSimple` is called with `{ reasoning: "high" }` in its options (NOT `{ thinkingLevel: "high" }`)

#### Scenario: reasoning is actually engaged (not silently dropped)
- **WHEN** a reasoning-capable model is used with `thinkingLevel: "high"`
- **THEN** the model receives the reasoning/thinking directive and the stream yields `thinking_delta` events (the level is no longer a silent no-op due to a wrong field name)

#### Scenario: reasoning is NOT sent for a non-reasoning model
- **WHEN** the configured model advertises `reasoning: false` and the session has `thinkingLevel: "high"`
- **THEN** `streamSimple` is called WITHOUT a `reasoning` option (gated on `model.reasoning`, matching pi — avoids sending a directive the provider may reject)

#### Scenario: default thinking level when not set
- **WHEN** a session has `thinkingLevel: "off"` (the default)
- **THEN** `streamSimple` is called without a `reasoning` option (pi-ai default behavior)

#### Scenario: thinking level from per-session settings overrides session config
- **WHEN** per-session settings contain a `thinking_level` key
- **THEN** this value SHALL override the session row's `thinkingLevel` for the current prompt
