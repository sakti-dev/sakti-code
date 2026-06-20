## MODIFIED Requirements

### Requirement: Schema defines sessions table
The database schema SHALL define a `sessions` table with columns: `id` (text, primary key), `projectId` (text, foreign key to `projects.id`, not null), `parentSessionId` (text, foreign key to `sessions.id`, nullable), `title` (text, nullable), `modelId` (text, not null), `thinkingLevel` (text, not null, default "off"), `createdAt` (integer, not null), `updatedAt` (integer, not null).

#### Scenario: Create a session with optional parent
- **WHEN** a session is inserted with a valid `projectId` and a `parentSessionId` referencing an existing session
- **THEN** the row is created linked to both the project and the parent session

#### Scenario: Session without parent has null parentSessionId
- **WHEN** a session is inserted without a `parentSessionId`
- **THEN** the `parentSessionId` column is null
