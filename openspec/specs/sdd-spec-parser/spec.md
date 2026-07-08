## Purpose

The spec parser reads markdown spec (`spec.md`) and change proposal (`proposal.md`) files and extracts structured data: requirements, scenarios, section hierarchy, and delta operations. It is used by the SDD system to process all spec and change documents.

## Requirements

### Requirement: Spec files are parsed into structured objects

The system SHALL parse a spec markdown file into a structured object containing: the spec name, an overview from the `## Purpose` section, and an array of requirements (each with text and scenarios). A spec MUST have a `## Purpose` section and a `## Requirements` section.

#### Scenario: Valid spec is parsed correctly
- **WHEN** a spec with Purpose, Requirements, and requirement sections is parsed
- **THEN** the spec name, overview text, and requirements array (with their scenarios) are extracted

#### Scenario: Missing Purpose section throws
- **WHEN** a spec without a `## Purpose` section is parsed
- **THEN** an error is thrown indicating the Purpose section is required

#### Scenario: Missing Requirements section throws
- **WHEN** a spec without a `## Requirements` section is parsed
- **THEN** an error is thrown indicating the Requirements section is required

### Requirement: Requirement text is extracted from content lines

The system SHALL use the first non-empty content line after a requirement heading as the requirement text, falling back to the heading itself if no content follows.

#### Scenario: First content line is used as requirement text
- **WHEN** a requirement heading has content lines after it
- **THEN** the first non-empty content line is the requirement text

#### Scenario: Heading is used when no content follows
- **WHEN** a requirement heading has no content before scenarios
- **THEN** the heading text becomes the requirement text

### Requirement: Scenarios are extracted from child sections

Scenarios under a requirement SHALL be extracted with their full raw text content preserved.

#### Scenario: Scenario content is preserved
- **WHEN** a spec has requirement with scenarios containing multi-line Gherkin-style text
- **THEN** the full raw text of each scenario is preserved

### Requirement: Sections are parsed hierarchically

The system SHALL parse markdown headings into a nested section tree, respecting heading level (`#`, `##`, `###`, `####`). Content between headings belongs to the nearest ancestor heading.

#### Scenario: Nested sections form a tree
- **WHEN** a document has `## Requirements > ### Requirement > #### Scenario` structure
- **THEN** sections form a hierarchy: Requirements contains requirements, which contain scenarios

#### Scenario: Content between headers is preserved as section content
- **WHEN** a section has content before its first child heading
- **THEN** that content is preserved as the section's content

### Requirement: Code-fenced blocks are ignored during parsing

Content inside fenced code blocks (triple backticks or tildes) SHALL be excluded from heading detection. A closing fence requires the same marker type and at least the same length. Lines with fence-like markers but trailing content are NOT treated as closing fences.

#### Scenario: Fenced code blocks don't create false headings
- **WHEN** a code fence contains lines that look like markdown headings
- **THEN** those headings are ignored and not parsed as sections

#### Scenario: Trailing content on fence line is not a closing fence
- **WHEN** a line inside a fenced block starts with triple backticks but has trailing content
- **THEN** it is NOT treated as a closing fence

### Requirement: Change proposals are parsed into structured objects

The system SHALL parse a change proposal markdown file into a structured object containing: the change name, a why section, a what-changes section, and an array of deltas. A change MUST have a `## Why` section and a `## What Changes` section.

#### Scenario: Valid change is parsed correctly
- **WHEN** a change with Why and What Changes sections is parsed
- **THEN** the name, why text, whatChanges text, and deltas are extracted

#### Scenario: Missing Why section throws
- **WHEN** a change without a `## Why` section is parsed
- **THEN** an error is thrown

#### Scenario: Missing What Changes section throws
- **WHEN** a change without a `## What Changes` section is parsed
- **THEN** an error is thrown

### Requirement: Deltas are parsed from the What Changes section

Deltas SHALL be parsed from bullet items in the format `- **capability:** description`. The operation type (ADDED, MODIFIED, REMOVED, RENAMED) is inferred from keywords in the description (e.g. "add", "create", "new" → ADDED; "remove", "delete" → REMOVED; "rename" → RENAMED; otherwise MODIFIED).

#### Scenario: Delta format is parsed
- **WHEN** the What Changes section contains `- **user-auth:** Add new specification`
- **THEN** a delta is created with spec "user-auth", operation "ADDED", and the description

#### Scenario: Rename keyword maps to RENAMED
- **WHEN** the description contains "rename" or "renamed"
- **THEN** the operation is RENAMED

#### Scenario: Absent keywords default to MODIFIED
- **WHEN** the description contains no recognized keyword
- **THEN** the operation is MODIFIED

### Requirement: CRLF line endings are normalized

The system SHALL normalize `\r\n` and `\r` line endings to `\n` before parsing.

#### Scenario: CRLF change proposals parse correctly
- **WHEN** a change proposal with CRLF (`\r\n`) line endings is parsed
- **THEN** it is parsed identically to a POSIX line-ending version
