## Purpose

Error field extraction pulls diagnostic fields from AI SDK / HTTP errors and flattens them into structured log context, so upstream failure reasons (status codes, response bodies, URLs) survive into structured logs alongside the one-line error message.

## Requirements

### Requirement: Non-errors produce no fields

The system SHALL return an empty context when given non-Error values or `undefined`.

#### Scenario: undefined returns empty
- **WHEN** `undefined` is passed
- **THEN** the result is an empty context

#### Scenario: Non-error primitives return empty
- **WHEN** a string or number is passed
- **THEN** the result is an empty context

### Requirement: Error name and message are always extracted

The system SHALL extract `name` and `message` from any `Error` instance.

#### Scenario: Plain Error provides name and message
- **WHEN** a plain `Error` is extracted
- **THEN** the result includes `name` (e.g. `"Error"`) and `message`

### Requirement: AI SDK HTTP error fields are extracted

The system SHALL extract known AI SDK error fields: `url`, `statusCode`, `responseBody`, `responseHeaders`, `isRetryable`, and the generic `status`/`data` fields. `requestBodyValues` SHALL be excluded (may carry secrets).

#### Scenario: APICallError fields are surfaced
- **WHEN** an error with `url`, `statusCode`, `responseBody`, `responseHeaders`, and `isRetryable` is extracted
- **THEN** all those fields appear in the result

#### Scenario: requestBodyValues is excluded
- **WHEN** an error carries `requestBodyValues`
- **THEN** `requestBodyValues` is NOT present in the result

#### Scenario: Numeric status is captured alongside statusCode
- **WHEN** an error has a `status` field (e.g. 429)
- **THEN** that field appears in the result

### Requirement: Nested cause is recursively described

The system SHALL extract a recursively-described string representation of an error's `cause`.

#### Scenario: Cause is serialized as a string
- **WHEN** an error wraps another as its `cause`
- **THEN** the result includes a `cause` field with the inner error's message as a string

### Requirement: Malformed errors do not throw

The system SHALL not throw when given a malformed or non-enumerable error-like object.

#### Scenario: Malformed Error does not throw
- **WHEN** a non-standard error-like object is extracted
- **THEN** no error is thrown
