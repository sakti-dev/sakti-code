## Purpose

Change metadata utilities handle reading, writing, and resolving the `.sakti.yaml` metadata file for change directories. Metadata includes the workflow schema, creation date, state machine fields (phase, workflow type, build decisions, verification status), and optional initiative links.

## Requirements

### Requirement: Metadata is validated against a Zod schema

The system SHALL define a Zod schema (`ChangeMetadataSchema`) that validates metadata with required and optional fields, including: `schema` (required, non-empty string), `created` (optional ISO date YYYY-MM-DD), `goal`, `affected_areas`, `initiative` (portable link with `store` and `id` in kebab-case), and state machine fields (`workflow`, `phase`, `build_mode`, `build_pause`, `subagent_dispatch`, `review_mode`, `isolation`, `direct_override`, `verify_mode`, `verify_result`, `verification_report`, `branch_status`, `plan`, `base_ref`, `verified_at`, `archived`).

#### Scenario: Valid metadata is accepted
- **WHEN** metadata with a valid `schema` string is provided
- **THEN** the schema passes validation

#### Scenario: Empty schema is rejected
- **WHEN** metadata with an empty `schema` string is provided
- **THEN** validation fails

#### Scenario: Missing schema is rejected
- **WHEN** metadata without a `schema` field is provided
- **THEN** validation fails

#### Scenario: Created date must be in YYYY-MM-DD format
- **WHEN** a `created` date in a different format (e.g. MM/DD/YYYY or missing leading zeros) is provided
- **THEN** validation fails

### Requirement: Initiative links are portable identifiers

Initiative links SHALL be strict objects with `store` and `id` fields, both in kebab-case (lowercase letters, numbers, single hyphen separators). They SHALL NOT carry `path` or `summary` fields.

#### Scenario: Valid initiative link is accepted
- **WHEN** an initiative link with `store: "platform"` and `id: "billing-launch"` is provided
- **THEN** validation passes

#### Scenario: Initiative with local path or summary is rejected
- **WHEN** an initiative link includes `path` or `summary` fields
- **THEN** validation fails

#### Scenario: Unsafe initiative identifiers are rejected
- **WHEN** the `store` or `id` contains path separators, spaces, or uppercase letters
- **THEN** validation fails

### Requirement: Metadata can be written to a change directory

The system SHALL write validated metadata to `.sakti.yaml` in the change directory as YAML. It SHALL validate the schema name against available schemas and validate the metadata structure before writing.

#### Scenario: Valid metadata is written as YAML
- **WHEN** metadata with a known schema and created date is written
- **THEN** a `.sakti.yaml` file is created containing the correct YAML

#### Scenario: Unknown schema name throws
- **WHEN** metadata with an unknown schema name is written
- **THEN** an error is thrown indicating the schema is unknown

### Requirement: Metadata can be read from a change directory

The system SHALL read and validate metadata from `.sakti.yaml`. If no metadata file exists, it returns null. If the file exists but contains invalid YAML or fails validation, it throws a `ChangeMetadataError`.

#### Scenario: No metadata file returns null
- **WHEN** reading metadata from a directory without `.sakti.yaml`
- **THEN** null is returned

#### Scenario: Valid metadata is read and returned
- **WHEN** reading metadata from a directory with a valid `.sakti.yaml`
- **THEN** the validated metadata object is returned

#### Scenario: Invalid YAML throws
- **WHEN** the metadata file contains invalid YAML
- **THEN** a `ChangeMetadataError` is thrown

#### Scenario: Missing required fields throws
- **WHEN** the metadata file is valid YAML but missing the `schema` field
- **THEN** a `ChangeMetadataError` is thrown

#### Scenario: Unknown schema in metadata throws
- **WHEN** the metadata file references a schema name that doesn't exist
- **THEN** a `ChangeMetadataError` is thrown mentioning the unknown schema

### Requirement: Schema is resolved with precedence

The system SHALL resolve the active schema for a change directory in this order: (1) explicit CLI override, (2) schema from `.sakti.yaml` metadata, (3) schema from project config (`config.yaml`), (4) default `"spec-driven"`.

#### Scenario: Explicit schema wins over all
- **WHEN** an explicit schema is provided alongside metadata and project config
- **THEN** the explicit schema is returned

#### Scenario: Metadata schema wins over project config
- **WHEN** no explicit schema is given but both metadata and project config exist
- **THEN** the metadata's schema is returned

#### Scenario: Project config schema wins over default
- **WHEN** no explicit schema and no metadata file exist but project config has a schema
- **THEN** the project config schema is returned

#### Scenario: Default is returned when no other source exists
- **WHEN** no explicit schema, metadata, or project config provide a schema
- **THEN** `"spec-driven"` is returned

### Requirement: Schema names are validated against available schemas

The system SHALL check that a schema name exists in the available schemas list, throwing an error if it does not.

#### Scenario: Valid schema name passes
- **WHEN** a known schema name is validated
- **THEN** no error is thrown

#### Scenario: Unknown schema name throws
- **WHEN** an unknown schema name is validated
- **THEN** an error is thrown listing available schemas
