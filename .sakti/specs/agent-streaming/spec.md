## Purpose

The agent streaming layer orchestrates a single agent prompt from start to finish. It builds the harness, wires observational memory, subscribes to the event stream, resolves the first turn's invocation (plain prompt, template, or skill), runs the retry loop, and emits events to the caller via a callback. It maintains a run registry for abort support and is consumer-agnostic (the server supplies I/O callbacks).

## Requirements

### Requirement: runAgentRunEffect orchestrates one prompt end-to-end

The system SHALL provide `runAgentRunEffect(deps)` that wires observational memory, subscribes to the harness event stream, registers the run, runs the retry loop with first-turn dispatch, and cleans up on exit. The `AgentRunDeps` interface supplies all external dependencies (harness, session, storage, model, skills, templates, emit callback, etc.).

#### Scenario: Successful prompt run
- **WHEN** `runAgentRunEffect` is called with valid deps and the harness completes
- **THEN** all events are emitted via the `emit` callback, entries are persisted, and the run unregisters on exit

#### Scenario: Run registration rejects duplicate
- **WHEN** `registerRun` returns `false` (session already active)
- **THEN** the effect fails with an error and no provider work is done

### Requirement: First turn dispatch resolves invocation type

The system SHALL resolve the first turn's message through `planFirstTurn`, which parses leading invocations (`skill:<name>`, `/template args`, or plain prompt) and expands `@file` mentions. The resolved plan dispatches to `harness.promptEffect`, `harness.promptFromTemplateEffect`, or `harness.skillEffect`.

#### Scenario: Plain prompt
- **WHEN** the user message is `"fix the bug in auth.ts"`
- **THEN** `planFirstTurn` returns `{ kind: "prompt", text: "<expanded text>" }` and the harness receives a prompt

#### Scenario: Skill invocation
- **WHEN** the user message starts with `"skill:tdd"`
- **THEN** `planFirstTurn` returns `{ kind: "skill", name: "tdd" }` and the harness's `skillEffect` is called

#### Scenario: Template invocation
- **WHEN** the user message starts with `"/commit"`
- **THEN** `planFirstTurn` returns `{ kind: "template", name: "commit" }` and the harness's `promptFromTemplateEffect` is called

#### Scenario: File mention expansion
- **WHEN** the message contains `@auth.ts` and the file exists
- **THEN** the mention is replaced with `<file path="auth.ts">...</file>` containing the file contents (truncated at 64KB)

### Requirement: @file expansion reads files from cwd

The system SHALL expand `@<path>` tokens in the message by reading the resolved file from `cwd`. Files larger than 65536 bytes are truncated. Missing files are left as-is.

#### Scenario: File exists and is small
- **WHEN** `@utils.ts` is mentioned and `utils.ts` exists at 2KB
- **THEN** it is replaced with the file contents wrapped in `<file>` tags

#### Scenario: File does not exist
- **WHEN** `@nonexistent.ts` is mentioned and the file does not exist
- **THEN** the `@nonexistent.ts` token is left unchanged

#### Scenario: File too large
- **WHEN** `@large.ts` is mentioned and the file is 100KB
- **THEN** the first 64KB are included with a `[truncated: 100000 bytes]` note

### Requirement: Phase skill messages are injected before first turn

The system SHALL inject `initialMessages` (phase skill content) into the harness before the first turn via `harness.injectMessages`. These are synthetic tool-call + result pairs persisted via `message_end` → `appendMessage`.

#### Scenario: Phase skills injected
- **WHEN** `initialMessages` contains skill-read pairs
- **THEN** they are injected into the harness and appear in the first turn's context

### Requirement: Retry abort covers backoff gap

The system SHALL create an `AbortController` whose signal covers the retry loop including backoff sleep. Aborting during backoff resolves the sleep immediately.

#### Scenario: Abort during backoff
- **WHEN** the retry loop is sleeping and the abort signal fires
- **THEN** the sleep resolves immediately and `auto_retry_end` is emitted with `success: false`

### Requirement: Observational memory is wired into the harness

The system SHALL create an `ObservationalMemoryEngine` when `observationalMemory` options are provided, wire it into the harness via `setObservationalMemory`, and persist OM lifecycle markers as custom entries.

#### Scenario: OM engine created and wired
- **WHEN** `observationalMemory` options are provided
- **THEN** an `ObservationalMemoryEngine` is created and set on the harness, and OM events are forwarded to the emit callback

### Requirement: Read-only OM is injected into the harness

The system SHALL wire read-only observational memory (project-scope memory) into the harness via `setObservationalMemoryReadOnly` when provided.

#### Scenario: Read-only OM injected
- **WHEN** `observationalMemoryReadOnly` is provided
- **THEN** `setObservationalMemoryReadOnly` is called on the harness

### Requirement: Event stream is drained via Effect Stream

The system SHALL subscribe to the harness's `subscribeStream()` and drain all events through the `emit` callback using `Effect.runFork` + `Stream.runForEach`. The drain fiber is interrupted on cleanup.

#### Scenario: Events forwarded to caller
- **WHEN** the harness emits events during a run
- **THEN** all events are forwarded to the `emit` callback in order

### Requirement: Cleanup runs in ensuring block

The system SHALL run cleanup in an `Effect.ensuring` block that drains pending OM buffering (with a 30s timeout) and calls `unregisterRun`. This guarantees cleanup runs on both success and failure.

#### Scenario: Cleanup on success
- **WHEN** the run completes successfully
- **THEN** OM buffering is drained and the run is unregistered

#### Scenario: Cleanup on failure
- **WHEN** the run fails or is aborted
- **THEN** OM buffering is drained (best-effort) and the run is unregistered
