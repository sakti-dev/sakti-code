## Purpose

Coding tools provide the agent with file I/O, shell execution, search, and directory listing capabilities. Each tool is a pure function that accepts `cwd` and returns results, independent of the agent and database packages.

## Requirements

### Requirement: Tools export factory functions accepting cwd
Each tool SHALL be created via a factory function that accepts a `cwd` (string) and optional configuration. The factory returns a tool object conforming to the agent's `AgentTool` interface.

#### Scenario: Create read tool with cwd
- **WHEN** `createReadTool("/home/user/my-app")` is called
- **THEN** a tool is returned that reads files relative to `/home/user/my-app`

#### Scenario: Create bash tool with custom timeout
- **WHEN** `createBashTool("/home/user/my-app", { timeout: 60000 })` is called
- **THEN** a tool is returned that runs bash commands with a 60-second timeout

### Requirement: Read tool reads file contents
The read tool SHALL accept `{ path, offset?, limit? }` parameters, resolve `path` relative to `cwd`, read the file, and return the content as text. It SHALL truncate output to 2000 lines or 50KB.

#### Scenario: Read a file
- **WHEN** the read tool is called with `{ path: "src/index.ts" }`
- **THEN** the file at `{cwd}/src/index.ts` is read and the content is returned

#### Scenario: Read with offset and limit
- **WHEN** the read tool is called with `{ path: "src/index.ts", offset: 10, limit: 20 }`
- **THEN** lines 10-29 of the file are returned

#### Scenario: Read returns error for missing file
- **WHEN** the read tool is called with `{ path: "nonexistent.ts" }`
- **THEN** the result has `isError: true` with a descriptive message

#### Scenario: Read truncates large files
- **WHEN** a file with 3000 lines is read
- **THEN** only the first 2000 lines are returned with a truncation notice

### Requirement: Write tool creates or overwrites files
The write tool SHALL accept `{ path, content }` parameters, resolve `path` relative to `cwd`, and write `content` to the file. It SHALL create parent directories if needed.

#### Scenario: Write a new file
- **WHEN** the write tool is called with `{ path: "src/new-file.ts", content: "export const x = 1" }`
- **THEN** the file at `{cwd}/src/new-file.ts` is created with the given content

#### Scenario: Overwrite an existing file
- **WHEN** the write tool is called with an existing file path
- **THEN** the file is overwritten with the new content

#### Scenario: Write creates parent directories
- **WHEN** the write tool is called with `{ path: "a/b/c/file.ts" }` and directories `a/b/c` don't exist
- **THEN** the directories are created and the file is written

### Requirement: Edit tool performs exact text replacement
The edit tool SHALL accept `{ path, edits: [{ oldText, newText }] }` parameters. Each edit replaces the first occurrence of `oldText` with `newText` in the file. All edits are applied atomically (all-or-nothing).

#### Scenario: Single edit
- **WHEN** the edit tool is called with `{ path: "src/index.ts", edits: [{ oldText: "const x = 1", newText: "const x = 2" }] }`
- **THEN** the exact text is replaced in the file

#### Scenario: Multiple edits in one call
- **WHEN** the edit tool is called with 3 edits for the same file
- **THEN** all 3 replacements are applied in a single read-modify-write

#### Scenario: Edit fails if oldText not found
- **WHEN** the edit tool is called with an `oldText` that doesn't exist in the file
- **THEN** the result has `isError: true` with a message indicating the text was not found

#### Scenario: Atomic — no partial edits
- **WHEN** one of 3 edits fails (oldText not found)
- **THEN** none of the edits are applied and the file remains unchanged

### Requirement: Bash tool executes shell commands
The bash tool SHALL accept `{ command, timeout? }` parameters, spawn a shell subprocess in `cwd`, stream stdout/stderr, and return the output. Default timeout SHALL be 30 seconds.

#### Scenario: Run a command
- **WHEN** the bash tool is called with `{ command: "ls -la" }`
- **THEN** the command runs in `{cwd}` and stdout/stderr are returned

#### Scenario: Command times out
- **WHEN** the bash tool is called with `{ command: "sleep 100", timeout: 5 }`
- **THEN** the process is killed after 5 seconds and the partial output is returned with a timeout notice

#### Scenario: Command fails with non-zero exit code
- **WHEN** the bash tool is called with `{ command: "false" }`
- **THEN** the result includes the exit code and stderr, with `isError: true`

### Requirement: Grep tool searches file contents
The grep tool SHALL accept `{ pattern, path?, glob?, literal?, context?, limit? }` parameters and use the bundled ripgrep (`rg`) to search. Default limit SHALL be 100 matches. Smart-case SHALL be on by default (case-insensitive for all-lowercase patterns, case-sensitive otherwise). Results SHALL be formatted as `file:line: text` for matches and `file-line- text` for context lines, parsed in a single pass from `rg --json` (no separate file read). The search SHALL reach gitignored content (via `--no-ignore`) so it never falsely reports "no matches" when matches exist but are gitignored; `.git` and `node_modules` SHALL be excluded.

#### Scenario: Search for a pattern
- **WHEN** the grep tool is called with `{ pattern: "TODO" }`
- **THEN** all lines containing "TODO" in `{cwd}` are returned, up to 100 matches

#### Scenario: Smart-case search
- **WHEN** the grep tool is called with `{ pattern: "todo" }` (all-lowercase)
- **THEN** lines matching "TODO", "todo", "Todo" etc. are returned (case-insensitive, automatically)
- **WHEN** the grep tool is called with `{ pattern: "Todo" }` (mixed-case)
- **THEN** only lines matching "Todo" exactly are returned (case-sensitive)

#### Scenario: Context lines
- **WHEN** the grep tool is called with `{ pattern: "foo", context: 3 }`
- **THEN** each match is accompanied by 3 lines before and after, drawn from `rg`'s own context records in a single pass

#### Scenario: Search within specific directory
- **WHEN** the grep tool is called with `{ pattern: "import", path: "src/" }`
- **THEN** only files under `{cwd}/src/` are searched

### Requirement: Find tool locates files by pattern
The find tool SHALL accept `{ pattern, path?, limit? }` parameters and use the bundled ripgrep (`rg --files`) to locate files. Default limit SHALL be 1000 results. A bare name fragment (no glob metacharacters) SHALL be dispatched as a substring glob (`Button` → `**/*Button*`); a real glob pattern SHALL pass through unchanged. The search SHALL reach gitignored content (via `--no-ignore`) so it never falsely reports "no files found" when files exist but are gitignored; `.git` and `node_modules` SHALL be excluded. Results SHALL be paths relative to the search directory.

#### Scenario: Find TypeScript files
- **WHEN** the find tool is called with `{ pattern: "*.ts" }`
- **THEN** all `.ts` files under `{cwd}` are returned, up to 1000 results

#### Scenario: Find by bare name fragment
- **WHEN** the find tool is called with `{ pattern: "Button" }`
- **THEN** all files whose path contains "Button" are returned (e.g. `src/Button.tsx`, `components/ButtonGroup.ts`)

#### Scenario: Find within specific directory
- **WHEN** the find tool is called with `{ pattern: "*.test.ts", path: "src/" }`
- **THEN** only test files under `{cwd}/src/` are returned

### Requirement: Ls tool lists directory contents
The ls tool SHALL accept `{ path?, limit? }` parameters and list directory contents. Default limit SHALL be 500 entries. Directories SHALL be indicated with a `/` suffix.

#### Scenario: List current directory
- **WHEN** the ls tool is called with `{}` (no path)
- **THEN** the contents of `{cwd}` are returned with `/` suffix for directories

#### Scenario: List a subdirectory
- **WHEN** the ls tool is called with `{ path: "src/" }`
- **THEN** the contents of `{cwd}/src/` are returned

### Requirement: Tools are independent of agent and db
Each tool SHALL have zero imports from `packages/agent` or `packages/db`. Tools are pure functions that accept input and return results. The agent wraps them into its `AgentTool` interface.

#### Scenario: Tool package has no agent/db dependencies
- **WHEN** the dependency tree of `packages/tools` is inspected
- **THEN** it has no dependencies on `@sakti-code/agent` or `@sakti-code/db`
