## ADDED Requirements

### Requirement: SessionStore defines the persistence interface
The agent package SHALL define a `SessionStore` interface with methods: `loadMessages(sessionId)`, `appendMessage(sessionId, message)`, and `replaceMessages(sessionId, messages)`. The agent SHALL NOT depend on any specific storage implementation.

#### Scenario: Agent uses SessionStore interface
- **WHEN** the agent is constructed with a `SessionStore` implementation
- **THEN** the agent calls `loadMessages()`, `appendMessage()`, and `replaceMessages()` on the provided store, without knowing whether it's SQLite, in-memory, or remote

### Requirement: loadMessages returns ordered message history
`loadMessages(sessionId)` SHALL return an array of `AgentMessage` objects ordered by insertion time (oldest first). These messages form the context sent to the LLM.

#### Scenario: Loading messages for a new session
- **WHEN** `loadMessages()` is called for a session with 5 messages
- **THEN** it returns all 5 messages in chronological order

#### Scenario: Loading messages for an empty session
- **WHEN** `loadMessages()` is called for a session with no messages
- **THEN** it returns an empty array

### Requirement: appendMessage persists a single message
`appendMessage(sessionId, message)` SHALL persist one `AgentMessage` to the store. Each call represents one message in the conversation (user, assistant, or tool result). The message SHALL be assigned a unique ID and timestamp by the store.

#### Scenario: Appending a user message
- **WHEN** `appendMessage("session-1", userMessage)` is called
- **THEN** the message is persisted with a unique ID and the current timestamp

#### Scenario: Appending a tool result
- **WHEN** `appendMessage("session-1", toolResultMessage)` is called
- **THEN** the tool result (including tool call ID, tool name, arguments, and result content) is persisted

### Requirement: replaceMessages atomically swaps message history
`replaceMessages(sessionId, messages)` SHALL atomically replace all messages for a session. Used by compaction to swap old messages for a summary + recent messages. The operation SHALL be transactional — either all messages are replaced or none are.

#### Scenario: Compaction replaces messages
- **WHEN** `replaceMessages("session-1", [summary, recentMsg1, recentMsg2])` is called after compaction
- **THEN** the session's message history contains only the summary and recent messages — old messages are gone

### Requirement: SessionStore types are defined in the agent package
The agent package SHALL export the `SessionStore` interface and any related types (e.g., `StoredMessage`) so that `packages/db` can implement the interface without circular dependencies.

#### Scenario: db package imports SessionStore type
- **WHEN** `packages/db` imports `SessionStore` from `@sakti-code/agent`
- **THEN** it can implement the interface without importing anything else from the agent package
