## Purpose

The Pino logger is the Node.js server-side logging backend. It writes structured JSON logs to rotating files via pino-roll (daily rotation, 10 MB size cap), with automatic redaction of secret-bearing fields (API keys, auth headers). It is the primary logger used in the Hono server process.

## Requirements

### Requirement: Logger is created with destination file, layer, and log directory

The system SHALL accept configuration for the log file destination (basename), a `layer` tag added to every record, a `logDir` for the directory, an optional minimum `level` (default `info`), optional redact paths override, optional test-injectable pino factory, and optional telemetry sink.

#### Scenario: Logger is created with required config
- **WHEN** a Pino logger is created with a `dest`, `layer`, and `logDir`
- **THEN** it produces a working Logger that writes to the configured destination

#### Scenario: Level defaults to info
- **WHEN** a Pino logger is created without specifying a level
- **THEN** the default minimum level is `info`

### Requirement: Logs are written to rotating files

The system SHALL write to a daily-rotating file in the configured `logDir`, with a 10 MB size cap and auto-created directories.

#### Scenario: File rotation is configured
- **WHEN** a log is emitted
- **THEN** it is written to a file in `logDir` with daily rotation and a 10 MB size cap

### Requirement: Secret-bearing fields are redacted

The system SHALL redact known secret-bearing fields by default: `apiKey`, `authorization`, and `cookie` at any nesting level, plus `err.responseHeaders.authorization` and `headers.authorization`/`headers.cookie`. Redacted values SHALL be replaced with `[REDACTED]`.

#### Scenario: API key is redacted
- **WHEN** a log call includes a context field containing an API key
- **THEN** the key's value is replaced with `[REDACTED]` in the log output

#### Scenario: Redact paths are customizable
- **WHEN** a Pino logger is created with custom `redactPaths`
- **THEN** those paths are used instead of the defaults

### Requirement: Layer tag is added to every record

Every log record SHALL carry the configured `layer` tag for identifying the source subsystem.

#### Scenario: Layer appears in every log record
- **WHEN** a Pino logger is configured with `layer: "server"` and a log is emitted
- **THEN** the log record includes `layer: "server"`

### Requirement: Log level routes to corresponding pino method

Each log call SHALL be forwarded to the matching pino method with context merged as a structured object.

#### Scenario: info maps to pino.info
- **WHEN** `info("started", { port: 3001 })` is called
- **THEN** pino's `info` is called with the context object and the message

#### Scenario: error includes structured error fields
- **WHEN** `error("failed", apiCallError)` is called
- **THEN** the pino record includes the error's diagnostic fields (statusCode, url, etc.) in a structured `err` object, plus the one-line description in `error`

### Requirement: Child logger merges pinned context

The `child()` method SHALL return a new Logger sharing the same underlying pino instance, with extra pinned context merged into every call.

#### Scenario: Child adds context without creating new pino instance
- **WHEN** `child({ module: "stream" })` is called on a Pino logger
- **THEN** all subsequent calls include `module: "stream"` in the log record

### Requirement: Telemetry sink receives every entry

Every log call SHALL also be forwarded to the configured telemetry sink as a `LogEntry`.

#### Scenario: Telemetry sink records all entries
- **WHEN** a log is emitted through the Pino logger
- **THEN** the telemetry sink's `record` is called with the entry

### Requirement: Pino factory is injectable for testing

The system SHALL accept an optional pino factory function to replace the real pino instance (which uses a worker-thread file transport), making the adapter unit-testable.

#### Scenario: Fake pino factory replaces real pino
- **WHEN** a Pino logger is created with a `pinoFactory` option
- **THEN** the factory is used instead of creating a real pino instance
