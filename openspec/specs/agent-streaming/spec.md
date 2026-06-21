## Purpose

The agent streaming layer wires a single `AgentHarness` run to a client over a WebSocket: it resolves the session's model, builds cwd-scoped tools, constructs an ephemeral `AgentHarness` per prompt, forwards the harness's `AgentHarnessEvent` stream as `event` frames via a push-based `subscribe()` callback, and supports prompt/abort/steer/followUp control messages. It maintains an in-process active-run registry keyed by sessionId and allows multiple prompts (across sessions or projects) to run concurrently on one connection with isolated persistence.

## Requirements

### Requirement: Per-prompt agent runner
The system SHALL provide `runPrompt(ctx, sessionId, message, storage, eventCallback)` returning `Promise<void>` that, for a valid session+project, resolves the model from stored config, builds cwd-scoped tools, constructs a fresh ephemeral `AgentHarness` wrapping a `Session` over the injected `SessionStorage`, subscribes to the harness's events via `harness.subscribe(eventCallback)`, and runs `harness.prompt(message)`. Each invocation SHALL construct its own harness, model, tools, and session (no shared mutable state between prompts). Entries produced by the harness SHALL be persisted via the injected `SessionStorage` so they survive across prompts. The runner manages an internal active-run registry; callers call `harness.abort()` to cancel.

#### Scenario: streams events and persists entries for a valid session
- **WHEN** `runPrompt` is called with a valid `sessionId` and the harness's `prompt` runs to completion
- **THEN** the `eventCallback` receives events including `agent_start` and `agent_end`
- **AND** `storage.getEntries()` returns entries after the promise resolves

#### Scenario: unknown session
- **WHEN** `runPrompt` is called with a `sessionId` that does not exist
- **THEN** the generator throws an error matching `/Session not found/`

#### Scenario: unknown project
- **WHEN** `runPrompt` is called with a session whose `projectId` does not exist
- **THEN** the generator throws an error matching `/Project not found/`

### Requirement: Model resolution from stored config
The system SHALL resolve the pi-ai `Model` for a session by reading `ModelConfigRepo.getForProject(projectId)` and falling back to `ModelConfigRepo.getGlobalDefault()` when no project-specific config exists. Resolution SHALL call `getModel(provider, modelId)` using only values stored in the config row. API keys SHALL NOT be read from the DB — they come from the environment (pi-ai reads them). If neither a project config nor a global default exists, the resolver SHALL throw.

#### Scenario: resolves via project config
- **WHEN** a session's project has a stored model config and `runPrompt` constructs the harness
- **THEN** the harness's model is the one resolved from the project's config row

#### Scenario: falls back to global default
- **WHEN** a session's project has no stored config but a global default exists
- **THEN** the harness's model is the global default

#### Scenario: no config available
- **WHEN** neither a project config nor a global default exists
- **THEN** `runPrompt` throws an error mentioning the missing config

### Requirement: Cwd-scoped tools built per prompt
The system SHALL build the 7 coding tools (`createReadTool`, `createWriteTool`, `createEditTool`, `createBashTool`, `createGrepTool`, `createFindTool`, `createLsTool`) scoped to the session's project `cwd` on every `runPrompt` call. Each call SHALL construct fresh tool instances; tools SHALL NOT be shared across prompts or projects.

#### Scenario: tools use the project cwd
- **WHEN** `runPrompt` runs for a session whose project cwd is `/proj/a`
- **THEN** every tool constructed for that run is scoped to `/proj/a`

### Requirement: Active-run registry
The system SHALL maintain an in-process registry mapping `sessionId` to the active `AgentHarness` and its unsubscribe callback for the duration of a run. `abortRun(sessionId)` SHALL call `harness.abort()` and return `true` if a run was active (or `false` otherwise). Runs SHALL unregister themselves when the prompt completes (normally, via abort, or via error) via a `finally { unregisterRun }` block so the registry does not leak.

#### Scenario: abort signals an active run
- **WHEN** a run is registered and `abortRun(sessionId)` is called
- **THEN** `harness.abort()` is invoked on the active run
- **AND** `abortRun` returns `true`

#### Scenario: abort with no active run
- **WHEN** `abortRun(sessionId)` is called for a session with no active run
- **THEN** it returns `false` and does not throw

#### Scenario: registry entry removed after run ends
- **WHEN** a run completes (or throws)
- **THEN** its `sessionId` is removed from the active registry

### Requirement: WebSocket prompt/abort/steer/followUp protocol
The system SHALL expose a WebSocket at `/ws`. Inbound messages SHALL be `{type:"prompt", sessionId, message}`, `{type:"abort", sessionId}`, `{type:"steer", sessionId, message}`, or `{type:"followUp", sessionId, message}`. Outbound messages SHALL be `{type:"event", sessionId, event}` (where `event` is an `AgentHarnessEvent`) or `{type:"error", sessionId, error}`. Every outbound frame SHALL carry the `sessionId` so the client can route frames to the correct conversation.

#### Scenario: prompt produces an event frame stream
- **WHEN** a `prompt` message is received for a valid session and the harness emits an `agent_start` event
- **THEN** the client receives an `event` frame whose `event.type` is `agent_start` and whose `sessionId` matches the request

#### Scenario: abort stops a run
- **WHEN** an `abort` message is received while a run is active on that `sessionId`
- **THEN** `harness.abort()` is called and the run stops

#### Scenario: run failure emits an error frame
- **WHEN** a `prompt` triggers an error (e.g. session not found) and the error is caught
- **THEN** the client receives an `error` frame carrying the `sessionId` and a human-readable message

#### Scenario: steer produces no immediate event frame
- **WHEN** a `steer` message is processed by the harness
- **THEN** no immediate event frame is sent; the steer's effects appear as normal text_delta/tool_execution events when the harness re-sends to the LLM

### Requirement: WebSocket accepts steer and followUp messages
The WebSocket protocol at `/ws` SHALL accept two new inbound message types:
- `{ type: "steer", sessionId: string, message: string }`
- `{ type: "followUp", sessionId: string, message: string }`

When received, the WS handler SHALL look up the active harness for the given `sessionId` via the active-run registry and call `harness.steer(message)` or `harness.followUp(message)`. If no active run exists for the sessionId, the handler SHALL send an `{ type: "error", sessionId, error: "No active run" }` frame.

#### Scenario: steer message forwarded to active harness
- **WHEN** a `steer` message is received with a `sessionId` that has an active run
- **THEN** the handler calls `harness.steer(message)` and does NOT send a response frame

#### Scenario: steer with no active session
- **WHEN** a `steer` message is received with a `sessionId` that has no active run
- **THEN** the handler sends an `error` frame with `sessionId` and a descriptive message

### Requirement: Same-connection concurrency
The system SHALL allow multiple prompts on a single WebSocket connection to run concurrently. The WS `message` handler SHALL NOT await the full `runPrompt` promise before returning; each prompt SHALL run independently on the event loop and interleave its outbound frames. This is what enables "two projects open at once" over one connection.

#### Scenario: second prompt is not blocked by the first
- **WHEN** a `prompt` message is received while a previous prompt on the same connection is still streaming
- **THEN** the second prompt's run begins without waiting for the first to finish
- **AND** both streams' frames are delivered to the client, each carrying its own `sessionId`

### Requirement: Multi-session persistence isolation
When two prompts run concurrently on two different sessions (different projects), each session's entries SHALL be persisted independently with no cross-contamination — each session's `SessionStorage.getEntries()` returns only that session's entries.

#### Scenario: two projects concurrent, independent persistence
- **WHEN** two `prompt` messages are sent (one per project/session) and both runs are allowed to complete
- **THEN** each session's loaded entries belong only to that session
- **AND** each client receives frames tagged with only its own `sessionId`

### Requirement: Registration via route composition
The WebSocket route SHALL be registered through `buildServer`'s array-composition (the pattern established by `server-rest-api`), not by editing the foundation's `index.ts`. This change SHALL add its route module to the composition and SHALL NOT modify `apps/server/src/index.ts` directly.

#### Scenario: WS available on a composed server
- **WHEN** `buildServer` is composed with this change's route module
- **THEN** the `/ws` endpoint is available on the resulting server
- **AND** the foundation's `index.ts` was not edited to register it

### Requirement: Same-session concurrent prompts are rejected, not silently overwritten
The system SHALL reject a `prompt` message for a session that already has an active run, sending an `error` frame with a guidance message — it SHALL NOT silently start a second run that overwrites the first's registry entry. The rejection SHALL carry a message guiding the client to the correct alternatives: `"A run is already active for session <id>. Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first."` This mirrors pi's default-path concurrency rejection (`agent-session.ts:1037-1048`: when `isStreaming` and no `streamingBehavior` is specified, throw `"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."`), adapted to our WS message-type vocabulary where the queue-vs-reject choice is encoded in the message type (`prompt` = reject path; `steer`/`followUp` = queue path). The guard SHALL be race-free: `registerRun` SHALL perform a synchronous check-and-set (`if activeRuns.has(sessionId) return false; activeRuns.set(...); return true`) so that no `await` gap exists between the concurrency check and the registration — two near-simultaneous `prompt` messages on the same session SHALL result in exactly one successful run and one rejection, regardless of timing. A `prompt` for a session with no active run SHALL start normally. After a run terminates (normal completion, abort, or error) and unregisters itself, a subsequent `prompt` on the same session SHALL succeed.

#### Scenario: Second prompt on active session is rejected with guidance
- **WHEN** a `prompt` message arrives for a session that has an active run
- **THEN** the system sends an `error` frame with message matching `/A run is already active.*steer.*followUp.*abort/` and does NOT start a second run (the first run's registry entry is preserved)

#### Scenario: Race-free: two near-simultaneous prompts yield exactly one run
- **WHEN** two `prompt` messages for the same session arrive within the same event-loop tick (or across `await` boundaries before `registerRun`)
- **THEN** exactly one prompt starts a run and the other receives an `error` frame — the atomic `registerRun` (synchronous `has`+`set`) guarantees no double-registration

#### Scenario: Prompt on idle session starts normally
- **WHEN** a `prompt` message arrives for a session with no active run
- **THEN** the system starts the run, registers it, and forwards events — no rejection

#### Scenario: Prompt after termination succeeds
- **WHEN** a run terminates (completes, is aborted, or errors) and unregisters itself, then a new `prompt` arrives for the same session
- **THEN** the new prompt starts normally (the session is no longer guarded)

#### Scenario: Steer and followUp while active still queue (unchanged)
- **WHEN** a `steer` or `followUp` message arrives for a session with an active run
- **THEN** the message is queued via `harness.steer()` / `harness.followUp()` as before — the concurrency guard applies only to `prompt`, not to steer/followUp (these are the harness's explicit queue paths, already wired)

#### Scenario: Abort during the termination window still rejects a new prompt
- **WHEN** `abort` has been called but the run has not yet reached its `finally { unregisterRun }` block
- **THEN** a new `prompt` on the same session is still rejected (the run is technically still active until fully unregistered), matching pi's `isStreaming` remaining true until the run fully drains

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

### Requirement: Message lifecycle events bracket every persisted message and carry the payload
The agent loop SHALL emit a `message_start` event immediately before, and a `message_end` event immediately after, every message that enters the working transcript — the initial user prompt, each injected steer message, each tool-result message, and each assistant message — matching pi's uniform message-boundary lifecycle (`openspec/references/pi/packages/agent/src/agent-loop.ts`: prompt at `:112-113`, each pending/steer message at `:181-188` via a per-message loop, each tool result via `emitToolResultMessage` at `:746-747`, the assistant stream at `:319`/`:351` start and `:353`/`:366` end). Each `message_start` and `message_end` event SHALL carry the message it brackets as a `message: AgentMessage` payload field, so a consumer can identify which message is starting/ending (a payload-less bracket is no more informative than the surrounding `turn_start`/`tool_execution_end` events). The existing assistant-stream `message_start`/`message_end` emissions SHALL be widened to include this payload. This gives event consumers a single, consistent message-boundary signal for every persisted message, instead of requiring them to special-case prompt/steer/tool-result by inferring from other events. The `message` field SHALL be optional in the event type (old persisted events and hand-constructed test events may lack it) but every new emission SHALL populate it.

#### Scenario: User prompt is wrapped in message_start/message_end
- **WHEN** the loop receives a prompt and begins a run
- **THEN** it emits `agent_start`, followed by a `message_start`/`message_end` pair carrying the user prompt message (role `user`, the prompt text), before the turn loop begins — matching pi `agent-loop.ts:111-113`

#### Scenario: Each injected steer is individually wrapped
- **WHEN** one or more steer messages are drained from the steer queue during a turn
- **THEN** each steer message is wrapped in its own `message_start`/`message_end` pair carrying that steer message — one pair per steer, not one pair per batch — matching pi's per-message loop at `agent-loop.ts:181-188`

#### Scenario: Each tool-result message is wrapped
- **WHEN** a tool execution completes and its `toolResult` message is constructed and persisted
- **THEN** the loop emits a `message_start`/`message_end` pair carrying that tool-result message, emitted after the `tool_execution_end` event for that tool (the tool's *execution* lifecycle and the result message's *message* lifecycle are distinct, as in pi's `emitToolResultMessage`)

#### Scenario: Assistant message lifecycle carries the payload
- **WHEN** the assistant LLM stream begins and ends within a turn
- **THEN** the `message_start` carries the initial assistant message context and the `message_end` carries the final assistant message (role `assistant`, its content/usage) — the payload is no longer omitted

#### Scenario: Ordering of existing events is preserved
- **WHEN** a run proceeds through prompt, turn, assistant stream, tool execution, and termination
- **THEN** the pre-existing ordering invariants hold: `agent_start` precedes every `message_start`; the assistant-stream `message_start` precedes its `message_end`; `message_end` precedes the corresponding `turn_end`; `turn_end` precedes `agent_end` — only new `message_start`/`message_end` pairs are inserted, no existing pair is reordered

#### Scenario: steer-draining preserves its "had steers" return semantics
- **WHEN** `drainSteers` is converted from a `Promise<boolean>` to an `AsyncGenerator<AgentEvent, boolean>`
- **THEN** the loop's two call sites evaluate the generator's return value as the "had any steers" flag (via `yield* drainSteers(...)`), preserving the existing turn-increment/continue behavior — the conversion adds per-steer events without changing control flow
