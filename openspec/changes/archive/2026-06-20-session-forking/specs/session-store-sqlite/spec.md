## ADDED Requirements

### Requirement: SqliteSessionStore.fork creates forked session
`SqliteSessionStore` SHALL provide a `fork(sourceSessionId: string, upToMessageIndex?: number): Promise<{ sessionId: string }>` method. This method SHALL:
1. Load the source session's messages via `MessageRepo.loadBySession()`
2. Slice messages up to `upToMessageIndex` (or use all messages if not provided)
3. Create a new session via `SessionRepo.create()` with `parentSessionId` set to `sourceSessionId`
4. Insert all sliced messages into the new session within a single transaction
5. Return the new session ID

#### Scenario: Fork uses existing MessageRepo
- **WHEN** `fork()` is called
- **THEN** it uses `MessageRepo.loadBySession()` and `MessageRepo.replaceForSession()` internally (no raw SQL)

#### Scenario: Fork copies messages via single transaction
- **WHEN** `fork()` is called with a messageIndex
- **THEN** all messages up to that index are inserted in the new session within a single database transaction
