## Purpose

The read tool reads a text file or supported image, pages through a large UTF-8 text file by line offset, or lists a directory page. It resolves paths relative to the tool's `cwd`, auto-detects images by magic bytes, supports hashline headers for edit round-tripping, and truncates large output to limits.

## Requirements

### Requirement: Read tool factory accepts cwd and optional config

The system SHALL create a read tool via `createReadTool(cwd, options?)`. The factory accepts a `cwd` string and optional `autoResizeImages`, `operations`, and `snapshotStore` config.

#### Scenario: Create read tool with default options
- **WHEN** `createReadTool("/home/user/proj")` is called
- **THEN** the tool reads files relative to `/home/user/proj`

#### Scenario: Create read tool with snapshot store
- **WHEN** `createReadTool("/home/user/proj", { snapshotStore })` is called
- **THEN** the tool emits `[path#HASH]` headers and numbered lines for text files

### Requirement: Read tool reads text files

The system SHALL accept `{ path, offset?, limit? }` parameters, resolve `path` relative to `cwd`, read the file, and return content as text.

#### Scenario: Read file returns content
- **WHEN** called with `{ path: "src/index.ts" }`
- **THEN** the file content is returned as text

#### Scenario: Read file with offset and limit
- **WHEN** called with `{ path: "src/index.ts", offset: 10, limit: 20 }`
- **THEN** lines 10–29 of the file are returned

#### Scenario: Read missing file throws
- **WHEN** called with `{ path: "nonexistent.ts" }`
- **THEN** an error is thrown

#### Scenario: Read truncated at 2000 lines or 50KB
- **WHEN** a file with 3000 lines is read
- **THEN** the output is truncated with a truncation notice

### Requirement: Read tool lists directories

The system SHALL list a directory when the resolved path is a directory, returning entries with a `/` suffix for subdirectories. Dotfiles are included.

#### Scenario: List current directory
- **WHEN** called with `{ path: "." }`
- **THEN** the directory contents are returned with `/` suffix for directories

#### Scenario: List subdirectory
- **WHEN** called with `{ path: "src/" }`
- **THEN** the contents of the subdirectory are returned

### Requirement: Read tool supports offset/limit for directory pages

The system SHALL support `offset` and `limit` for directory listings, returning a "Use offset=N to continue" hint for further paging.

#### Scenario: Paginate directory listing
- **WHEN** called with `{ path: ".", offset: 2, limit: 2 }`
- **THEN** the listing shows entries 2–3 with a continuation hint

### Requirement: Read tool detects and returns image files

The system SHALL detect supported image formats (JPEG, PNG, GIF, WebP) by magic bytes, not by file extension. Animated PNGs are rejected. Images are returned as base64 data in the response content. Large images are omitted if base64 exceeds 4.5MB unless `autoResizeImages` is enabled.

#### Scenario: Read PNG image by magic bytes
- **WHEN** called with a `.dat` file containing PNG magic bytes
- **THEN** the content includes an image attachment with `mimeType: "image/png"`

#### Scenario: Oversized image omitted with hint
- **WHEN** an image's base64 payload exceeds 4.5MB and `autoResizeImages` is not set
- **THEN** the image is omitted with a hint to enable auto-resize

### Requirement: Read tool emits hashline headers with snapshotStore

The system SHALL emit a `[path#HASH]` header and numbered lines when a `snapshotStore` is provided. The hash is computed from the normalized (LF) full file content, even for partial reads.

#### Scenario: Hashline header for full file
- **WHEN** reading a text file with a snapshotStore configured
- **THEN** the output contains `[path#HASH]` and numbered lines `1:content`

#### Scenario: Hash from full content for partial reads
- **WHEN** reading with offset/limit and snapshotStore
- **THEN** the file hash is computed from the full file content, not just the visible lines

#### Scenario: No hashline header without snapshotStore
- **WHEN** reading a text file without a snapshotStore
- **THEN** the output contains plain text without `[path#HASH]` header

### Requirement: Read tool reports details

The system SHALL return `details` with `kind: "file" | "directory"` and optional `truncation` metadata.

#### Scenario: File kind in details
- **WHEN** reading a text file
- **THEN** `details.kind` is `"file"`

#### Scenario: Directory kind in details
- **WHEN** listing a directory
- **THEN** `details.kind` is `"directory"`

### Requirement: Read tool aborts on signal

The system SHALL check `AbortSignal` before and during file operations, throwing an error if aborted.
