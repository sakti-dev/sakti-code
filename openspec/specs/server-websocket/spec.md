## Purpose

The WebSocket server provides real-time agent streaming over `/ws`. It uses Hono's `upgradeWebSocket` with a `ws` `WebSocketServer` for upgrade, validates inbound frames against a TypeBox schema, dispatches messages to `handleMessage`, and maintains per-connection `SqliteSessionStorage` instances for isolated persistence. A welcome frame is sent on connection open. Terminal data/exit events are pushed to connections via the `TerminalManager`.

## Requirements

### Requirement: WebSocket upgrade at /ws

The system SHALL register a WebSocket handler at `/ws` via Hono's `upgradeWebSocket`. The upgrade is handled by `@hono/node-server` passing a `ws` `WebSocketServer` in the `websocket.server` option. Each connection gets a unique ID.

#### Scenario: WS connection established
- **WHEN** a client connects to `/ws`
- **THEN** the WebSocket is upgraded and a welcome frame is sent

### Requirement: Welcome frame on connection

The system SHALL send a `{ type: "welcome", version, cwd }` frame immediately on connection open. The `version` is the server package version.

#### Scenario: Welcome frame received
- **WHEN** a client connects
- **THEN** the first received frame is `{ type: "welcome", version: "<semver>", cwd: "<cwd>" }`

### Requirement: Inbound frame validation

The system SHALL validate every inbound text frame against a TypeBox schema (`wsBodySchema`). Frames that are not text, fail JSON parsing, fail schema validation, or lack `sessionId` SHALL receive an error frame and be discarded.

#### Scenario: Non-text frame rejected
- **WHEN** a binary frame is received
- **THEN** an `{ type: "error", error: "Text frames only", sessionId: "" }` frame is sent

#### Scenario: Invalid JSON rejected
- **WHEN** a text frame that is not valid JSON is received
- **THEN** an error frame with `"Invalid JSON"` is sent

#### Scenario: Missing sessionId rejected
- **WHEN** a valid JSON frame lacks `sessionId`
- **THEN** an error frame with `"Missing sessionId"` is sent

### Requirement: Per-connection SqliteSessionStorage

The system SHALL create `SqliteSessionStorage` instances per connection-session pair, keyed by `wsId:sessionId`. Storage is reused within the same connection and session. On connection close, all storage for that connection is cleaned up.

#### Scenario: Storage created on first prompt
- **WHEN** a prompt message arrives for session "abc" on connection 1
- **THEN** a `SqliteSessionStorage` is created for that session and reused for subsequent messages

#### Scenario: Storage cleaned on disconnect
- **WHEN** a WebSocket connection closes
- **THEN** all `SqliteSessionStorage` instances for that connection are removed from the map

### Requirement: Message dispatch to handleMessage

The system SHALL dispatch validated inbound messages to `handleMessage(ctx, storage, handle, msg)` which handles prompt, abort, steer, followUp, and other message types.

#### Scenario: Prompt dispatched
- **WHEN** a `{ type: "prompt", sessionId, message }` frame is received
- **THEN** `handleMessage` is called with the message

### Requirement: Terminal push to connections

The system SHALL wire `TerminalManager` callbacks so terminal data and exit events are pushed to the owning connection as `{ type: "push", channel: "terminal.data"|"terminal.exit", data }` frames.

#### Scenario: Terminal output pushed
- **WHEN** a terminal emits data
- **THEN** the owning WebSocket connection receives a push frame with the terminal data

#### Scenario: Terminal exit pushed
- **WHEN** a terminal process exits
- **THEN** the owning connection receives a push frame with the exit code

### Requirement: Connection cleanup on close

The system SHALL remove the connection from the registry, clear per-connection storage, and close all terminals owned by that connection.

#### Scenario: Full cleanup on disconnect
- **WHEN** a WebSocket connection closes
- **THEN** the connection is removed from the registry, storage is cleared, and associated terminals are closed

### Requirement: Connection registry for push

The system SHALL maintain a `Map<string, WsHandle>` of active WebSocket connections. `pushToConnection(id, data)` sends a frame to a specific connection. `hasWsConnection(id)` checks if a connection is active.

#### Scenario: Push to active connection
- **WHEN** `pushToConnection(id, data)` is called for an active connection
- **THEN** the data is serialized and sent

#### Scenario: Push to inactive connection
- **WHEN** `pushToConnection(id, data)` is called for a disconnected client
- **THEN** no error is thrown (the send is a no-op)
