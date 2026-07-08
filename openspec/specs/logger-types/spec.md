## Purpose

Logger types define the shared contracts for the entire logging subsystem: severity levels, structured context, log entries, the `Logger` interface, and the telemetry sink interface. These types are exported from `@sakti-code/logger` and consumed by all logger implementations and callers.

## Requirements

### Requirement: LogLevel is one of four severity levels

The system SHALL define four log severity levels: `debug`, `error`, `info`, and `warn`.

#### Scenario: All four levels exist
- **WHEN** any log level is specified
- **THEN** it SHALL be one of `debug`, `error`, `info`, or `warn`

### Requirement: LogContext carries structured key/value metadata

The system SHALL support attaching arbitrary key/value metadata to a log call, with conventional tags `domain`, `module`, and `scope` for filtering and formatting.

#### Scenario: Standard context tags are supported
- **WHEN** a logger is called with `{ domain: "LLM", module: "stream" }`
- **THEN** the context carries `domain` and `module` as string values

#### Scenario: Arbitrary keys are allowed
- **WHEN** a logger is called with `{ attempt: 2, model: "deepseek" }`
- **THEN** the context carries those keys without type errors

### Requirement: LogEntry is a structured-cloneable record

A log entry SHALL carry `level`, `message`, and optional `context`. The shape SHALL be serializable via `structuredClone`.

#### Scenario: Entry carries level, message, and optional context
- **WHEN** a log entry is created
- **THEN** it SHALL have `level` and `message` as required fields, `context` as optional

### Requirement: Logger defines message-first contract

A Logger SHALL provide methods: `child()` to create a derived logger with pinned context, plus `debug`, `error`, `info`, and `warn` methods that accept a message string and optional context. The `error` variant SHALL accept the error as a separate argument.

#### Scenario: Error takes error as separate argument
- **WHEN** a logger's `error` method is called with a message, an Error, and context
- **THEN** the implementation receives the message, error, and context as distinct values

#### Scenario: Child returns a new logger with pinned context
- **WHEN** `child()` is called on a logger with context
- **THEN** a new Logger is returned that merges that context into every subsequent call

### Requirement: TelemetrySink defines the telemetry destination

The system SHALL define a TelemetrySink with a `record()` method and an optional `flush()` method. A default no-op sink SHALL exist that discards every entry, so call sites never null-check the sink.

#### Scenario: TelemetrySink has record and optional flush
- **WHEN** a TelemetrySink is created
- **THEN** it SHALL have a `record` function and an optional `flush` function

#### Scenario: No-op sink discards without throwing
- **WHEN** the no-op telemetry sink receives a log entry
- **THEN** it returns without persisting or throwing
