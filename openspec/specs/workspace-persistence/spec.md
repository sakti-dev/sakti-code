## Purpose

Persists workspace session paths across server restarts so the UI can restore the sidebar state without user intervention. Stored in the existing `settings` table using a key convention.

## Requirements

### Requirement: List loaded workspace sessions
The system SHALL expose `GET /api/workspace/sessions` returning an array of session paths that have been loaded into the workspace sidebar. The data SHALL be stored in the `settings` table with key `workspace:sessions` and value as a JSON array of path strings.

#### Scenario: List workspace sessions
- **WHEN** `GET /api/workspace/sessions` is called
- **THEN** the response status is 200 and the body is an array of session path strings (empty array if none stored)

### Requirement: Add session path to workspace
The system SHALL expose `POST /api/workspace/sessions` with body `{ sessionPath: string }`. The path SHALL be added to the workspace list (idempotent — duplicates SHALL be ignored).

#### Scenario: Add a session path
- **WHEN** `POST /api/workspace/sessions` is called with `{ sessionPath: "/path/to/session.jsonl" }`
- **THEN** the path is added to the workspace list and the response status is 200 with the updated array

#### Scenario: Adding duplicate is idempotent
- **WHEN** the same session path is POSTed twice
- **THEN** the path appears only once in the list

### Requirement: Remove session path from workspace
The system SHALL expose `DELETE /api/workspace/sessions/:encodedPath` to remove a session path from the workspace list. Missing paths SHALL be treated as success (idempotent).

#### Scenario: Remove a session path
- **WHEN** `DELETE /api/workspace/sessions/%2Fpath%2Fto%2Fsession.jsonl` is called
- **THEN** the path is removed from the workspace list and the response status is 200 with the updated array

#### Scenario: Removing non-existent path is idempotent
- **WHEN** `DELETE /api/workspace/sessions/nonexistent-path` is called
- **THEN** the response status is 200 and the list is unchanged
