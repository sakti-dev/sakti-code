## Purpose

The session storage layer (`SessionStorageShape`) provides an Effect-native, tree-based persistence interface for the agent's session data. Each session is an append-only tree of typed entries (`SessionTreeEntry`), with a movable leaf pointer for branching and navigation. The agent package defines the interface and provides an in-memory implementation; `@sakti-code/db` implements it against SQLite. The agent package depends only on the interface, never on a specific backend.

## Requirements

### Requirement: SessionStorageShape defines the tree-based persistence interface

The system SHALL define a `SessionStorageShape` interface with the following Effect-typed methods: `appendEntry`, `createEntryId`, `findEntries`, `getEntries`, `getEntry`, `getLabel`, `getLeafId`, `getMetadata`, `getPathToRoot`, `setLeafId`. A `SessionStorage` Effect service wraps this shape for dependency injection. The agent SHALL NOT depend on any specific storage implementation.

#### Scenario: Agent uses SessionStorageShape interface
- **WHEN** the agent is constructed with a `SessionStorageShape` implementation
- **THEN** the agent calls methods on the provided shape, without knowing whether it's in-memory, SQLite-backed, or remote

### Requirement: SessionTreeEntry is a discriminated union of entry types

The system SHALL define `SessionTreeEntry` as a discriminated union on `type`, including: `message`, `thinking_level_change`, `model_change`, `active_tools_change`, `branch_summary`, `custom`, `custom_message`, `label`, `session_info`, `leaf`, `observation_prune`, `observation`, `reflection`. Each entry has `id`, `parentId`, and `timestamp`.

#### Scenario: Messages are stored as MessageEntry
- **WHEN** an agent message is appended to the session
- **THEN** it is stored as a `message` entry carrying the full `AgentMessage` (role, content, usage, stopReason, etc.)

#### Scenario: Branch navigation creates leaf entries
- **WHEN** the leaf pointer is moved to a different entry
- **THEN** a `leaf` entry is appended recording the old and new leaf IDs

#### Scenario: Observational memory entries are persisted
- **WHEN** the observer or reflector produces output
- **THEN** `observation` and `reflection` entries are appended with their summaries and record IDs

### Requirement: appendEntry adds entries and advances the leaf

The system SHALL append a `SessionTreeEntry` to the storage. Each call adds the entry to the end of the list. For non-`leaf` entries, the leaf pointer advances to the new entry's ID. For `leaf` entries, the leaf pointer moves to the `targetId`.

#### Scenario: Appending a message entry
- **WHEN** `appendEntry(messageEntry)` is called
- **THEN** the entry is added and the leaf advances to the entry's ID

#### Scenario: Appending a leaf entry
- **WHEN** `appendEntry({ type: "leaf", targetId: "abc" })` is called
- **THEN** the entry is added and the leaf moves to `"abc"`

### Requirement: setLeafId creates a leaf entry atomically

The system SHALL create a `leaf` entry linking the current leaf to the target, and move the leaf pointer to the target. If the target entry does not exist, the system SHALL fail with a `not_found` error.

#### Scenario: Move leaf to existing entry
- **WHEN** `setLeafId("entry-5")` is called and `"entry-5"` exists
- **THEN** a new leaf entry is created and the leaf pointer becomes `"entry-5"`

#### Scenario: Move leaf to nonexistent entry
- **WHEN** `setLeafId("nonexistent")` is called
- **THEN** the operation fails with `code: "not_found"`

### Requirement: getPathToRoot returns the branch from leaf to root

The system SHALL return entries from the leaf (or the given `leafId`) walking up to the root (the entry with `parentId: null`). Entries are ordered root-first. If the given `leafId` is null, returns an empty array.

#### Scenario: Path from leaf to root
- **WHEN** `getPathToRoot(null)` is called (uses current leaf)
- **THEN** entries are returned root-first, leaf-last

#### Scenario: Nonexistent entry in path
- **WHEN** a parentId points to a nonexistent entry
- **THEN** the operation fails with `code: "invalid_session"`

### Requirement: findEntries filters by entry type

The system SHALL return all entries matching a specific `type`, narrowing the return type to the corresponding entry variant.

#### Scenario: Find all message entries
- **WHEN** `findEntries("message")` is called
- **THEN** only entries with `type: "message"` are returned, typed as `MessageEntry[]`

### Requirement: getLabel returns the label for an entry

The system SHALL return the most recent label assigned to a given entry ID via `label` entries. If no label exists, returns `undefined`.

#### Scenario: Entry has a label
- **WHEN** `getLabel("entry-5")` is called and a `label` entry targets `"entry-5"`
- **THEN** the label string is returned

#### Scenario: Entry has no label
- **WHEN** `getLabel("entry-5")` is called and no `label` entry targets it
- **THEN** `undefined` is returned

### Requirement: InMemorySessionStorageLive provides a test implementation

The system SHALL provide `InMemorySessionStorageLive` as an Effect Layer that constructs an in-memory `SessionStorageShape`. It accepts optional initial entries and metadata. Entry IDs are generated from truncated UUIDv7. It is used for testing and for ephemeral session contexts.

#### Scenario: In-memory store with initial entries
- **WHEN** `InMemorySessionStorageLive({ entries, metadata })` is built
- **THEN** the resulting service has the provided entries pre-loaded and the metadata set

### Requirement: SessionMetadata tracks creation identity

The system SHALL define `SessionMetadata` with `id` (UUID) and `createdAt` (ISO timestamp). These are immutable after creation.

#### Scenario: Metadata is available
- **WHEN** `getMetadata()` is called
- **THEN** the session's `id` and `createdAt` are returned
