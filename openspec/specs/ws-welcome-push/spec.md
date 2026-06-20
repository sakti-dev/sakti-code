## Purpose

Defines the behavior when a WebSocket client connects to the server — a welcome frame is sent to inform the client about the server version and capabilities.

## Requirements

### Requirement: Welcome push on WebSocket connect
The system SHALL send a welcome frame to every newly connected WebSocket client immediately after the connection is established. The frame SHALL be `{ type: "welcome", version: string, cwd: string }` where `version` is the server version from `package.json` and `cwd` is the server's current working directory.

#### Scenario: Welcome frame on connect
- **WHEN** a WebSocket client connects to `/ws`
- **THEN** the client receives a `"welcome"` frame with the server version and cwd
- **AND** the frame arrives before any other messages

#### Scenario: Welcome frame sent once per connection
- **WHEN** a WebSocket client connects, receives the welcome frame, and the server restarts
- **THEN** the client reconnects and receives a new welcome frame with the updated version
