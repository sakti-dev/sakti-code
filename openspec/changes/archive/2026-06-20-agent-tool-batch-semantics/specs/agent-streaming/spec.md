## ADDED Requirements

### Requirement: Tool-batch termination requires ALL tools to request it (AND semantics)
When multiple tool calls execute in a single turn (a "batch"), the agent loop SHALL terminate the turn only if **every** tool result in the batch requests termination. The terminate decision SHALL be computed as `shouldTerminateToolBatch(results) = results.length > 0 && results.every(r => r.result.terminate === true)` — matching pi's `shouldTerminateToolBatch` (`openspec/references/pi/packages/agent/src/agent-loop.ts:544-546`). A batch where some tools request termination and others do not SHALL NOT terminate (previously it did, under OR semantics). An empty batch SHALL NOT terminate (the `length > 0` guard).

#### Scenario: All tools terminate → batch terminates
- **WHEN** a batch of N tool calls all return `terminate: true`
- **THEN** the loop terminates after the batch (AND of all-true is true)

#### Scenario: One tool terminates, another does not → batch continues
- **WHEN** a batch contains tool A (`terminate: true`) and tool B (`terminate: false`)
- **THEN** the loop does NOT terminate — it continues to the next turn (AND of mixed is false)

#### Scenario: No tools terminate → batch continues
- **WHEN** a batch of tool calls all return `terminate: false`
- **THEN** the loop continues (AND of all-false is false)

#### Scenario: Single tool terminating is unchanged
- **WHEN** a single-tool batch returns `terminate: true`
- **THEN** the loop terminates (single-element every() is trivially the element's value) — backward compatible with existing single-tool terminate behavior

### Requirement: Abort breaks the tool batch
When the tool-execution signal (the combined caller + steer-abort signal) is aborted during a tool batch, the agent loop SHALL NOT start any remaining tools in the batch. In sequential mode, after each tool completes, the loop SHALL check `if (signal?.aborted) break;` and skip subsequent tools — matching pi (`agent-loop.ts:444-446`). In parallel mode, after each tool is prepared (its `tool_execution_start` emitted and its execution scheduled), the loop SHALL check `if (signal?.aborted) break;` and skip preparing subsequent tools — matching pi's parallel prepare-loop (`agent-loop.ts:489-491`). Already-completed tool results (sequential) and already-prepared tools (parallel, which then run to completion via `Promise.all`) SHALL be kept and their messages persisted. A tool that respects the signal SHALL abort mid-flight (existing behavior, unchanged).

#### Scenario: Sequential batch stops after mid-batch abort
- **WHEN** a 3-tool batch runs sequentially and the signal aborts after tool 2 completes
- **THEN** tool 3 is NOT executed; tools 1 and 2's results are persisted

#### Scenario: Parallel batch stops preparing after mid-prepare abort
- **WHEN** a 3-tool batch runs in parallel and the signal aborts while preparing tool 3 (after tools 1 and 2 are prepared and running)
- **THEN** tool 3 is NOT prepared or executed; tools 1 and 2 run to completion concurrently and their results are persisted

#### Scenario: In-flight tool aborts via the signal (unchanged)
- **WHEN** a tool that respects the abort signal is running and the signal fires
- **THEN** the tool aborts mid-flight (existing behavior via `tool.execute(..., signal)`) — complementary to the batch break, not redundant

### Requirement: Parallel tool execution follows pi's two-phase structure
When `AgentConfig.toolExecutionMode` is `"parallel"` AND a turn's assistant message contains more than one tool call, the agent loop SHALL execute the tool calls concurrently via pi's two-phase structure (`agent-loop.ts:456-516`): (1) a sequential **prepare loop** that emits `tool_execution_start` for each tool call and schedules its execution, breaking on `signal?.aborted`; (2) a `Promise.all` that runs the scheduled executions concurrently; (3) a sequential **finalize loop** over the ordered results that builds and persists each tool-result message. Single-tool batches SHALL run identically in both modes (the parallel path with one tool call is equivalent to sequential). When `toolExecutionMode` is `"sequential"`, OR when the batch contains a single tool call, the loop SHALL use the sequential `for…of` path. Each tool's `tool_execution_start` → `tool_execution_update`* → `tool_execution_end` events SHALL be grouped per-tool (identified by `toolCallId`); in parallel mode, events from concurrent tools MAY be delivered grouped-per-tool-in-call-order rather than live-interleaved (a divergence from pi forced by the async-generator constraint — execution is concurrent, event delivery is ordered).

#### Scenario: Multiple tools run concurrently in parallel mode
- **WHEN** `toolExecutionMode: "parallel"` and a turn has 2+ independent tool calls
- **THEN** the tools execute concurrently (both start within a small timing tolerance, not sequentially)

#### Scenario: Single tool call runs identically in both modes
- **WHEN** a turn has exactly one tool call, regardless of `toolExecutionMode`
- **THEN** execution is identical to the sequential path (no concurrency overhead, same event order)

#### Scenario: Sequential mode runs tools one at a time
- **WHEN** `toolExecutionMode: "sequential"` and a turn has 2+ tool calls
- **THEN** tools run strictly in order (tool 2 starts only after tool 1 completes)

#### Scenario: Parallel results are finalized in tool-call order
- **WHEN** a parallel batch of [toolA, toolB] completes with toolB finishing before toolA
- **THEN** the tool-result messages and `message_start`/`message_end` events are emitted in tool-call order (toolA's result first, then toolB's) — `Promise.all` preserves array order regardless of completion order

#### Scenario: toolExecutionMode is threaded into executeToolCalls
- **WHEN** the loop invokes `executeToolCalls`
- **THEN** it passes `resolved.toolExecutionMode` so the dispatch honors the session's configured mode (currently `executeToolCalls` does not receive the mode and always runs sequentially)
