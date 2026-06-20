## Purpose

`SqliteSessionStore` bridges the `SessionStore` interface to SQLite via `MessageRepo`, mapping between agent `AgentMessage` objects and database rows.

## Requirements

### Requirement: SqliteSessionStore implements SessionStore interface
`SqliteSessionStore` SHALL implement the `SessionStore` interface defined in `packages/agent`. It SHALL use `MessageRepo` for persistence operations.

#### Scenario: Implements all SessionStore methods
- **WHEN** a `SqliteSessionStore` is constructed with a `MessageRepo`
- **THEN** it provides `loadMessages()`, `appendMessage()`, and `replaceMessages()` methods matching the interface

### Requirement: loadMessages maps database rows to AgentMessages
`loadMessages(sessionId)` SHALL query messages via `MessageRepo.loadBySession()` and map each row to an `AgentMessage` object compatible with the agent's message format.

#### Scenario: Map assistant message with tool calls
- **WHEN** a database row with `role: "assistant"` and `toolCalls: "[{...}]"` is loaded
- **THEN** it is mapped to an `AgentMessage` with the tool calls parsed from JSON

#### Scenario: Map tool result message
- **WHEN** a database row with `role: "tool"`, `toolCallId`, `toolName`, `toolArguments`, and `isError` is loaded
- **THEN** it is mapped to an `AgentMessage` with the tool result content and metadata

### Requirement: appendMessage maps AgentMessage to database row and persists
`appendMessage(sessionId, message)` SHALL map an `AgentMessage` to the appropriate database row format (role, content, toolCalls JSON, usage JSON, etc.) and call `MessageRepo.append()`.

#### Scenario: Append user message
- **WHEN** a user `AgentMessage` with text content is appended
- **THEN** a row with `role: "user"` and `content` is inserted

#### Scenario: Append assistant message with usage
- **WHEN** an assistant `AgentMessage` with token usage is appended
- **THEN** a row with `role: "assistant"`, `content`, `toolCalls` (if present), and `usage` JSON is inserted

### Requirement: replaceMessages delegates to MessageRepo atomically
`replaceMessages(sessionId, messages)` SHALL map all `AgentMessage` objects to database rows and call `MessageRepo.replaceForSession()` within a single transaction.

#### Scenario: Replace messages after compaction
- **WHEN** `replaceMessages()` is called with a summary message and 5 recent messages
- **THEN** all old messages are deleted and 6 new messages are inserted in a transaction

### Requirement: SqliteSessionStore is decoupled from agent loop
`SqliteSessionStore` SHALL NOT import or depend on the agent loop implementation. It SHALL only import the `SessionStore` interface and message types from `packages/agent`.

#### Scenario: Store package has no agent loop dependency
- **WHEN** the dependency tree of `packages/db` is inspected
- **THEN** it depends on `@sakti-code/agent` (types only) but not on `@earendil-works/pi-ai` or any runtime agent logic
