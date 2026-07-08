## Purpose

File system utilities provide cross-platform file and directory operations for the SDD system: reading, writing, path resolution, permission checking, and marker-based file editing. These are used by all SDD commands and core logic.

## Requirements

### Requirement: Paths are normalized to POSIX separators

The system SHALL convert backslash path separators to forward slashes, for compatibility with glob libraries.

#### Scenario: Backslashes become forward slashes
- **WHEN** a path with backslashes is processed
- **THEN** all backslashes are replaced with forward slashes

### Requirement: Existing paths are canonicalized

The system SHALL resolve an existing path to its canonical absolute form, preferring the native realpath resolver and falling back through realpath then `path.resolve`.

#### Scenario: Canonical path resolves via native realpath
- **WHEN** an existing file path is canonicalized
- **THEN** the native realpath resolver is used first

### Requirement: Paths are joined cross-platform

The system SHALL join path segments, handling POSIX paths (Linux/macOS) and Windows paths (drive-letter, forward-slash, and UNC-style) with correct platform separators.

#### Scenario: POSIX paths join with forward slashes
- **WHEN** joining `/tmp/project` with a subpath
- **THEN** segments are joined with `/`

#### Scenario: Windows drive-letter paths join with backslashes
- **WHEN** joining `C:\Users\dev\project` with a subpath
- **THEN** segments are joined with `\`

#### Scenario: Windows forward-slash paths normalize to backslashes
- **WHEN** joining `D:/workspace/app` with a subpath
- **THEN** the result uses backslashes

#### Scenario: UNC-style paths join with backslashes
- **WHEN** joining `\\server\share\repo` with a subpath
- **THEN** the result uses backslashes

### Requirement: Directories are created recursively

The system SHALL create a directory and all missing parent directories.

#### Scenario: Create single directory
- **WHEN** a new directory path is created
- **THEN** the directory exists after creation

#### Scenario: Create nested directories
- **WHEN** a deeply nested directory path is created
- **THEN** all intermediate directories are created

#### Scenario: Existing directory does not throw
- **WHEN** a directory that already exists is created
- **THEN** no error is thrown

### Requirement: File existence is checked

The system SHALL check whether a file exists at a given path, returning true for files (and directories via `fs.access`) and false for non-existent paths.

#### Scenario: Existing file returns true
- **WHEN** an existing file path is checked
- **THEN** true is returned

#### Scenario: Non-existing file returns false
- **WHEN** a non-existing file path is checked
- **THEN** false is returned

### Requirement: Directory existence is checked

The system SHALL check whether a directory exists at a given path, returning true only for directories (not files).

#### Scenario: Existing directory returns true
- **WHEN** an existing directory path is checked
- **THEN** true is returned

#### Scenario: File path returns false
- **WHEN** a file path is checked for directory existence
- **THEN** false is returned

### Requirement: Files are read and written

The system SHALL read a file's content as UTF-8 text, and write content to a file (creating parent directories if needed, overwriting if the file exists).

#### Scenario: Read returns file content
- **WHEN** an existing file is read
- **THEN** its UTF-8 content is returned

#### Scenario: Read throws for missing file
- **WHEN** a non-existing file is read
- **THEN** an error is thrown

#### Scenario: Write creates parent directories
- **WHEN** a file is written to a path with nested directories that don't exist
- **THEN** the directories are created and the file is written

#### Scenario: Write overwrites existing file
- **WHEN** a file is written to an existing file path
- **THEN** the existing content is replaced

### Requirement: Write permissions are verified

The system SHALL verify that a directory is writable by creating and removing a test file, returning true if successful and false if not.

#### Scenario: Writable directory returns true
- **WHEN** write permissions are checked on a writable directory
- **THEN** true is returned

#### Scenario: Non-existing directory with writable parent returns true
- **WHEN** write permissions are checked on a non-existing directory path
- **THEN** the parent directory's permissions are checked and true is returned if it is writable

### Requirement: File write permissions are checked with directory traversal

The system SHALL check whether a file can be written, handling existing files, non-existent files (traversing up to find the first existing directory), read-only files, directories, symbolic links, and paths where intermediate components are files.

#### Scenario: Existing writable file returns true
- **WHEN** write permission is checked on an existing writable file
- **THEN** true is returned

#### Scenario: Existing read-only file returns false
- **WHEN** write permission is checked on a read-only file
- **THEN** false is returned

#### Scenario: Non-existent file in writable directory returns true
- **WHEN** write permission is checked for a non-existent file path
- **THEN** the first existing ancestor directory is checked for write access

#### Scenario: Paths blocked by a file intermediate component return false
- **WHEN** a path component that should be a directory is actually a file
- **THEN** false is returned

### Requirement: Files are updated with marker blocks

The system SHALL update a file by finding marker comments (start/end) and replacing the content between them, or appending markers if they don't exist. Markers must be on their own lines (only whitespace allowed on the same line). Partial marker presence (start without end) SHALL throw an error.

#### Scenario: Content between existing markers is replaced
- **WHEN** a file has both start and end markers
- **THEN** the content between them is replaced with the new content

#### Scenario: Markers are appended when neither exists
- **WHEN** a file has neither start nor end markers
- **THEN** the markers and content are prepended to the file

#### Scenario: Only one marker throws
- **WHEN** a file has a start marker but no end marker (or vice versa)
- **THEN** an error is thrown

#### Scenario: Inverted marker order throws
- **WHEN** the end marker appears before the start marker
- **THEN** an error is thrown

#### Scenario: New file gets markers written
- **WHEN** the file does not exist
- **THEN** the file is created with just the markers and content

### Requirement: Marker blocks are removed

The system SHALL remove a marker block (start marker, content, and end marker line) from file content, cleaning up any resulting double blank lines.

#### Scenario: Marker block is removed from content
- **WHEN** content contains a start marker, end marker, and content between them
- **THEN** the entire block (from the start marker's line through the end marker's line) is removed and double blank lines are collapsed

#### Scenario: Markers not found return original content
- **WHEN** content does not contain the start or end marker
- **THEN** the original content is returned unchanged
