## Purpose

The console logger outputs formatted log lines to the browser/renderer DevTools console. Each line is tagged with `[DOMAIN:ACTION] message key=value …` for greppable, scannable output. It is the primary logger used in the desktop renderer process.

## Requirements

### Requirement: Log level routes to the matching console method

The system SHALL route each log level to a specific console method: `info` and `warn` to their matching console methods, `error` to `console.error`, and `debug` to `console.log`.

#### Scenario: info prints to console.info
- **WHEN** a logger's `info` method is called with a message
- **THEN** `console.info` is called with a formatted line containing the message

#### Scenario: error prints to console.error with the error message
- **WHEN** a logger's `error` method is called with a message and an Error
- **THEN** `console.error` is called and the output includes both the message and the error's message text

#### Scenario: warn prints to console.warn
- **WHEN** a logger's `warn` method is called
- **THEN** `console.warn` is called

#### Scenario: debug prints to console.log
- **WHEN** a logger's `debug` method is called
- **THEN** `console.log` is called

### Requirement: Line format is [DOMAIN:ACTION] message key=value

Each log line SHALL be formatted as `[DOMAIN:ACTION] message key=value …`. The domain SHALL be inferred from context or default to `UI`. The action SHALL be derived from the message text. Context keys designated for internal routing SHALL be excluded from the `key=value` tail.

#### Scenario: Internal context keys are excluded from key=value tail
- **WHEN** a logger with `{ domain: "UI", module: "app" }` logs a message
- **THEN** `domain` and `module` are NOT rendered in the `key=value` tail

#### Scenario: Caller-provided context keys are rendered
- **WHEN** a logger is called with `{ attempt: 2, model: "gpt" }`
- **THEN** the log line contains `attempt=2 model=gpt`

#### Scenario: Values containing special characters are safely quoted
- **WHEN** a context value contains whitespace, quotes, or `=`
- **THEN** the value is quoted in the output to keep the line unambiguous

### Requirement: Error argument is folded into the output

When the `error` argument is provided to the `error` method, the system SHALL normalize the error and include its description in the output.

#### Scenario: Error message appears in the log line
- **WHEN** a logger's `error` method is called with a message and an Error
- **THEN** the error's message text appears somewhere in the formatted output

### Requirement: Child logger merges pinned context

The `child()` method SHALL return a new Logger that merges the provided context into every subsequent call.

#### Scenario: Child logger preserves parent domain
- **WHEN** a logger with a pinned domain creates a child and logs a message
- **THEN** the output line retains the parent's domain prefix

### Requirement: Domain can be pinned at creation

The system SHALL provide a way to create a logger with a specific domain pinned upfront, so callers don't have to pass `{ domain }` on every call.

#### Scenario: Domain-pinned logger uses that domain in its output
- **WHEN** a logger is created with a specific domain and logs a message
- **THEN** the output line starts with that domain's tag
