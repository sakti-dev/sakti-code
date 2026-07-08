## Purpose

Task progress utilities compute a change's completion status by counting checkboxes across the tracked-task artifact files (e.g. `tasks.md`), supporting nested glob patterns and falling back gracefully when the schema is unresolvable.

## Requirements

### Requirement: Checkbox counting parses markdown task lists

The system SHALL count total and completed task checkboxes from markdown content, recognizing lines matching `- [ ]` or `- [x]` (case-insensitive). Completed tasks use `[x]`, pending tasks use `[ ]`.

#### Scenario: Mixed completion counts correctly
- **WHEN** content has 3 tasks with 2 completed
- **THEN** the result is `{ total: 3, completed: 2 }`

### Requirement: Task progress resolves through the schema's tracked-tasks artifact

The system SHALL resolve a change's tracked-tasks artifact by finding the schema's `apply.tracks` value (which selects the artifact whose `generates` matches), falling back to the artifact with id `tasks`. It SHALL then read all files matching that artifact's `generates` glob and aggregate their checkbox counts.

#### Scenario: Progress aggregates across nested tasks.md files
- **WHEN** a schema's tracks glob matches multiple files (e.g. `backend/tasks.md`, `frontend/tasks.md`)
- **THEN** checkboxes from all matched files are aggregated into a single total

#### Scenario: Progress excludes sibling changes and archive
- **WHEN** the glob resolves files
- **THEN** only files within the specified change directory are counted (excluding `archive/` and sibling changes)

#### Scenario: Custom track artifact id is supported
- **WHEN** `apply.tracks` references a non-default glob (e.g. `work/*.md`)
- **THEN** that glob's artifact is used for progress tracking

### Requirement: Unresolvable schema falls back to single tasks.md

When the schema cannot be resolved (missing, unknown schema name, or no tracked-tasks artifact found), the system SHALL fall back to counting checkboxes in a single top-level `tasks.md` in the change directory, without crashing.

#### Scenario: Unknown schema falls back gracefully
- **WHEN** a change references a schema that doesn't exist
- **THEN** progress is read from `tasks.md` at the change root

#### Scenario: No tasks file returns zero progress
- **WHEN** no file matches the tracked glob or tasks.md
- **THEN** progress is `{ total: 0, completed: 0 }`

### Requirement: Task status is formatted for display

The system SHALL format task progress as a human-readable string: `"No tasks"` for zero total, `"✓ Complete"` when all tasks are done, or `"N/M tasks"` otherwise.

#### Scenario: No tasks
- **WHEN** there are zero tasks
- **THEN** the status string is `"No tasks"`

#### Scenario: All tasks complete
- **WHEN** all tasks are completed
- **THEN** the status string is `"✓ Complete"`

#### Scenario: Partial progress
- **WHEN** 2 of 5 tasks are completed
- **THEN** the status string is `"2/5 tasks"`
