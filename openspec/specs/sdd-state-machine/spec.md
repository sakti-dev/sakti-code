## Purpose

The state machine manages change lifecycle through validated phase transitions. A change progresses through phases: `open` → `specify` → `build` → `verify` → `archive`, with typed transition events and guard conditions at each step. State field read/write is also available for inspection and repair.

## Requirements

### Requirement: State fields are typed and validated

The system SHALL define typed state machine fields: `workflow` (`"full"` or `"hotfix"`), `phase` (one of `open`, `specify`, `build`, `verify`, `archive`), and transition events (e.g. `"open-complete"`, `"specify-complete"`, `"build-complete"`, `"verify-pass"`, `"verify-fail"`, `"archive-reopen"`, `"archived"`). All fields are stored in the change's `.sakti.yaml` metadata.

#### Scenario: Phase is one of the five states
- **WHEN** a phase is set
- **THEN** it SHALL be one of `open`, `specify`, `build`, `verify`, `archive`

#### Scenario: Workflow is full or hotfix
- **WHEN** a workflow type is set
- **THEN** it SHALL be `"full"` or `"hotfix"`

### Requirement: State field is read by name

The system SHALL read a single state field from a change's metadata, returning the value as a string. Unknown field names throw.

#### Scenario: Known field returns its value
- **WHEN** a known field is read from a change with metadata
- **THEN** the field's value is returned as a string

#### Scenario: Unknown field throws
- **WHEN** an unknown field name is requested
- **THEN** an error is thrown

#### Scenario: Missing metadata throws
- **WHEN** reading a state field from a change with no `.sakti.yaml`
- **THEN** an error is thrown

### Requirement: State field is set with validation

The system SHALL update a single state field on a change's metadata. Direct `phase` writes are blocked (use transitions instead) unless `force` is true. Null, boolean, and string values are coerced from CLI string input.

#### Scenario: Known field is updated
- **WHEN** a known field is set with a valid value
- **THEN** the metadata is updated and persisted

#### Scenario: Direct phase write is blocked
- **WHEN** attempting to set `phase` directly without force
- **THEN** an error is thrown recommending `stateTransition` instead

#### Scenario: Force overrides phase write block
- **WHEN** setting `phase` with `force: true`
- **THEN** the phase is updated (repair escape hatch)

### Requirement: Phase transitions are validated

The system SHALL validate each phase transition:

- `open-complete`: requires `proposal.md` to exist; transitions to `specify`
- `specify-complete`: requires `design.md` and `tasks.md` to exist; transitions to `build`
- `build-complete`: transitions to `verify` and resets `verify_result` to `pending`
- `verify-pass`: requires `verification_report` to exist and `branch_status` to be `"handled"`; transitions to `archive`
- `verify-fail`: transitions back to `build`
- `archive-reopen`: transitions from `archive` back to `verify` (only if not already `archived`)
- `archived`: requires `verify_result` to be `"pass"`; sets `archived: true`

#### Scenario: open-complete requires proposal.md
- **WHEN** transitioning from open with no `proposal.md`
- **THEN** an error is thrown

#### Scenario: specify-complete requires design.md and tasks.md
- **WHEN** transitioning from specify without `design.md` or `tasks.md`
- **THEN** an error is thrown indicating which file is missing

#### Scenario: verify-pass requires verification report and handled branch
- **WHEN** transitioning from verify without `verification_report` or with `branch_status` not handled
- **THEN** an error is thrown

#### Scenario: verify-fail returns to build
- **WHEN** transitioning from verify with verify-fail
- **THEN** phase moves back to `build` with `verify_result` set to `"fail"`

#### Scenario: archiving requires pass result
- **WHEN** transitioning to archived with `verify_result` not `"pass"`
- **THEN** an error is thrown

#### Scenario: Archive-reopen requires not already archived
- **WHEN** transitioning archive-reopen on an already-archived change
- **THEN** an error is thrown

### Requirement: Wrong-phase transitions are rejected

The system SHALL reject a transition event when the current phase does not match the expected source phase.

#### Scenario: Transition from wrong phase throws
- **WHEN** a transition event is applied from a phase that doesn't match
- **THEN** an error is thrown indicating the expected phase
