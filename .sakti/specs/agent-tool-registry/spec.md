## Purpose

The tool registry defines the `AgentTool` interface that all coding tools implement, governs tool execution dispatch (sequential vs parallel), argument preparation, permission declarations, and the tool inventory rendered into the system prompt.

## Requirements

### Requirement: AgentTool extends the LLM Tool interface

The system SHALL define `AgentTool<TParameters, TDetails>` extending `@sakti-code/llm`'s `Tool` interface with additional fields: `execute` (the tool's execution function), `executionMode` (optional per-tool sequential override), `label` (human-readable name), `permissions` (optional permission declarations), and `prepareArguments` (optional argument preprocessor).

#### Scenario: Tool with all fields
- **WHEN** a tool is defined with `name`, `description`, `parameters`, `execute`, `executionMode: "sequential"`, `label`, `permissions`, and `prepareArguments`
- **THEN** all fields are available to the agent loop

#### Scenario: Minimal tool
- **WHEN** a tool is defined with only `name`, `description`, `parameters`, and `execute`
- **THEN** `executionMode`, `permissions`, and `prepareArguments` are `undefined`

### Requirement: Tool execute function receives abort signal and update callback

The system SHALL define the `execute` signature as `(toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult>`. The `signal` enables abort, and `onUpdate` enables partial result streaming.

#### Scenario: Tool execution with abort
- **WHEN** a tool is executing and the abort signal fires
- **THEN** the tool can detect the abort via `signal.aborted` and stop

#### Scenario: Tool emits partial updates
- **WHEN** a tool calls `onUpdate(partialResult)` during execution
- **THEN** the agent loop emits a `tool_execution_update` event

### Requirement: AgentToolResult carries content, details, and optional terminate

The system SHALL define `AgentToolResult<T>` with `content` (array of text/image parts), `details` (typed extra data), and optional `terminate` (signals the loop should stop after this batch).

#### Scenario: Tool result with terminate
- **WHEN** a tool returns `{ content, details, terminate: true }`
- **THEN** the agent loop checks the batch-level AND termination decision

### Requirement: Per-tool execution mode can force sequential

The system SHALL allow individual tools to declare `executionMode: "sequential"`, which forces the entire batch to execute sequentially regardless of the global setting.

#### Scenario: One sequential tool in a parallel-configured batch
- **WHEN** the agent has `toolExecution: "parallel"` but a tool declares `executionMode: "sequential"`
- **THEN** the entire batch runs sequentially

### Requirement: prepareArguments transforms tool call arguments

The system SHALL allow tools to declare `prepareArguments` that transforms the raw LLM arguments before validation and execution.

#### Scenario: Arguments are preprocessed
- **WHEN** a tool has `prepareArguments` and the LLM calls it
- **THEN** `prepareArguments(toolCall.arguments)` is called and the result is passed to validation and execution

### Requirement: Permissions declare access patterns

The system SHALL allow tools to declare `permissions` as a function that takes validated arguments and returns `PermissionRequest[]` (each with `permission` and `patterns`). These are evaluated by the agent loop's permission system.

#### Scenario: Tool declares file read permissions
- **WHEN** a tool's `permissions` function returns `[{ permission: "read", patterns: [path] }]`
- **THEN** the agent loop evaluates each pattern against the permission ruleset

### Requirement: Tool inventory is rendered sorted for cache stability

The system SHALL render tool descriptions as `# Tool: <name>` sections, sorted alphabetically by name. Each tool's description has its ATX headers demoted by one level so they nest under the wrapper heading.

#### Scenario: Tools rendered alphabetically
- **WHEN** `renderToolInventory(tools)` is called with tools ["bash", "read", "edit"]
- **THEN** the output is `# Tool: bash\n...\n\n# Tool: edit\n...\n\n# Tool: read\n...`

#### Scenario: Headers demoted
- **WHEN** a tool description contains a `# heading`
- **THEN** it becomes `## heading` in the rendered inventory

### Requirement: Tool validation coerces arguments against JSON schema

The system SHALL validate and coerce tool call arguments against the tool's `parameters` schema using `validateToolArguments`. Invalid arguments produce an error result.

#### Scenario: Valid arguments pass
- **WHEN** tool call arguments match the schema
- **THEN** the coerced arguments are passed to execution

#### Scenario: Invalid arguments produce error
- **WHEN** tool call arguments fail schema validation
- **THEN** an error tool result is returned describing the validation failure
