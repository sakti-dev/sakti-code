## Purpose

Tool factories follow a consistent pattern: each tool is created via a factory function that accepts `cwd` and optional config, returning an object conforming to the `AgentTool` interface. Factories accept injectable `operations` for testing. The `packages/tools` package has no imports from `packages/agent` or `packages/db`.

## Requirements

### Requirement: Tool factories accept cwd

Each tool factory SHALL accept a `cwd` string parameter (except webfetch, websearch, and transition which operate independently of the filesystem). File I/O tools resolve paths relative to `cwd`.

#### Scenario: Tools resolve paths relative to cwd
- **WHEN** any file-based tool factory receives `cwd: "/home/user/proj"`
- **THEN** all path parameters are resolved relative to `/home/user/proj`

### Requirement: Tool factories accept injectable operations

Each tool factory SHALL accept optional `operations` for dependency injection. This enables testing without real I/O.

#### Scenario: Custom operations for testing
- **WHEN** `createReadTool(cwd, { operations: fakeOps })` is called
- **THEN** the tool uses `fakeOps` instead of real filesystem calls

### Requirement: Tools conform to AgentTool interface

Each tool SHALL implement the `AgentTool` interface with `name`, `label`, `description`, `parameters`, `permissions`, and `execute` methods.

#### Scenario: Tool has name, label, description, parameters
- **WHEN** a tool is created
- **THEN** it exposes `name`, `label`, `description`, `parameters`, and `permissions`

#### Scenario: Tool execute returns content and details
- **WHEN** a tool's `execute` method is called
- **THEN** it returns an object with `content` and optionally `details`

### Requirement: Tool package is independent of agent and db packages

The system SHALL have zero imports from `@sakti-code/agent` or `@sakti-code/db`. The `AgentTool` type is the only agent dependency and is referenced through TypeScript type imports, not runtime imports.

#### Scenario: No agent/db runtime dependencies
- **WHEN** the package dependency graph is inspected
- **THEN** there are no runtime dependencies on `@sakti-code/agent` or `@sakti-code/db`

### Requirement: File I/O tools support file mutation queue

File-mutating tools (write, edit) SHALL use `withFileMutationQueue` for the absolute path to serialize concurrent mutations per file.

#### Scenario: Mutations to same file are serialized
- **WHEN** multiple write/edit operations target the same file concurrently
- **THEN** they are serialized via the file mutation queue
