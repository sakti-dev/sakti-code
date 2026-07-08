## ADDED Requirements

### Requirement: WebSocket accepts steer and followUp messages
The WebSocket protocol at `/ws` SHALL accept two new inbound message types:
- `{ type: "steer", sessionId: string, message: string }`
- `{ type: "followUp", sessionId: string, message: string }`

When received, the WS handler SHALL look up the active loop for the given `sessionId` via the abort registry and call `loop.steer(message)` or `loop.followUp(message)`. If no active loop exists for the sessionId, the handler SHALL send an `{ type: "error", sessionId, message: "No active run" }` frame.

#### Scenario: steer message forwarded to active loop
- **WHEN** a `steer` message is received with a `sessionId` that has an active run
- **THEN** the handler calls `loop.steer(message)` and does NOT send a response frame

#### Scenario: steer with no active session
- **WHEN** a `steer` message is received with a `sessionId` that has no active run
- **THEN** the handler sends an `error` frame with `sessionId` and a descriptive message

## MODIFIED Requirements

### Requirement: WebSocket prompt/abort/steer/followUp protocol
The system SHALL expose a WebSocket at `/ws`. Inbound messages SHALL be `{type:"prompt", sessionId, message}`, `{type:"abort", sessionId}`, `{type:"steer", sessionId, message}`, or `{type:"followUp", sessionId, message}`. Outbound messages SHALL be `{type:"event", sessionId, event}` (where `event` is an `AgentEvent`) or `{type:"error", sessionId, message}`. Every outbound frame SHALL carry the `sessionId` so the client can route frames to the correct conversation.

#### Scenario: steer produces no immediate event frame
- **WHEN** a `steer` message is processed by the loop
- **THEN** no immediate event frame is sent; the steer's effects appear as normal text_delta/tool_execution events when the loop re-sends to the LLM
