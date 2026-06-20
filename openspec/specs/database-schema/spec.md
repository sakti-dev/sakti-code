## Purpose

The database schema defines all tables using Drizzle ORM. Tables use nanoid text primary keys, integer Unix timestamps, and are initialized with WAL mode and foreign key enforcement.

## Requirements

### Requirement: Schema defines projects table
The database schema SHALL define a `projects` table with columns: `id` (text, primary key, nanoid), `name` (text, not null), `cwd` (text, not null, unique), `createdAt` (integer, not null), `updatedAt` (integer, not null).

#### Scenario: Create a new project
- **WHEN** a project is inserted with a unique `cwd`
- **THEN** the row is created with an auto-generated `id` and current timestamp

#### Scenario: Duplicate cwd rejected
- **WHEN** a project is inserted with a `cwd` that already exists
- **THEN** a unique constraint violation occurs

### Requirement: Schema defines sessions table
The database schema SHALL define a `sessions` table with columns: `id` (text, primary key, nanoid), `projectId` (text, foreign key to `projects.id`, not null), `parentSessionId` (text, foreign key to `sessions.id`, nullable), `title` (text, nullable), `modelId` (text, not null), `thinkingLevel` (text, not null, default "off"), `createdAt` (integer, not null), `updatedAt` (integer, not null).

#### Scenario: Create a session for a project
- **WHEN** a session is inserted with a valid `projectId`
- **THEN** the row is created and linked to the project

#### Scenario: Create a session with optional parent
- **WHEN** a session is inserted with a valid `projectId` and a `parentSessionId` referencing an existing session
- **THEN** the row is created linked to both the project and the parent session

#### Scenario: Session without parent has null parentSessionId
- **WHEN** a session is inserted without a `parentSessionId`
- **THEN** the `parentSessionId` column is null

#### Scenario: List sessions for a project
- **WHEN** sessions are queried by `projectId`
- **THEN** all sessions for that project are returned, ordered by `createdAt` descending

### Requirement: Schema defines messages table
The database schema SHALL define a `messages` table with columns: `id` (text, primary key, nanoid), `sessionId` (text, foreign key to `sessions.id`, not null), `role` (text, not null, one of: "user", "assistant", "tool"), `content` (text, not null), `toolCalls` (text, nullable, JSON-encoded array of tool calls for assistant messages), `toolCallId` (text, nullable, references the tool call this result responds to), `toolName` (text, nullable), `toolArguments` (text, nullable, JSON-encoded), `isError` (integer, nullable, 0/1), `usage` (text, nullable, JSON-encoded token usage), `createdAt` (integer, not null).

#### Scenario: Store an assistant message with tool calls
- **WHEN** an assistant message with 2 tool calls is inserted
- **THEN** the `role` is "assistant", `toolCalls` contains the JSON-encoded tool call array, and `usage` contains token counts

#### Scenario: Store a tool result message
- **WHEN** a tool result message is inserted
- **THEN** the `role` is "tool", `toolCallId` references the originating tool call, `toolName` and `toolArguments` are stored, and `isError` indicates success/failure

#### Scenario: Load messages in chronological order
- **WHEN** messages are queried by `sessionId` ordered by `createdAt`
- **THEN** messages are returned in conversation order (oldest first)

### Requirement: Schema defines tool_executions table
The database schema SHALL define a `tool_executions` table with columns: `id` (text, primary key, nanoid), `messageId` (text, foreign key to `messages.id`, not null), `sessionId` (text, foreign key to `sessions.id`, not null), `toolName` (text, not null), `arguments` (text, not null, JSON-encoded), `result` (text, nullable), `durationMs` (integer, nullable), `createdAt` (integer, not null).

#### Scenario: Record a tool execution
- **WHEN** a tool execution is inserted after a tool call completes
- **THEN** the tool name, arguments, result, duration, and timestamp are persisted

### Requirement: Schema defines costs table
The database schema SHALL define a `costs` table with columns: `id` (text, primary key, nanoid), `sessionId` (text, foreign key to `sessions.id`, not null), `projectId` (text, foreign key to `projects.id`, not null), `inputTokens` (integer, not null), `outputTokens` (integer, not null), `costUsd` (real, not null), `modelId` (text, not null), `createdAt` (integer, not null).

#### Scenario: Record LLM usage cost
- **WHEN** an LLM response is received with token counts and cost
- **THEN** the cost is recorded linked to both the session and project

#### Scenario: Aggregate costs across project
- **WHEN** costs are summed by `projectId`
- **THEN** total input tokens, output tokens, and cost are returned

### Requirement: Schema defines settings table
The database schema SHALL define a `settings` table with columns: `key` (text, primary key), `value` (text, not null), `updatedAt` (integer, not null).

#### Scenario: Get and set a setting
- **WHEN** a setting is upserted with key `"theme"` and value `"dark"`
- **THEN** subsequent reads of key `"theme"` return `"dark"`

### Requirement: Schema defines model_configs table
The database schema SHALL define a `model_configs` table with columns: `id` (text, primary key, nanoid), `projectId` (text, foreign key to `projects.id`, nullable — null means global default), `provider` (text, not null), `modelId` (text, not null), `thinkingLevel` (text, not null, default "off"), `createdAt` (integer, not null), `updatedAt` (integer, not null).

#### Scenario: Project-specific model config
- **WHEN** a model config is inserted with a `projectId`
- **THEN** that project uses the specified model/provider when no override is given

#### Scenario: Global default model config
- **WHEN** a model config is inserted with `projectId` null
- **THEN** it serves as the default for projects without their own config

### Requirement: Schema uses Drizzle ORM table definitions
All tables SHALL be defined using Drizzle's `sqliteTable()` function in a single `schema.ts` file. Tables SHALL use nanoid for text primary keys and integer Unix timestamps for dates.

#### Scenario: Schema file exports all tables
- **WHEN** the schema module is imported
- **THEN** it exports all table definitions: `projects`, `sessions`, `messages`, `toolExecutions`, `costs`, `settings`, `modelConfigs`

### Requirement: Database is initialized with WAL mode
The database SHALL be opened with WAL journal mode for concurrent read/write support and `foreign_keys` pragma enabled.

#### Scenario: Fresh database initialization
- **WHEN** `initDatabase(dbPath)` is called on a new database file
- **THEN** tables are created, WAL mode is enabled, and foreign keys are enforced
