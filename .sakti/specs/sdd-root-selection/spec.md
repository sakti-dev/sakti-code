## Purpose

Root selection resolves the Sakti project root directory — the nearest ancestor containing a qualifying `.sakti/` directory (one with a planning shape or config file). It is used by virtually every SDD command to locate the project's specs, changes, and archive directories.

## Requirements

### Requirement: Root is resolved from the nearest qualifying ancestor

The system SHALL walk up from a starting path to find the nearest ancestor whose `.sakti/` directory has either a planning shape or a config file. A bare `.sakti/` directory alone (without planning shape or config) is NOT a qualifying root.

#### Scenario: Qualifying root is found
- **WHEN** an ancestor directory contains a `.sakti/` with a `config.yaml` or planning shape
- **THEN** that ancestor is returned as the root with source `"nearest"`

#### Scenario: Bare .sakti/ without config is not a root
- **WHEN** an ancestor has a `.sakti/` directory but it lacks config or planning shape
- **THEN** the walk continues to higher ancestors

### Requirement: Implicit root is used when no qualifying root exists

When no qualifying root is found and `allowImplicitRoot` is true, the system SHALL treat the current directory (or specified start path) as an implicit root.

#### Scenario: No root found returns implicit root
- **WHEN** no qualifying root exists and implicit root is allowed
- **THEN** the current directory is returned as root with source `"implicit"`

#### Scenario: Explicit root required throws
- **WHEN** no qualifying root exists and `allowImplicitRoot` is false
- **THEN** a `RootSelectionError` is thrown with code `"no_sakti_root"` and a fix suggestion

### Requirement: Root object exposes standard subdirectories

A resolved root SHALL expose: `path` (the root directory), `changesDir`, `specsDir`, `archiveDir`, `defaultSchema` (`"spec-driven"`), and `source` (`"nearest"` or `"implicit"`).

#### Scenario: Standard paths are derived
- **WHEN** a root is resolved
- **THEN** changesDir is `.sakti/changes`, specsDir is `.sakti/specs`, archiveDir is `.sakti/changes/archive`

### Requirement: CLI adapter handles JSON mode

The `resolveRootForCommand` function SHALL support a JSON mode: on failure, it prints a machine-readable JSON payload with diagnostic info and returns null; in human mode, it lets the error propagate.

#### Scenario: JSON mode prints error payload
- **WHEN** root resolution fails in JSON mode
- **THEN** a JSON object with status diagnostic is written to stdout and null is returned

#### Scenario: Human mode propagates error
- **WHEN** root resolution fails in human mode
- **THEN** the error is thrown for the command's standard error handling
