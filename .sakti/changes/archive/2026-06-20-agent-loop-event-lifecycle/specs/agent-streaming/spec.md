## ADDED Requirements

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
