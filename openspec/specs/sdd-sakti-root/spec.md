## Purpose

The Sakti root maintenance module inspects, ensures, and creates the `.sakti/` directory structure (config, specs, changes, archive) that forms the foundation of any Sakti project.

## Requirements

### Requirement: Sakti root structure is inspected

The system SHALL inspect a directory to determine if it has a valid Sakti root: a `.sakti/` directory containing `config.yaml` (or `config.yml`), `specs/`, `changes/`, and `changes/archive/`. It SHALL return an inspection report with presence flags for each component, a health status, and diagnostic messages for any missing or invalid components.

#### Scenario: Complete root is healthy
- **WHEN** a directory has `.sakti/` with config, specs, changes, and archive
- **THEN** all presence flags are true and healthy is true

#### Scenario: Missing sakti root reports diagnostics
- **WHEN** a directory has no `.sakti/`
- **THEN** the inspection reports the root as absent with a diagnostic

#### Scenario: Missing config reports diagnostic
- **WHEN** `.sakti/` exists but has no `config.yaml` or `config.yml`
- **THEN** the inspection reports config as absent with a diagnostic

#### Scenario: Missing subdirectories report diagnostics
- **WHEN** `.sakti/` is missing `specs/`, `changes/`, or `archive/`
- **THEN** each missing directory is reported in diagnostics

### Requirement: Sakti root can be created

The system SHALL create the `.sakti/` directory structure at a given root path, including: `.sakti/`, `.sakti/specs/`, `.sakti/changes/`, `.sakti/changes/archive/`, and a default `config.yaml`. It SHALL return an inspection and a ledger of created paths. The store root itself is created if it does not exist.

#### Scenario: Full structure is created
- **WHEN** `ensureSaktiRoot` is called on a path without a Sakti root
- **THEN** all required directories and a default config are created

#### Scenario: Existing structure is not re-created
- **WHEN** `ensureSaktiRoot` is called on a path that already has the full structure
- **THEN** no new directories or files are created

#### Scenario: Anchored directories get .gitkeep
- **WHEN** `ensureSaktiRoot` is called with `anchorEmptyDirectories: true`
- **THEN** empty `specs/` and `archive/` directories get a `.gitkeep` file

### Requirement: Created paths can be rolled back

The system SHALL roll back created files and directories in reverse creation order, using `fs.rm` for files and `fs.rmdir` for directories (which only removes empty directories).

#### Scenario: Rollback removes created artifacts
- **WHEN** rollback is called with a path ledger from a failed creation
- **THEN** all created files and directories are removed
