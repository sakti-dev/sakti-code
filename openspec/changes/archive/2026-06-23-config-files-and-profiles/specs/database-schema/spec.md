## MODIFIED Requirements

### Requirement: Schema defines projects table
The database schema SHALL define a `projects` table with columns: `id` (text, primary key, nanoid), `name` (text, not null), `cwd` (text, not null, unique), `profileId` (text, nullable — references a profile id in `profiles.json`, null means use `defaultProfile`), `createdAt` (integer, not null), `updatedAt` (integer, not null). `profileId` SHALL NOT be a SQL foreign key (profiles live in a JSON file, not the DB).

#### Scenario: Create a new project
- **WHEN** a project is inserted with a unique `cwd`
- **THEN** the row is created with an auto-generated `id`, `profileId` null, and current timestamp

#### Scenario: Duplicate cwd rejected
- **WHEN** a project is inserted with a `cwd` that already exists
- **THEN** a unique constraint violation occurs

#### Scenario: Project profile assignment
- **WHEN** a project is updated with `profileId = "fast"`
- **THEN** subsequent reads return `profileId = "fast"` (no DB-level constraint enforces the profile's existence)

### Requirement: Schema defines settings table
The database schema SHALL define a `settings` table with columns: `key` (text, primary key), `value` (text, not null), `updatedAt` (integer, not null). The table SHALL be used ONLY for per-session runtime overrides keyed with the `session:{sessionId}:{settingName}` convention. Global application settings SHALL NOT be stored in this table (they live in `settings.json`).

#### Scenario: Get and set a per-session setting
- **WHEN** a setting is upserted with key `"session:sess_1:auto_compaction"` and value `"true"`
- **THEN** subsequent reads of that key return `"true"`

#### Scenario: Global settings are not stored in the table
- **WHEN** a global app preference such as theme is written
- **THEN** it is written to `settings.json` and no row is inserted into the `settings` table

### Requirement: Schema uses Drizzle ORM table definitions
All tables SHALL be defined using Drizzle's `sqliteTable()` function in a single `schema.ts` file. Tables SHALL use nanoid for text primary keys and integer Unix timestamps for dates.

#### Scenario: Schema file exports all tables
- **WHEN** the schema module is imported
- **THEN** it exports table definitions: `projects`, `sessions`, `messages`, `toolExecutions`, `costs`, `settings` (and SHALL NOT export `modelConfigs`)

## REMOVED Requirements

### Requirement: Schema defines model_configs table
**Reason**: Model selection (provider + modelId + thinkingLevel) moves out of the DB into the user-editable `profiles.json` file (see `provider-profiles`). The DB is the wrong home: users cannot inspect or hand-edit it, and it cannot express the per-mode profile model the product needs.
**Migration**: On first start after upgrade, any global `model_configs` row (projectId null) is used to seed `profiles.json`'s default profile; then the `model_configs` table is dropped. Per-project `model_configs` rows are not carried forward (per-project model selection is removed in favor of per-project `profileId`).
