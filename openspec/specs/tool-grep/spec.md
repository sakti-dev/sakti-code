## Purpose

The grep tool searches file contents using ripgrep with `--json` output, returning matches and context lines formatted as `file:line: text`. It supports smart-case, glob filtering, literal patterns, and configurable limits. Searches include hidden and gitignored files (excluding `.git`, `node_modules`, known build directories).

## Requirements

### Requirement: Grep tool factory accepts cwd

The system SHALL create a grep tool via `createGrepTool(cwd, options?)` with optional `rgPath`.

#### Scenario: Create grep tool with default rg
- **WHEN** `createGrepTool("/home/user/proj")` is called
- **THEN** the tool searches relative to `/home/user/proj` using `rg` from PATH

### Requirement: Grep tool searches file contents

The system SHALL accept `{ pattern, path?, glob?, literal?, context?, limit? }`, run ripgrep with `--json --smart-case --hidden --no-ignore`, and return formatted results. Default limit is 100 matches. Results are formatted as `file:line: text` for matches and `file-line- text` for context lines.

#### Scenario: Search finds matches
- **WHEN** called with `{ pattern: "TODO" }`
- **THEN** matching lines are returned as `file:line: text`

#### Scenario: No matches returns notice
- **WHEN** called with a pattern that matches nothing
- **THEN** "No matches found" is returned

### Requirement: Grep tool uses smart-case

The system SHALL use ripgrep's `--smart-case`: an all-lowercase pattern matches any case; any uppercase letter makes the search case-sensitive.

#### Scenario: All-lowercase matches case-insensitively
- **WHEN** called with `{ pattern: "hello" }`
- **THEN** "hello", "HELLO", and "Hello" all match

#### Scenario: Mixed-case matches case-sensitively
- **WHEN** called with `{ pattern: "Hello" }` (capital H)
- **THEN** only "Hello" matches, not "hello"

### Requirement: Grep tool supports context lines

The system SHALL accept `context` (lines before and after each match). Context is drawn from ripgrep's own JSON records in a single pass.

#### Scenario: Context lines
- **WHEN** called with `{ pattern: "foo", context: 3 }`
- **THEN** 3 lines before and after each match are included in the output

### Requirement: Grep tool supports glob filtering

The system SHALL accept `glob` to filter files by pattern. The include glob is applied before the standard exclude globs.

#### Scenario: Glob filter
- **WHEN** called with `{ pattern: "import", glob: "*.ts" }`
- **THEN** only `.ts` files are searched

### Requirement: Grep tool supports literal mode

The system SHALL accept `literal: true` to treat the pattern as a fixed string (via ripgrep `--fixed-strings`) instead of a regex.

#### Scenario: Literal mode
- **WHEN** called with `{ pattern: "foo.bar", literal: true }`
- **THEN** the literal string "foo.bar" is searched (dot is not a regex wildcard)

### Requirement: Grep tool enforces match limit

The system SHALL cap results at the configured `limit` (default 100). When the limit is reached, a notice is appended with a hint to increase the limit.

#### Scenario: Limit reached notice
- **WHEN** more matches exist than the limit allows
- **THEN** output includes a notice stating the limit was reached

### Requirement: Grep tool truncates long lines

The system SHALL truncate individual match lines at 4096 characters, appending a notice when truncation occurs.

#### Scenario: Long lines truncated
- **WHEN** a matching line exceeds 4096 characters
- **THEN** it is truncated with a notice in details

### Requirement: Grep tool rejects missing search path

The system SHALL perform a pre-flight check on the search path and throw a descriptive error if it does not exist, enriched with parent directory contents.

#### Scenario: Invalid search path
- **WHEN** called with `{ pattern: "x", path: "/nonexistent" }`
- **THEN** a descriptive error is thrown with parent directory context

### Requirement: Grep tool searches all files including gitignored

The system SHALL use `--hidden --no-ignore` to reach gitignored content. Only `.git`, `node_modules`, `target`, `dist`, `build`, `.next`, and `out` are excluded.

#### Scenario: Hidden and gitignored files searched
- **WHEN** a pattern exists in a gitignored file
- **THEN** the file is included in results
