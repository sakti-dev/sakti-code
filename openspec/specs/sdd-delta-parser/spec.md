## Purpose

The delta parser extracts requirement-level changes from delta spec files (under `openspec/changes/<name>/specs/<capability>/spec.md`). Delta specs describe what requirements are added, modified, removed, or renamed, using `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` section headers.

## Requirements

### Requirement: Requirement blocks are extracted from spec content

The system SHALL extract `### Requirement: <name>` blocks from a spec file's `## Requirements` section, capturing the header line, the requirement name, and the full raw block content (header + body text through the next requirement or section end).

#### Scenario: Requirement blocks are parsed in order
- **WHEN** a spec file has multiple requirements under `## Requirements`
- **THEN** each `### Requirement: <name>` block is extracted with its name and raw content

#### Scenario: Missing Requirements section creates an empty one
- **WHEN** a spec file has no `## Requirements` section
- **THEN** an empty Requirements section is created with no body blocks

### Requirement: Delta spec files are parsed into a DeltaPlan

A delta spec file SHALL be parsed into a DeltaPlan containing: added requirement blocks, modified requirement blocks, removed requirement names, renamed pairs, and presence flags for each section type. Section headers are matched case-insensitively.

#### Scenario: ADDED requirements are parsed
- **WHEN** a delta spec has an `## ADDED Requirements` section with requirement blocks
- **THEN** those blocks are extracted into the `added` array with their header, name, and raw content

#### Scenario: MODIFIED requirements are parsed
- **WHEN** a delta spec has a `## MODIFIED Requirements` section
- **THEN** the full requirement blocks (with updated content) are extracted

#### Scenario: REMOVED requirement names are parsed
- **WHEN** a delta spec has a `## REMOVED Requirements` section
- **THEN** the requirement names from `### Requirement:` headers or bullet-list references are extracted

#### Scenario: RENAMED pairs are parsed
- **WHEN** a delta spec has a `## RENAMED Requirements` section
- **THEN** FROM/TO pairs are extracted (e.g. `FROM: ### Requirement: Old Name` → `TO: ### Requirement: New Name`)

#### Scenario: Section presence is tracked
- **WHEN** a section type exists in the delta spec
- **THEN** its presence flag is `true`; absent sections have `false`

### Requirement: Change parser reads delta spec files from disk

When parsing a change, the system SHALL look for delta spec files in `specs/` subdirectories under the change directory. If delta specs exist, they take precedence over the simple delta format in the What Changes section.

#### Scenario: Delta spec files are discovered and parsed
- **WHEN** the change directory has `specs/<capability>/spec.md` files
- **THEN** each file is parsed for delta sections (ADDED, MODIFIED, REMOVED, RENAMED)

#### Scenario: Missing specs directory yields empty deltas
- **WHEN** the change directory has no `specs/` directory
- **THEN** no file-based deltas are returned

### Requirement: Names are normalized

The system SHALL normalize requirement names by trimming whitespace.

#### Scenario: Whitespace is trimmed
- **WHEN** a requirement name has leading or trailing whitespace
- **THEN** the whitespace is removed
