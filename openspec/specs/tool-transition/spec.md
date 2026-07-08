## Purpose

The transition tool is a lifecycle signal — the agent's only job is deciding the destination phase (`specify`, `build`, `verify`, `archive`, `mission`). The server resolves gating and runs side-effects. The tool does no DB writes and no file I/O; it just terminates the current turn cleanly.

## Requirements

### Requirement: Transition tool factory needs no cwd

The system SHALL create a transition tool via `createTransitionTool()` with no parameters.

#### Scenario: Create transition tool
- **WHEN** `createTransitionTool()` is called
- **THEN** a tool is returned that accepts `{ to, body }` parameters

### Requirement: Transition tool accepts destination and body

The system SHALL accept `{ to, body, preserveUnrelated? }` where `to` is the destination phase and `body` carries context for the server.

#### Scenario: Transition to specify
- **WHEN** called with `{ to: "specify", body: "Exploring requirements" }`
- **THEN** the tool returns "Phase transition recorded." with `terminate: true`

#### Scenario: Transition to mission with stash
- **WHEN** called with `{ to: "mission", body: "Investigate bug", preserveUnrelated: "stash" }`
- **THEN** the tool records the transition with stash instruction

### Requirement: Transition tool terminates the turn

The system SHALL return `terminate: true` in the result, ending the agent's turn. The server handles gating and side-effects.
