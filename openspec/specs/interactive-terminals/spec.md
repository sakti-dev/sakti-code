## Purpose

Interactive terminals provide full PTY shell sessions managed via REST endpoints and WebSocket push channels.

## Requirements

### Requirement: TerminalManager manages PTY sessions
The system SHALL provide a `TerminalManager` service that wraps bun-pty's `spawn()` for creating interactive shell sessions. The manager SHALL track terminals by ID, associate each with a WebSocket connection ID, and provide callbacks for data and exit events.

#### Scenario: Create a terminal
- **WHEN** `terminalManager.create(connectionId, { cwd: "/home/user/project", cols: 80, rows: 24 })` is called
- **THEN** a PTY shell is spawned in the given directory with the given dimensions
- **AND** a unique `terminalId` and the shell `pid` are returned

#### Scenario: Write data to terminal
- **WHEN** `terminalManager.write(terminalId, "echo hello\n")` is called
- **THEN** the data is written to the terminal's stdin

#### Scenario: Resize terminal
- **WHEN** `terminalManager.resize(terminalId, 120, 40)` is called
- **THEN** the PTY dimensions are updated to 120 columns and 40 rows

#### Scenario: Close terminal
- **WHEN** `terminalManager.close(terminalId)` is called
- **THEN** the PTY process is killed and the terminal is removed from the manager

#### Scenario: Close all terminals for a connection
- **WHEN** `terminalManager.closeByConnection(connectionId)` is called
- **THEN** all terminals owned by that connection are killed and removed

### Requirement: Terminal creation REST endpoint
The system SHALL expose `POST /api/terminals` accepting body `{ cwd?: string, cols?: number, rows?: number }`. The terminal SHALL be created via `TerminalManager.create()` using the requesting connection's ID. The response SHALL contain `{ terminalId: string, pid: number }`.

#### Scenario: Create a new terminal
- **WHEN** `POST /api/terminals` is called with `{ cwd: "/home/user/project" }`
- **THEN** the response status is 200 and the body contains `terminalId` and `pid`

#### Scenario: Terminal creation with custom dimensions
- **WHEN** `POST /api/terminals` is called with `{ cols: 120, rows: 40 }`
- **THEN** the terminal is created with those dimensions

### Requirement: Terminal write REST endpoint
The system SHALL expose `POST /api/terminals/:id/write` accepting body `{ data: string }`. Unknown terminal IDs SHALL return HTTP 404.

#### Scenario: Write to terminal
- **WHEN** `POST /api/terminals/:id/write` is called with `{ data: "ls -la\n" }`
- **THEN** the data is written to the terminal's stdin and the response status is 200

#### Scenario: Write to unknown terminal
- **WHEN** `POST /api/terminals/nope/write` is called
- **THEN** the response status is 404

### Requirement: Terminal resize REST endpoint
The system SHALL expose `POST /api/terminals/:id/resize` accepting body `{ cols: number, rows: number }`. Unknown terminal IDs SHALL return HTTP 404.

#### Scenario: Resize terminal
- **WHEN** `POST /api/terminals/:id/resize` is called with `{ cols: 100, rows: 30 }`
- **THEN** the terminal dimensions are updated and the response status is 200

### Requirement: Terminal close REST endpoint
The system SHALL expose `DELETE /api/terminals/:id`. Unknown terminal IDs SHALL return HTTP 404.

#### Scenario: Close terminal
- **WHEN** `DELETE /api/terminals/:id` is called
- **THEN** the terminal is killed and the response status is 200

### Requirement: Terminal data pushed via WebSocket
When a terminal produces output, the server SHALL push `{ type: "push", channel: "terminal.data", data: { terminalId, data } }` to the WebSocket connection that owns the terminal.

#### Scenario: Terminal output pushed to owning connection
- **WHEN** a terminal's shell writes output
- **THEN** the owning WebSocket connection receives a push message with `channel: "terminal.data"` containing the terminal ID and output data

### Requirement: Terminal exit pushed via WebSocket
When a terminal process exits, the server SHALL push `{ type: "push", channel: "terminal.exit", data: { terminalId, exitCode, signal? } }` to the owning WebSocket connection. The terminal SHALL be removed from the manager after exit.

#### Scenario: Terminal exit pushed
- **WHEN** a terminal's shell process exits
- **THEN** the owning WebSocket connection receives a push message with `channel: "terminal.exit"` containing the exit code

### Requirement: Terminal cleanup on WebSocket disconnect
When a WebSocket connection closes, all terminals owned by that connection SHALL be killed and removed from the manager.

#### Scenario: Terminals cleaned up on disconnect
- **WHEN** a WebSocket connection closes
- **THEN** `TerminalManager.closeByConnection(connectionId)` is called and all owned terminals are killed
