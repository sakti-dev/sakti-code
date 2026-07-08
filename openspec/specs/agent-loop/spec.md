## Purpose

The agent loop is the core execution engine: it sends prompts to an LLM via `@sakti-code/llm`'s `stream()`, streams token deltas, executes tool calls with permission checks, and emits lifecycle events. It uses Effect internally and exposes both async and Effect-native APIs. The loop is embedded in the `AgentHarness` which adds session tree management, branching, hooks, and resource lifecycle.

## Requirements

### Requirement: Agent loop streams LLM responses via @ai-sdk fullStream

The system SHALL accept a prompt message (or continue from existing context), convert `AgentMessage[]` to LLM `Message[]` at the call boundary via `convertToLlm`, call the stream function (`@sakti-code/llm`'s `stream`), and consume `fullStream` parts natively. It SHALL accumulate `text-delta`, `reasoning-delta`, and `tool-call` parts into an `AssistantMessage`, emitting per-token `message_update` events.

#### Scenario: Successful turn emits text deltas
- **WHEN** the LLM responds with text content
- **THEN** the loop emits `message_update` events with `kind: "text"` for each token delta, followed by `message_end` with the complete assistant message

#### Scenario: LLM response includes thinking
- **WHEN** the LLM produces reasoning content
- **THEN** the loop emits `message_update` events with `kind: "thinking"` and the final `AssistantMessage` contains a `ThinkingContent` block with the accumulated thinking text

#### Scenario: LLM response includes tool calls
- **WHEN** the LLM returns tool call blocks
- **THEN** the loop accumulates tool calls and enters the tool execution phase after `message_end`

#### Scenario: LLM stream error produces error-valued message
- **WHEN** the LLM stream encounters an error (network failure, parse error)
- **THEN** the final `AssistantMessage` has `stopReason: "error"` and `errorMessage` set to the error's message

### Requirement: Agent loop emits lifecycle events

The system SHALL emit typed `AgentEvent`s throughout the loop lifecycle: `agent_start`, `turn_start`, `message_start`/`message_end` (bracketing every persisted message), `message_update` (per-token deltas), `tool_execution_start`/`tool_execution_update`/`tool_execution_end`, `turn_end`, `agent_end`, and `cache_shape` (per-turn prefix diagnostics).

#### Scenario: Full turn lifecycle
- **WHEN** a prompt produces one tool call and a final text response
- **THEN** events are emitted: `agent_start` → `turn_start` → `message_start`/`message_end` (prompt) → `message_start` → (streaming deltas) → `message_end` → `tool_execution_start` → `tool_execution_end` → `message_start`/`message_end` (tool result) → `turn_end` → `turn_start` → `message_start` → (streaming deltas) → `message_end` → `turn_end` → `agent_end`

#### Scenario: Message lifecycle brackets every message
- **WHEN** any message enters the working transcript (user prompt, steer, tool result, assistant)
- **THEN** it is bracketed by `message_start` and `message_end` events carrying the message payload

### Requirement: Agent loop executes tool calls with permission evaluation

The system SHALL execute tool calls returned by the LLM. Before execution, each tool call goes through: argument preparation (`prepareArguments`), validation, permission evaluation, and `beforeToolCall` hook. After execution, the `afterToolCall` hook runs. Tool results are persisted as `ToolResultMessage` entries.

#### Scenario: Tool found and executed successfully
- **WHEN** the LLM calls a registered tool and the tool returns a result
- **THEN** the result is emitted as `tool_execution_end` and persisted as a `toolResult` message

#### Scenario: Tool not found returns error
- **WHEN** the LLM calls a tool name that is not registered
- **THEN** an error tool result is returned with `"Tool <name> not found"` and the loop continues

#### Scenario: Permission denied blocks execution
- **WHEN** permission evaluation returns `"deny"` for a tool call
- **THEN** the tool is not executed; an error result with `"Permission denied"` is returned

#### Scenario: beforeToolCall blocks execution
- **WHEN** the `beforeToolCall` hook returns `{ block: true, reason: "..." }`
- **THEN** the tool is not executed; an error result with the reason is returned

#### Scenario: afterToolCall patches the result
- **WHEN** the `afterToolCall` hook returns a modified result
- **THEN** the patched result (content, isError, terminate) replaces the original

#### Scenario: Tool execution error is captured as error result
- **WHEN** a tool's `execute` throws
- **THEN** the error message is captured as an error tool result and the loop continues

### Requirement: Tool execution supports sequential and parallel modes

The system SHALL execute tool calls in sequential mode when `config.toolExecution === "sequential"` or when any tool in the batch has `executionMode: "sequential"`. Otherwise, tools execute in parallel via Effect `FiberSet`. Single-tool batches run identically in both modes.

#### Scenario: Sequential execution
- **WHEN** `toolExecution: "sequential"` and 2+ tool calls are returned
- **THEN** tools execute one at a time, in order, with each result finalized before the next starts

#### Scenario: Parallel execution
- **WHEN** `toolExecution: "parallel"` and 2+ tool calls with no sequential tools
- **THEN** all tools are forked concurrently and results are finalized in source order

#### Scenario: One sequential tool forces sequential batch
- **WHEN** a batch contains 3 tools where one has `executionMode: "sequential"`
- **THEN** the entire batch runs sequentially

#### Scenario: Abort breaks the tool batch
- **WHEN** the abort signal fires during a sequential batch after tool 2 completes
- **THEN** tool 3 is not executed; tools 1 and 2 results are kept

### Requirement: Tool-batch termination uses AND semantics

The system SHALL terminate the turn only when every tool result in a batch has `terminate: true`. A batch where some tools terminate and others do not SHALL NOT terminate. An empty batch SHALL NOT terminate.

#### Scenario: All tools terminate
- **WHEN** all tools in a batch return `terminate: true`
- **THEN** the loop terminates after the batch

#### Scenario: Mixed terminate flags
- **WHEN** one tool returns `terminate: true` and another returns `terminate: false`
- **THEN** the loop does NOT terminate

### Requirement: Agent loop converts messages at the LLM boundary

The system SHALL transform `AgentMessage[]` (the internal representation including custom types) to LLM `Message[]` only at the point of calling the stream function, via the configurable `convertToLlm` callback. This allows custom message types (`bashExecution`, `branchSummary`, `observation`, etc.) to be excluded or reformatted for the provider.

#### Scenario: Custom messages excluded from LLM context
- **WHEN** the context contains `bashExecution` and `branchSummary` messages
- **THEN** `convertToLlm` filters them out before passing to the stream function

### Requirement: Context transform runs before LLM call

The system SHALL apply `transformContext` (if configured) to the messages before conversion and streaming. This allows dynamic message rewriting at each turn.

#### Scenario: Transform modifies context
- **WHEN** `transformContext` is configured and returns modified messages
- **THEN** the modified messages are converted and sent to the LLM

### Requirement: prepareNextTurn allows dynamic reconfiguration

The system SHALL call `prepareNextTurn` after each turn completes. If it returns a snapshot with updated `model`, `thinkingLevel`, or `context`, those are applied for the next turn.

#### Scenario: Model changed mid-session
- **WHEN** `prepareNextTurn` returns `{ model: newModel }`
- **THEN** subsequent turns use `newModel`

### Requirement: Steering and follow-up messages are injected between turns

The system SHALL drain `getSteeringMessages()` at the top of each turn and `getFollowUpMessages()` after the inner loop exhausts. Drained messages are emitted as `message_start`/`message_end` and added to context.

#### Scenario: Steer message processed at turn start
- **WHEN** a steer message is queued and a new turn begins
- **THEN** the steer is emitted as a message event and added to the context before the LLM call

#### Scenario: Follow-up continues the outer loop
- **WHEN** the inner loop completes and `getFollowUpMessages()` returns messages
- **THEN** those messages become pending and a new turn starts

### Requirement: Max steps limits total turns

The system SHALL stop after `config.maxSteps` turns. On the last step, `toolChoice: "none"` is sent to prevent further tool calls, forcing a final text response.

#### Scenario: Max steps reached
- **WHEN** `maxSteps: 5` and 5 turns have completed
- **THEN** the loop emits `agent_end` without starting a 6th turn

### Requirement: Observational memory hooks run at turn boundaries

The system SHALL call `observationalMemory.engine.maybeObserve()` and `maybeReflect()` at turn boundaries (after each turn's `shouldStopAfterTurn` check). Read-only observational memory blocks are injected as ephemeral user messages after the skill-pair position.

#### Scenario: OM observe/reflect runs between turns
- **WHEN** `observationalMemory` is configured and a turn completes
- **THEN** `maybeObserve` and `maybeReflect` are called on the OM engine

#### Scenario: Read-only OM blocks injected
- **WHEN** `observationalMemoryReadOnly` returns observation blocks
- **THEN** they are inserted as user messages after the skill-pair in the context

### Requirement: Cache shape diagnostics emitted per turn

The system SHALL capture the prefix shape of each LLM request and emit `cache_shape` events with diagnostics comparing consecutive shapes, enabling the UI to display prompt-cache utilization.

#### Scenario: Cache shape event after turn
- **WHEN** a turn completes its LLM call
- **THEN** a `cache_shape` event is emitted with diagnostics about the prefix

### Requirement: Error and abort produce stopReason on the message

The system SHALL encode stream errors and aborts as `stopReason: "error"` or `"aborted"` on the final `AssistantMessage`, with the error message in `errorMessage`. These messages are returned normally (not thrown).

#### Scenario: Aborted turn
- **WHEN** the abort signal fires during an LLM stream
- **THEN** the final assistant message has `stopReason: "aborted"` and the loop ends with `turn_end` + `agent_end`

### Requirement: Both async and Effect-native APIs are provided

The system SHALL export `runAgentLoop`/`runAgentLoopContinue` (async, returning `Promise<AgentMessage[]>`), `agentLoop`/`agentLoopContinue` (returning `AgentEventStream` — an async iterable with a `result()` promise), and `runAgentLoopEffect`/`runAgentLoopContinueEffect` (Effect-native).

#### Scenario: AgentEventStream usage
- **WHEN** `agentLoop(prompts, context, config)` is called
- **THEN** it returns an `AgentEventStream` that is both async-iterable (yielding events) and has a `result()` promise

#### Scenario: Continue from existing context
- **WHEN** `agentLoopContinue(context, config)` is called
- **THEN** the loop runs from the current context without adding a new prompt message
