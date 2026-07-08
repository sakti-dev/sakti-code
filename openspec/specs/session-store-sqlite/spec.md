## Purpose

`SqliteSessionStorage` bridges the `SessionStorage` interface to SQLite via the session tree model (`session_entries` table). It manages entries as a tree with parent-child relationships, turn attribution, and fork/copy operations. All methods return `Effect` from the Effect-TS ecosystem.

## Requirements

### Requirement: SqliteSessionStorage implements the storage interface

`SqliteSessionStorage` SHALL implement storage operations using Effect-TS (`Effect.sync` wrapping synchronous `node:sqlite` calls). It accepts a `DrizzleDB`, `sessionId`, and typed metadata.

#### Scenario: Construct with database and metadata
- **WHEN** `new SqliteSessionStorage(db, "sess-1", metadata)` is called
- **THEN** the storage is bound to the given session and metadata

### Requirement: getMetadata returns the session metadata

The system SHALL return the metadata object that was passed at construction time.

#### Scenario: Get metadata
- **WHEN** `getMetadata()` is called
- **THEN** the constructor-provided metadata is returned

### Requirement: appendEntry inserts a tree entry

The system SHALL accept a `SessionTreeEntry`, serialize it as JSON, auto-assign the sequence number (incrementing within the session), and insert it. If the entry type is not `"leaf"`, the session's `leafId` is updated.

#### Scenario: Append a message entry
- **WHEN** a message `SessionTreeEntry` is appended
- **THEN** a row is inserted with auto-incremented sequence, the entry JSON as content, and `leafId` updated on the session

#### Scenario: Append a leaf entry does not update leafId
- **WHEN** a leaf-type entry is appended
- **THEN** the session's `leafId` is not changed

### Requirement: getEntry retrieves a single entry

The system SHALL retrieve a single entry by ID, parsing the JSON content back to a `SessionTreeEntry`.

#### Scenario: Get existing entry
- **WHEN** `getEntry(id)` is called for an existing entry
- **THEN** the parsed entry is returned

#### Scenario: Get nonexistent entry
- **WHEN** `getEntry(id)` is called for a nonexistent entry
- **THEN** undefined is returned

### Requirement: findEntries filters by entry type

The system SHALL retrieve all entries of a given `type` (e.g., `"message"`, `"label"`, `"leaf"`), ordered by sequence.

#### Scenario: Find all message entries
- **WHEN** `findEntries("message")` is called
- **THEN** all entries with `kind: "message"` are returned in sequence order

### Requirement: getLabel retrieves the label from a label entry

The system SHALL retrieve a label entry by ID and return its label value, or undefined if the entry is not a label.

#### Scenario: Get label from a label entry
- **WHEN** `getLabel(id)` is called for a label entry
- **THEN** the label string is returned

#### Scenario: Get label from non-label entry
- **WHEN** `getLabel(id)` is called for a non-label entry
- **THEN** undefined is returned

### Requirement: getPathToRoot retrieves the ancestor chain

The system SHALL traverse the parent chain from a given leaf ID up to the root using a recursive CTE, returning entries in sequence order. If no leaf ID is given, all entries are returned.

#### Scenario: Traverse path from leaf to root
- **WHEN** `getPathToRoot(leafId)` is called
- **THEN** all entries from root to the given leaf are returned in order

#### Scenario: No leaf ID returns all entries
- **WHEN** `getPathToRoot(null)` is called
- **THEN** all entries are returned

### Requirement: getEntries returns all entries

The system SHALL return all entries for the session ordered by sequence.

#### Scenario: Get all entries
- **WHEN** `getEntries()` is called
- **THEN** all session entries are returned in sequence order

### Requirement: forkFrom copies entries from another session

The system SHALL copy entries from a source session into this session, regenerating IDs and parent IDs. If `upToEntryId` is provided, only entries up to and including that entry are copied. Turns referenced by copied entries are also copied. The new session's `leafId` is set based on the source session's leaf.

#### Scenario: Fork all entries from source
- **WHEN** `forkFrom("source-sess")` is called
- **THEN** all entries are copied with new UUIDs and parent references remapped

#### Scenario: Fork up to a specific entry
- **WHEN** `forkFrom("source-sess", "entry-5")` is called
- **THEN** only entries up to and including `entry-5` are copied

### Requirement: setCurrentTurnId stamps turn attribution

The system SHALL stamp the configured `turnId` onto subsequently appended entries. Setting to `null` leaves entries unattributed.

#### Scenario: Stamp turn ID on append
- **WHEN** `setCurrentTurnId("turn-1")` is called, then an entry is appended
- **THEN** the entry has `turnId: "turn-1"`

#### Scenario: Null turn ID leaves unattributed
- **WHEN** `setCurrentTurnId(null)` is called, then an entry is appended
- **THEN** the entry has `turnId: null`

### Requirement: getEntriesWithMeta returns entries with DB metadata

The system SHALL return entries together with their `turnId`, `isTurnSummary` flag, and `sequence` from the database layer.

#### Scenario: Get entries with metadata
- **WHEN** `getEntriesWithMeta()` is called
- **THEN** entries and their DB-level `turnId`, `isTurnSummary`, and `sequence` are returned

### Requirement: LeafId management

The system SHALL support reading and updating the session's `leafId` column via `getLeafId()` and `setLeafId()`.

#### Scenario: Get current leaf ID
- **WHEN** `getLeafId()` is called on a session with a leaf set
- **THEN** the leaf ID is returned

#### Scenario: Set leaf ID
- **WHEN** `setLeafId("new-leaf-id")` is called
- **THEN** the session's `leafId` column is updated

### Requirement: createEntryId generates a new UUID

The system SHALL generate a new UUID string for use as an entry ID.

#### Scenario: Generate entry ID
- **WHEN** `createEntryId()` is called
- **THEN** a UUID string is returned
