## Purpose

The no-op logger is a `Logger` implementation whose every method does nothing. It serves as the default logger parameter so that existing callers and tests that don't pass a logger are unaffected.

## Requirements

### Requirement: No-op logger satisfies the Logger contract

The no-op logger SHALL satisfy the Logger interface, providing `child`, `debug`, `error`, `info`, and `warn` methods.

#### Scenario: No-op logger conforms to Logger type
- **WHEN** a no-op logger is used where a Logger is expected
- **THEN** it satisfies the type contract

### Requirement: All methods return undefined without side effects

Calling any method on the no-op logger SHALL return `undefined` and produce no side effects (no I/O, no console output).

#### Scenario: Debug, error, info, warn all return undefined
- **WHEN** any logging method is called on the no-op logger
- **THEN** it returns `undefined` and does not throw

#### Scenario: Error with Error argument does not throw
- **WHEN** `error` is called with a message and an Error on the no-op logger
- **THEN** it does not throw and returns `undefined`

### Requirement: Child returns a no-op logger

The `child()` method SHALL return a new no-op Logger. A child derived from a no-op is also a no-op.

#### Scenario: Child of no-op is also a no-op
- **WHEN** `child()` is called on the no-op logger
- **THEN** a new Logger is returned whose methods are also no-ops

#### Scenario: Deeply nested children remain no-ops
- **WHEN** `child().child().warn("x")` is called on the no-op logger
- **THEN** it returns `undefined` without throwing
