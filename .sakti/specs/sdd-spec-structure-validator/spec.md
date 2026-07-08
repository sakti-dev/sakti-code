## Purpose

The spec structure validator checks main spec files for structural issues: delta headers that should only appear in change specs, and requirement headers that appear outside the `## Requirements` section.

## Requirements

### Requirement: Delta headers are flagged in main specs

The system SHALL detect `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` headers in main spec files (under `openspec/specs/`). These headers are only valid inside change delta spec files.

#### Scenario: Delta header in main spec is flagged
- **WHEN** a main spec file contains `## ADDED Requirements` (or MODIFIED, REMOVED, RENAMED)
- **THEN** an issue with kind `"delta-header"` is reported with the line number and header text

#### Scenario: Delta header in fenced code block is NOT flagged
- **WHEN** a delta header appears inside a fenced code block (triple backticks or tildes)
- **THEN** it is not flagged as an issue

### Requirement: Requirements outside the Requirements section are flagged

The system SHALL detect `### Requirement:` headers that appear outside the `## Requirements` section. These requirements are invisible to the parser.

#### Scenario: Requirement outside section is flagged
- **WHEN** a `### Requirement:` header appears before or after the `## Requirements` section
- **THEN** an issue with kind `"requirement-outside-requirements"` is reported

#### Scenario: Requirement inside section is NOT flagged
- **WHEN** a `### Requirement:` header is between `## Requirements` and the next `##` header
- **THEN** no issue is reported

### Requirement: Code fences are stripped for validation

The system SHALL replace fenced code block lines with empty strings before checking headings, so code examples with delta headers don't produce false positives.

#### Scenario: Fence content is blanked
- **WHEN** a spec file contains a fenced code block with `## ADDED Requirements` inside
- **THEN** the validator replaces the fence lines with empty strings before checking
