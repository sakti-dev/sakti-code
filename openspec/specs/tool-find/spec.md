## Purpose

The find tool locates files by glob pattern or bare name fragment using ripgrep's `--files` mode or an injected operations object. Bare name fragments (no glob metacharacters) are dispatched as substring globs. Searches include hidden and gitignored files (excluding `.git`, `node_modules`, known build directories). Results are paths relative to the search directory.

## Requirements

### Requirement: Find tool factory accepts cwd

The system SHALL create a find tool via `createFindTool(cwd, options?)` with optional `rgPath` and `operations`.

#### Scenario: Create find tool
- **WHEN** `createFindTool("/home/user/proj")` is called
- **THEN** the tool searches files relative to `/home/user/proj`

### Requirement: Find tool locates files by glob pattern

The system SHALL accept `{ pattern, path?, limit? }`. Real glob patterns (containing `*`, `?`, `[`, `]`, `{`, `}`) pass through unchanged. Bare name fragments become `**/*<fragment>*`. Default limit is 1000 results.

#### Scenario: Find TypeScript files
- **WHEN** called with `{ pattern: "*.ts" }`
- **THEN** all `.ts` files are returned (glob passes through)

#### Scenario: Find by bare name fragment
- **WHEN** called with `{ pattern: "Button" }`
- **THEN** all files whose path contains "Button" are returned via `**/*Button*`

#### Scenario: No files found returns notice
- **WHEN** no files match the pattern
- **THEN** a "No files found" message includes a hint to broaden the pattern

### Requirement: Find tool supports limit

The system SHALL cap results at the configured `limit` (default 1000). When the limit is reached, a notice is appended with a hint to increase the limit.

#### Scenario: Limit reached notice
- **WHEN** more files exist than the limit allows
- **THEN** output includes a notice stating the limit was reached

### Requirement: Find tool rejects missing search path

The system SHALL perform a pre-flight check on the search path and throw a descriptive error if it does not exist.

#### Scenario: Invalid search path
- **WHEN** called with `{ pattern: "*.ts", path: "/nonexistent" }`
- **THEN** a descriptive error is thrown with parent directory context

### Requirement: Find tool searches all files including gitignored

The system SHALL use `--hidden --no-ignore` via ripgrep to reach gitignored content. Only `.git`, `node_modules`, `target`, `dist`, `build`, `.next`, and `out` are excluded.

#### Scenario: Hidden files included
- **WHEN** a file matching the pattern is hidden or gitignored
- **THEN** it is included in results
