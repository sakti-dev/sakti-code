## Purpose

The write tool creates or overwrites files with the given content, automatically creating parent directories. It optionally records content snapshots for hashline edit round-tripping.

## Requirements

### Requirement: Write tool factory accepts cwd and optional config

The system SHALL create a write tool via `createWriteTool(cwd, options?)`. The factory accepts optional `operations` and `snapshotStore` config.

#### Scenario: Create write tool
- **WHEN** `createWriteTool("/home/user/proj")` is called
- **THEN** the tool writes files relative to `/home/user/proj`

### Requirement: Write tool creates or overwrites files

The system SHALL accept `{ path, content }` parameters, resolve `path` relative to `cwd`, and write `content` to the file. It returns the byte size of the written content.

#### Scenario: Write a new file
- **WHEN** called with `{ path: "src/new.ts", content: "export const x = 1" }`
- **THEN** the file is created with the given content and a success message including byte size is returned

#### Scenario: Overwrite existing file
- **WHEN** called with an existing file path
- **THEN** the file is overwritten with the new content

### Requirement: Write tool creates parent directories

The system SHALL create parent directories automatically when they do not exist.

#### Scenario: Write creates parent directories
- **WHEN** called with `{ path: "a/b/c/file.ts" }` and `a/b/c` does not exist
- **THEN** the directories are created and the file is written

### Requirement: Write tool records snapshot with snapshotStore

The system SHALL record the normalized (LF) content in the snapshot store and emit a `[path#HASH]` header in the success message when a `snapshotStore` is provided.

#### Scenario: Hashline header on write
- **WHEN** writing a file with a snapshotStore configured
- **THEN** the success message includes a `[path#HASH]` header

#### Scenario: No hashline header without snapshotStore
- **WHEN** writing a file without a snapshotStore
- **THEN** no hashline header is emitted

### Requirement: Write tool aborts on signal

The system SHALL check `AbortSignal` before and during file operations, throwing an error if aborted.
