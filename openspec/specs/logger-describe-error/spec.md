## Purpose

Error description normalizes any thrown or logged value into a flat string for log output, ensuring logging never throws even on circular references.

## Requirements

### Requirement: Error is normalized to its message for Error instances

The system SHALL convert `Error` instances to their `.message` property when producing a string description.

#### Scenario: Error becomes its message
- **WHEN** an `Error` with message `"boom"` is described
- **THEN** the result is `"boom"`

### Requirement: String values pass through as-is

The system SHALL return string values unchanged.

#### Scenario: String input returns the same string
- **WHEN** a plain string is described
- **THEN** the result is that string

### Requirement: Non-string, non-Error values are converted

The system SHALL convert numbers, objects, `undefined`, and `null` to string representations.

#### Scenario: Objects are serialized
- **WHEN** a plain object like `{ a: 1 }` is described
- **THEN** the result is a serialized representation containing `"a":1`

#### Scenario: undefined and null produce non-empty strings
- **WHEN** `undefined` or `null` is described
- **THEN** the result is a non-empty string

### Requirement: Circular references are handled without throwing

The system SHALL handle objects with circular references without throwing, producing output that includes non-circular keys.

#### Scenario: Circular object does not throw
- **WHEN** an object that references itself is described
- **THEN** no error is thrown

#### Scenario: Non-circular keys survive in circular object output
- **WHEN** an object with both circular and non-circular keys is described
- **THEN** the output includes the non-circular keys' values
