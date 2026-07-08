## Purpose

The forwarding logger prints a formatted line to the DevTools console AND sends a sanitized log entry to a transport callback (the renderer's IPC bridge to the desktop log file). Used in the Electron renderer process to dual-write logs to both the console and the persisted log file.

## Requirements

### Requirement: Transport receives level, message, and sanitized context

The system SHALL call the transport callback with a `LogEntry` containing the log level, message, and a sanitized copy of the context (circular-reference-safe).

#### Scenario: Transport receives level/message with context
- **WHEN** a logger's `info` method is called with a message and context
- **THEN** the transport receives an entry with the level, message, and sanitized context

#### Scenario: Context is omitted when empty
- **WHEN** a logger's method is called with no context
- **THEN** the transport receives an entry with only level and message (no context field)

### Requirement: Context is sanitized for IPC

The context SHALL be deep-cloned in a circular-reference-safe way before being sent to the transport, guaranteeing the entry is `structuredClone`-able across the IPC boundary.

#### Scenario: Circular references are removed from transport context
- **WHEN** a log call includes a context with circular references
- **THEN** the transport receives a sanitized entry that passes `structuredClone` without throwing

### Requirement: Console output respects minLevel

The system SHALL support a `minLevel` option that suppresses console output for levels below the threshold (e.g. suppress `debug` in production). The transport always fires regardless of `minLevel`.

#### Scenario: Debug suppressed when minLevel is info
- **WHEN** a logger is created with `minLevel: "info"` and `debug(...)` is called
- **THEN** no console output is produced, but the transport still receives the entry

### Requirement: Transport failure does not break console output

If the transport callback throws (e.g. IPC bridge down), the system SHALL catch the error silently and continue to print to the console.

#### Scenario: Throwing transport still prints to console
- **WHEN** the transport throws and a log is emitted
- **THEN** the console output is still produced and no error propagates to the caller

### Requirement: Error argument is folded into context

When the `error` argument is provided, the error SHALL be normalized to a string and included in the context before sending to both the console and the transport.

#### Scenario: Error appears in context.error
- **WHEN** a logger's `error` method is called with a message and an Error
- **THEN** the transport receives an entry with `context.error` containing the error's message

### Requirement: Child logger merges context

The `child()` method SHALL return a new forwarding logger that merges the given context into every subsequent call.

#### Scenario: Child logger pins domain
- **WHEN** a forwarding logger creates a child with `{ domain: "WS" }` and logs a message
- **THEN** the transport entry's context includes `domain: "WS"`
