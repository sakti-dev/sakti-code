## Purpose

Provides a list of available slash commands to the client, used by the UI to display and suggest commands to the user. For v1 the list is hardcoded, extensible in the future.

## Requirements

### Requirement: List available slash commands
The system SHALL expose `GET /api/commands` returning a list of available slash commands. The response SHALL contain `{ commands: Array<{ name: string, description: string }> }`. For v1, the list SHALL be hardcoded.

#### Scenario: List slash commands
- **WHEN** `GET /api/commands` is called
- **THEN** the response status is 200 and the body contains an array of commands with `name` and `description` fields
- **AND** the list includes at least: `search`, `clear`, `compact`, `help`

### Requirement: Commands list is extensible
The commands list SHALL be returned from a function that can be updated to read from a dynamic source in the future without changing the route handler's response format.

#### Scenario: Commands format is stable
- **WHEN** a new command is added to the source function
- **THEN** the route returns it without any route handler changes
