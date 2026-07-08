## Purpose

`SqliteObservationalMemoryStorage` implements the `ObservationalMemoryStorage` interface from `@sakti-code/agent` using the `observational_memory` SQLite table. It manages the full OM lifecycle: initialization, observation buffering, reflection generation, and history pruning. Records are keyed by `lookupKey` (`thread:{sessionId}` or `resource:{projectId}`).

## Requirements

### Requirement: OM storage constructor accepts DrizzleDB

The system SHALL create an OM storage via `new SqliteObservationalMemoryStorage(db)`.

#### Scenario: Construct with database
- **WHEN** `new SqliteObservationalMemoryStorage(db)` is called
- **THEN** the storage is ready for operations

### Requirement: getObservationalMemory returns the latest record

The system SHALL return the highest-generation OM record for a given thread/resource combination, or null if none exists.

#### Scenario: Get existing OM record
- **WHEN** `getObservationalMemory("sess-1", "proj-1")` is called for a session with an OM record
- **THEN** the latest generation record is returned

#### Scenario: Get nonexistent OM record
- **WHEN** `getObservationalMemory("sess-1", "proj-1")` is called with no record
- **THEN** null is returned

### Requirement: getObservationalMemoryHistory returns generation history

The system SHALL return OM records in descending generation order, with optional date range filtering and offset pagination.

#### Scenario: Get history with default limit (10)
- **WHEN** `getObservationalMemoryHistory("sess-1", "proj-1")` is called
- **THEN** up to 10 records are returned in descending generation order

#### Scenario: Get history with date range
- **WHEN** `getObservationalMemoryHistory("sess-1", "proj-1", 10, { from, to })` is called
- **THEN** only records within the date range are returned

### Requirement: initializeObservationalMemory creates the first record

The system SHALL create a new OM record with `originType: "initial"`, `generationCount: 0`, and the provided config. Initial state has empty observations and zero token counts.

#### Scenario: Initialize OM
- **WHEN** `initializeObservationalMemory({ threadId, resourceId, scope, config })` is called
- **THEN** a record is created with generation 0, initial state, and the config stored as JSON

### Requirement: updateActiveObservations replaces observations

The system SHALL update `activeObservations`, `lastObservedAt`, `observationTokenCount`, and accumulate `totalTokensObserved`. `pendingMessageTokens` is reset to 0. Throws if the record is not found.

#### Scenario: Update active observations
- **WHEN** `updateActiveObservations({ id, observations, lastObservedAt, tokenCount })` is called
- **THEN** the observations are replaced and token counts are updated

### Requirement: createReflectionGeneration creates a new generation

The system SHALL create a new OM record with `originType: "reflection"`, a new generation count (current + 1), and the provided reflection content. Throws if the current record is not found.

#### Scenario: Create reflection generation
- **WHEN** `createReflectionGeneration({ currentRecord, reflection, tokenCount })` is called
- **THEN** a new generation record is created with the reflection content

### Requirement: OM storage manages buffered observations

The system SHALL support appending buffered observation chunks (`updateBufferedObservations`), swapping buffered observations to active status with token threshold selection (`swapBufferedToActive`), and clearing buffered observations (`clearBufferedObservations`).

#### Scenario: Buffer an observation chunk
- **WHEN** `updateBufferedObservations({ id, chunk })` is called
- **THEN** the chunk is appended to the buffered observation chunks array

#### Scenario: Swap buffered to active with threshold selection
- **WHEN** `swapBufferedToActive({ id, currentPendingTokens, messageTokensThreshold, activationRatio })` is called
- **THEN** the best chunk boundary is selected, activated chunks are merged into `activeObservations`, and remaining chunks stay buffered

#### Scenario: Clear buffered observations
- **WHEN** `clearBufferedObservations(id)` is called
- **THEN** the `bufferedObservationChunks` column is set to null

### Requirement: OM storage manages buffered reflections

The system SHALL support appending to a buffered reflection (`updateBufferedReflection`) and swapping it to active as a new generation (`swapBufferedReflectionToActive`). Accumulates reflection tokens.

#### Scenario: Append to buffered reflection
- **WHEN** `updateBufferedReflection({ id, reflection, tokenCount, inputTokenCount })` is called
- **THEN** the reflection text and token counts are accumulated

#### Scenario: Swap buffered reflection to active
- **WHEN** `swapBufferedReflectionToActive({ currentRecord, reflection, tokenCount })` is called
- **THEN** buffered reflection becomes `activeObservations` in a new generation, unreflected lines are preserved

### Requirement: OM storage manages lifecycle flags

The system SHALL support setting `isObserving`, `isReflecting`, `isBufferingObservation`, and `isBufferingReflection` flags. Throws if the record is not found.

#### Scenario: Set observing flag
- **WHEN** `setObservingFlag(id, true)` is called
- **THEN** the `isObserving` column is set to true

### Requirement: OM storage supports history pruning

The system SHALL support clearing all records for a lookup key (`clearObservationalMemory`) and pruning all but a specific record (`pruneHistory`).

#### Scenario: Clear all OM records
- **WHEN** `clearObservationalMemory("sess-1", "proj-1")` is called
- **THEN** all records with that lookup key are deleted

#### Scenario: Prune history keeping one record
- **WHEN** `pruneHistory("sess-1", "proj-1", "keep-id")` is called
- **THEN** all records except `"keep-id"` are deleted

### Requirement: OM storage supports config and pending token management

The system SHALL support updating the OM config via deep merge (`updateObservationalMemoryConfig`) and setting pending message tokens (`setPendingMessageTokens`).

#### Scenario: Update config via deep merge
- **WHEN** `updateObservationalMemoryConfig({ id, config })` is called
- **THEN** the new config fields are deep-merged into the existing config

#### Scenario: Set pending message tokens
- **WHEN** `setPendingMessageTokens(id, 500)` is called
- **THEN** the `pendingMessageTokens` column is set to 500

### Requirement: insertObservationalMemoryRecord inserts a pre-built record

The system SHALL insert a complete `ObservationalMemoryRecord` directly, converting all Date fields to timestamps and JSON-serializing array/object fields.

#### Scenario: Insert pre-built record
- **WHEN** `insertObservationalMemoryRecord(record)` is called
- **THEN** all fields are persisted with appropriate type conversions
