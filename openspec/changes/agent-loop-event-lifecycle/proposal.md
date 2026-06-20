## Why

Our agent loop emits `message_start`/`message_end` events around only the assistant LLM stream (`packages/agent/src/loop/index.ts:133,157`), and those events carry **no payload** — they are bare `{type, timestamp}` markers. Verified against pi's `agent-loop.ts`, which emits the lifecycle around **every** message that enters the transcript and **carries the message itself** in each event:

| Message type | pi emit site | pi event payload |
|---|---|---|
| Initial prompt(s) | `agent-loop.ts:112-113` | `message: prompt` |
| Each pending/steer message | `:184-185` | `message: <the message>` |
| Assistant stream (start) | `:319` and `:351` (partial on first delta, full if none) | `message: {...partialMessage}` / `{...finalMessage}` |
| Assistant stream (end) | `:353` and `:366` | `message: finalMessage` |
| Each tool result message | `:746-747` (`emitToolResultMessage`) | `message: toolResultMessage` |

This is a two-part defect, both verified:

1. **Missing lifecycle sites.** UI/event consumers cannot know when a user prompt, an injected steer, or a tool result "enters" the transcript as a discrete message — they must special-case these by inferring from `turn_start`/`turn_end`/`tool_execution_end`. pi emits a uniform `message_start`→`message_end` bracket around every persisted message, giving consumers a single, consistent message-boundary signal.
2. **Empty payload.** Our `MessageStartEvent`/`MessageEndEvent` (`types.ts:69-72`) carry only `type`+`timestamp`. pi's carry the `message` being started/ended. Without the payload, a consumer can't tell *which* message the bracket refers to — defeating the purpose of the lifecycle events for prompt/steer/tool-result cases (where there's no streaming delta stream to identify the message).

These bundle because the payload addition is what makes the new emit sites *useful* (a payload-less `message_start` for a steer is no more informative than the `turn_start` that precedes it).

## What Changes

- **Carry the message payload.** Add an optional `message?: AgentMessage` field to `MessageStartEvent` and `MessageEndEvent`. Optional (not required) so existing consumers and old persisted events that lack it continue to work; new emissions SHALL populate it.
- **Emit lifecycle around the prompt.** Before/after `injectMessage(messages, message)` at loop entry, yield `message_start`/`message_end` carrying the user message — matching pi `agent-loop.ts:112-113`.
- **Emit lifecycle around each injected steer.** Convert `drainSteers` from `async (...): Promise<boolean>` to `async function* (...): AsyncGenerator<AgentEvent, boolean>` so it yields `message_start`/`message_end` (carrying the steer message) around each injected steer — matching pi's per-message loop (`agent-loop.ts:181-188`). The loop's two call sites `await drainSteers(...)` become `yield* drainSteers(...)`.
- **Emit lifecycle around each tool result message.** In `tool-execution.ts`, wrap each `toolResult` message construction/persistence with `message_start`/`message_end` carrying the tool result message — matching pi's `emitToolResultMessage` (`agent-loop.ts:746-747`). (Tool *execution* lifecycle — `tool_execution_start/update/end` — remains unchanged; this adds the *message* lifecycle for the resulting `toolResult` message specifically.)
- **Populate the payload on the assistant-stream `message_start`/`message_end`** the loop already emits (currently payload-less), carrying the assistant message.

### No Breaking Changes

- `message?: AgentMessage` is optional on both events; existing consumers that ignore it (all of them — verified no UI consumer exists; WS forwards the event object as-is) and old persisted events are unaffected.
- `drainSteers`'s signature change (`Promise<boolean>` → `AsyncGenerator<AgentEvent, boolean>`) is internal to `packages/agent/src/loop/`; the only callers are the two `await drainSteers(messages)` sites in `index.ts`, which become `yield* drainSteers(messages)` (semantically identical for the boolean return — the generator's return value is the "had steers" flag).
- Existing test assertions on event *ordering* (`message_start` before `message_end` before `turn_end`, etc.) remain valid — this change adds more `message_start`/`message_end` pairs, it does not reorder existing ones.
- The WS wire format is unchanged (events are forwarded as-is inside `{type:"event", event, sessionId}` frames).

## Capabilities

### New Capabilities

_(None.)_

### Modified Capabilities

- `agent-streaming`: ADDS a requirement — every message that enters the transcript (prompt, injected steer, tool result message, assistant message) SHALL be wrapped in `message_start`/`message_end` events, and those events SHALL carry the message payload — matching pi's uniform message-boundary lifecycle. The existing assistant-stream wrapping is widened to include the payload; the other three sites are new.

## Impact

- **`packages/agent/src/types.ts`** — `MessageStartEvent`/`MessageEndEvent` gain optional `message?: AgentMessage`.
- **`packages/agent/src/loop/index.ts`** — emit `message_start`/`message_end` (carrying the user message) around the prompt injection; convert `drainSteers` to an async generator yielding `message_start`/`message_end` (carrying each steer message) per steer; update the two call sites to `yield*`; populate the payload on the existing assistant-stream `message_start`/`message_end`.
- **`packages/agent/src/loop/tool-execution.ts`** — emit `message_start`/`message_end` (carrying the tool result message) around each `toolResult` message construction/persistence (matching pi `emitToolResultMessage`).
- **Tests** — `loop-behavior.test.ts`: assert prompt, each steer, and each tool result each get a `message_start`/`message_end` pair carrying the correct message; update existing ordering assertions to account for the new pairs. `event-types.test.ts`: update the bare `{type:"message_start", timestamp:0}` constructions (payload is optional, so these still typecheck, but assertions should reflect the new capability).
- **No server / DB / WS-format changes.** Confined to `packages/agent`. WS forwards events as-is.
- **Scope boundary** — this change does NOT restructure the event taxonomy (no new event types), does NOT change the assistant-stream partial-message pattern (pi's `partialMessage` on first delta, `agent-loop.ts:319` — our `message_update` events already cover streaming; the assistant `message_start` here carries the *initial* message context, not partial deltas), and does NOT add pi's `AgentEventSink` abstraction (over-engineering for our single-consumer model). It adds only the message-lifecycle brackets pi emits.
- **Dependencies** — none new; all within `packages/agent`.
