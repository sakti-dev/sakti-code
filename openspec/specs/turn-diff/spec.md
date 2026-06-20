## Purpose

Provides structured git diff summaries for a session's project, enabling per-file change visualization in the UI.

## Requirements

### Requirement: Structured turn diff from git
The system SHALL expose `GET /api/sessions/:id/turn-diff` that runs `git diff HEAD` in the session's project cwd and returns a structured result. The response SHALL contain `{ files: Array<{ path: string, additions: number, deletions: number }>, diff: string, cwd: string }`. The per-file stats SHALL be parsed from `git diff HEAD --numstat`. Unknown sessions SHALL return HTTP 404.

#### Scenario: Turn diff returns files and diff
- **WHEN** `GET /api/sessions/:id/turn-diff` is called for a session in a git repo with modified files
- **THEN** the response status is 200 and the body contains a `files` array with per-file additions/deletions, a `diff` string with the unified diff, and the resolved `cwd`

#### Scenario: Turn diff with no changes
- **WHEN** `GET /api/sessions/:id/turn-diff` is called in a git repo with no changes since HEAD
- **THEN** the response status is 200 and `files` is an empty array and `diff` is empty

#### Scenario: Turn diff with empty repo (no HEAD)
- **WHEN** `GET /api/sessions/:id/turn-diff` is called in a git repo with no commits
- **THEN** the response status is 200 and both `files` and `diff` are empty (no crash)

#### Scenario: Turn diff unknown session
- **WHEN** `GET /api/sessions/nope/turn-diff` is called
- **THEN** the response status is 404

### Requirement: Turn diff supports optional file filter
The system SHALL accept an optional `files[]` query parameter to restrict the diff to specific file paths. When provided, only the specified files SHALL be included in the diff and file summaries.

#### Scenario: Turn diff filtered to specific files
- **WHEN** `GET /api/sessions/:id/turn-diff?files[]=src/index.ts` is called
- **THEN** only changes to `src/index.ts` are included in the response
