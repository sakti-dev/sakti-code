## ADDED Requirements

### Requirement: File search in project directory
The system SHALL expose `GET /api/projects/:id/search-files?query=&limit=` that searches for files in the project's working directory. The response SHALL contain `{ files: Array<{ path: string, kind: "file" | "directory" }>, cwd: string }`. Unknown projects SHALL return HTTP 404.

#### Scenario: Search for files by name
- **WHEN** `GET /api/projects/:id/search-files?query=test` is called for a project containing `test.ts` and `helper.ts`
- **THEN** the response contains `test.ts` in the `files` array (case-insensitive match)

#### Scenario: Search without query returns general listing
- **WHEN** `GET /api/projects/:id/search-files` is called with no query
- **THEN** the response contains a general listing of files in the project (up to the limit)

#### Scenario: Search respects limit
- **WHEN** `GET /api/projects/:id/search-files?query=a&limit=5` is called
- **THEN** the response contains at most 5 files

#### Scenario: Unknown project
- **WHEN** `GET /api/projects/nope/search-files` is called
- **THEN** the response status is 404

### Requirement: File search uses fd with find fallback
The file search SHALL first attempt to use `fd` (which respects `.gitignore` by default). If `fd` is not available or fails, the search SHALL fall back to `find` with manual ignore patterns (`node_modules`, `.git`, `dist`, `__pycache__`, `.DS_Store`).

#### Scenario: fd available
- **WHEN** `fd` is installed and search is called
- **THEN** `fd` is used with `--type f --type d --max-results <limit> --color never <query>`

#### Scenario: fd not available, fallback to find
- **WHEN** `fd` is not installed and search is called
- **THEN** `find` is used with manual ignore patterns for common directories
