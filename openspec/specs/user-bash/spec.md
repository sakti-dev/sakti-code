## Purpose

User bash allows executing shell commands independently from the agent loop. The output is shown in the UI; users who want the agent to see it paste it as a user message.

## Requirements

### Requirement: User bash executes a shell command
The system SHALL expose `POST /api/sessions/:id/bash` accepting a body `{ command: string, timeout?: number }`. The command SHALL be executed via `Bun.spawn` scoped to the session's project cwd with a default timeout of 30 seconds. The response SHALL contain `{ output: string, exitCode: number | null, cancelled: boolean, truncated: boolean }`. Unknown sessions SHALL return HTTP 404.

#### Scenario: Execute a simple command
- **WHEN** `POST /api/sessions/:id/bash` is called with `{ command: "echo hello" }` for a valid session
- **THEN** the response status is 200 and the body contains `{ output: "hello\n", exitCode: 0, cancelled: false, truncated: false }`

#### Scenario: Command with non-zero exit
- **WHEN** `POST /api/sessions/:id/bash` is called with `{ command: "exit 1" }`
- **THEN** the response status is 200 and the body contains `{ exitCode: 1, output: "(no output)", cancelled: false, truncated: false }`

#### Scenario: Unknown session returns 404
- **WHEN** `POST /api/sessions/nope/bash` is called
- **THEN** the response status is 404

#### Scenario: Command timeout
- **WHEN** `POST /api/sessions/:id/bash` is called with `{ command: "sleep 10", timeout: 1 }`
- **THEN** the response status is 200 and the body contains `{ cancelled: true, output: "[Command timed out after 1s]" }`

#### Scenario: Output truncation at 100KB
- **WHEN** a command produces more than 100KB of output
- **THEN** the response body has `truncated: true` and the output is truncated to approximately 100KB

### Requirement: User bash abort
The system SHALL expose `POST /api/sessions/:id/abort-bash` that kills a running bash command for the given session. If a bash command is running, the process SHALL be killed and the route returns `{ ok: true }`. If no bash command is running, the route SHALL return `{ ok: true }` (idempotent). Unknown sessions SHALL return HTTP 404.

#### Scenario: Abort a running bash
- **WHEN** `POST /api/sessions/:id/abort-bash` is called while a bash command is running for that session
- **THEN** the response status is 200 with `{ ok: true }` and the running process is killed

#### Scenario: Abort with no running bash
- **WHEN** `POST /api/sessions/:id/abort-bash` is called for a session with no active bash command
- **THEN** the response status is 200 with `{ ok: true }` (no-op)

### Requirement: User bash is scoped to project cwd
The bash command SHALL execute in the session's project working directory, resolved via `ProjectRepo.findById(session.projectId).cwd`.

#### Scenario: Bash runs in project directory
- **WHEN** a session's project has cwd `/home/user/project` and `bash` is called with `{ command: "pwd" }`
- **THEN** the output is `/home/user/project\n`
