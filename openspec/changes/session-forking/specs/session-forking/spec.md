## ADDED Requirements

### Requirement: Store-level session forking
The system SHALL provide `SqliteSessionStore.fork(sourceSessionId: string, upToMessageIndex?: number): Promise<{ sessionId: string }>` that creates a new session and copies all messages from the source session up to (and including) the specified message index. If no messageIndex is provided, all messages SHALL be copied. The copy SHALL be performed atomically within a single transaction. The new session SHALL have `parentSessionId` set to the source session ID.

#### Scenario: Fork all messages
- **WHEN** `fork(sourceSessionId)` is called with no messageIndex
- **THEN** a new session is created with all messages from the source session copied to it
- **AND** the new session's `parentSessionId` equals the source session ID

#### Scenario: Fork up to a message index
- **WHEN** `fork(sourceSessionId, 3)` is called
- **THEN** only the first 4 messages (indices 0-3) are copied
- **AND** the new session has 4 messages, all identical to the source

#### Scenario: Fork unknown session
- **WHEN** `fork("nonexistent")` is called
- **THEN** the method throws an error matching `/Session not found/`

#### Scenario: Fork with messageIndex beyond message count
- **WHEN** `fork(sourceSessionId, 9999)` is called for a session with 10 messages
- **THEN** all 10 messages are copied (clamped to available messages)

### Requirement: Fork REST endpoint
The system SHALL expose `POST /api/sessions/:id/fork`. The request body SHALL accept an optional `{ messageIndex: number }`. The endpoint SHALL resolve the session, call `SqliteSessionStore.fork`, and return the new session object with status 200. Unknown sessions SHALL return HTTP 404.

#### Scenario: Fork a session
- **WHEN** `POST /api/sessions/:id/fork` is called with `{ messageIndex: 5 }` for a valid session
- **THEN** the response status is 200 and the body contains the new session object with `parentSessionId` set to the source session ID

#### Scenario: Fork unknown session
- **WHEN** `POST /api/sessions/nope/fork` is called
- **THEN** the response status is 404

### Requirement: Fork-messages endpoint
The system SHALL expose `GET /api/sessions/:id/fork-messages` returning an array of forkable messages. Each entry SHALL contain: `messageIndex` (0-based index in the full messages array), `role`, and `textPreview` (first 200 characters of content). Only user and assistant messages SHALL be included (tool results SHALL be excluded). Unknown sessions SHALL return HTTP 404.

#### Scenario: Fork-messages returns user/assistant entries
- **WHEN** `GET /api/sessions/:id/fork-messages` is called for a session with 2 user messages, 2 assistant messages, and 3 tool results
- **THEN** the response is an array of 4 entries (the tool results are excluded)
- **AND** each entry contains `messageIndex`, `role`, and `textPreview`

#### Scenario: Fork-messages with empty session
- **WHEN** `GET /api/sessions/:id/fork-messages` is called for a new session with no messages
- **THEN** the response is an empty array `[]`

### Requirement: Forked session copies model config from source
When a session is forked, the new session SHALL copy `projectId`, `modelId`, and `thinkingLevel` from the source session. The title SHALL default to `"Fork of <source title>"` (or `"Fork"` if the source has no title).

#### Scenario: Fork preserves model config
- **WHEN** a session with `modelId: "gpt-4o"` and `thinkingLevel: "high"` is forked
- **THEN** the new session has the same `modelId` and `thinkingLevel`
