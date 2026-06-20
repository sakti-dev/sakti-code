## 1. Add `message` payload to the event types (prerequisite)

- [ ] 1.1 Add optional `message?: AgentMessage` to `MessageStartEvent` and `MessageEndEvent` in `packages/agent/src/types.ts`. Import `AgentMessage` (already in scope).
- [ ] 1.2 `bun typecheck` — confirm no breakage (optional field; existing bare constructions still typecheck).
- [ ] 1.3 Commit "feat(agent): add optional message payload to message_start/message_end events".

## 2. Emit lifecycle around the prompt (pi agent-loop.ts:111-113)

- [ ] 2.1 Write failing test in `packages/agent/src/__tests__/loop-behavior.test.ts`: collect events from `loop.prompt("hello")`; assert a `message_start`/`message_end` pair exists carrying a message with `role:"user"` and `content:"hello"`, emitted AFTER `agent_start` and BEFORE the turn loop's `turn_start`. RED (currently no such pair for the prompt).
- [ ] 2.2 In `packages/agent/src/loop/index.ts`, after `await injectMessage(messages, message)` (line ~89) and before `yield evt("agent_start"...)`, OR per pi's order (agent_start → prompt lifecycle → turn loop): build the user message object, then `yield evt("message_start", {message: userMsg}); yield evt("message_end", {message: userMsg});` around (or just bracketing) the inject. **Order per design Open Question:** `agent_start` → prompt `message_start`/`message_end` → while loop (turn_start inside).
- [ ] 2.3 Test → GREEN. Run `bun vitest run packages/agent/`.
- [ ] 2.4 Gate + commit "feat(agent-loop): emit message lifecycle around the prompt (pi:112-113)".

## 3. Convert `drainSteers` to async generator + per-steer lifecycle (pi agent-loop.ts:181-188)

- [ ] 3.1 Write failing test: queue 2 steers; run a prompt that processes them; assert TWO `message_start`/`message_end` pairs (one per steer), each carrying the correct steer message text, emitted in FIFO order. RED.
- [ ] 3.2 In `packages/agent/src/loop/index.ts`, change `async function drainSteers(messages): Promise<boolean>` to `async function* drainSteers(messages): AsyncGenerator<AgentEvent, boolean>`. Inside the per-steer loop, around each `injectMessage`, yield `evt("message_start", {message: steerMsg}); ... yield evt("message_end", {message: steerMsg});`. Keep the `return <hadSteers>` as the generator return value.
- [ ] 3.3 Update the **three** call sites (verified by grep `drainSteers(` in index.ts): line ~93 `await drainSteers(messages)` → `yield* drainSteers(messages)` (pre-compaction drain, return value discarded); line ~179 `if (await drainSteers(messages))` → `if (yield* drainSteers(messages))` (post-no-tool-call); line ~223 `const hadSteers = await drainSteers(messages)` → `const hadSteers = yield* drainSteers(messages)` (post-tool-execution).
- [ ] 3.4 Test → GREEN. Run full agent suite.
- [ ] 3.5 Gate + commit "feat(agent-loop): per-steer message lifecycle via drainSteers generator (pi:181-188)".
- [ ] 3.6 Re-grep `drainSteers(` in `index.ts` to confirm NO `await drainSteers` remains (all three converted to `yield*`); an accidental leftover `await` would silently drop the yielded events.

## 4. Tool-result message lifecycle in tool-execution.ts (pi emitToolResultMessage:746-747)

- [ ] 4.1 Write failing test in `packages/agent/src/__tests__/loop-behavior.test.ts`: run a prompt that triggers a tool call; assert each `toolResult` message gets a `message_start`/`message_end` pair carrying the tool-result message, emitted AFTER `tool_execution_end` for that tool and BEFORE the next turn's events. RED.
- [ ] 4.2 In `packages/agent/src/loop/tool-execution.ts`, after constructing each `toolResult` message and around its persistence, yield `evt("message_start", {message: toolResult});` and `evt("message_end", {message: toolResult});`. (The function is already an async generator yielding `tool_execution_*` events — add the message-lifecycle yields alongside.)
- [ ] 4.3 Verify the ordering is `tool_execution_start` → `tool_execution_update`* → `tool_execution_end` → `message_start`(toolResult) → `message_end`(toolResult) per tool (pi's structure in `executeToolCalls`/`emitToolResultMessage`).
- [ ] 4.4 Test → GREEN. Run full agent suite.
- [ ] 4.5 Gate + commit "feat(agent-loop): tool-result message lifecycle (pi emitToolResultMessage:746-747)".

## 5. Populate payload on assistant-stream message_start/message_end (pi:319/351/353/366)

- [ ] 5.1 Write failing test: collect events from a text turn; assert the assistant-stream `message_end` carries a message with `role:"assistant"` and the final content; assert `message_start` carries an initial assistant message context. RED (currently payload-less).
- [ ] 5.2 In `packages/agent/src/loop/index.ts`, at the existing `yield evt("message_start")` (line ~133) add the payload: the initial assistant message context (an empty/placeholder assistant message at start — equivalent to pi's `{...finalMessage}` at `:351` no-delta case; we do NOT replicate pi's partial-on-first-delta since `message_update` covers streaming). At `yield evt("message_end")` (line ~157) add the payload: `streamResult.finalAssistant`. Note: `message_end` is emitted AFTER `streamResult` is available (post-stream).
- [ ] 5.3 Test → GREEN. Run full agent suite.
- [ ] 5.4 Gate + commit "feat(agent-loop): carry payload on assistant message_start/message_end".

## 6. Update existing test assertions

- [ ] 6.1 In `packages/agent/src/__tests__/event-types.test.ts`, the bare `{type:"message_start", timestamp:0}` constructions (lines 53-54, 195-196) still typecheck (payload optional) — but add a parallel assertion that a populated `{type:"message_start", timestamp:0, message: someMsg}` is also valid, documenting the new capability.
- [ ] 6.2 In `packages/agent/src/__tests__/loop-behavior.test.ts`, review the ordering assertions (lines 171-178) — confirm they still hold with the new prompt/steer/tool-result pairs inserted. The assistant-stream `message_start` < `message_end` < `turn_end` invariant must remain true; the prompt pair is before `turn_start` so it doesn't interleave. Add assertions for the new pairs where the tests don't already cover them.
- [ ] 6.3 Run full agent suite → GREEN.
- [ ] 6.4 Gate + commit "test(agent): reflect message-lifecycle payload in assertions".

## 7. Verification

- [ ] 7.1 `bun vitest run packages/agent/` — all pass (expect existing + new lifecycle tests).
- [ ] 7.2 `cd packages/db && bun test` — unchanged (no DB change); confirm no regressions.
- [ ] 7.3 `bun vitest run apps/server/src/agent/__tests__/` — confirm events forward through WS unchanged (the `event` field in `{type:"event", event, sessionId}` carries the new payload automatically).
- [ ] 7.4 `cd apps/server && bun test src/__tests__` — no regressions.
- [ ] 7.5 `bun typecheck` — 0 errors.
- [ ] 7.6 `bun x ultracite check` — 0 remaining diagnostics.
- [ ] 7.7 Cross-check every scenario in `specs/agent-streaming/spec.md` against the implemented tests; each scenario SHALL have a covering test.
- [ ] 7.8 Independence check: confirm this change did NOT modify `streaming.ts`, `compaction.ts`, or the main spec other than `agent-streaming` — it must remain independent of Changes 1, 2, and 4 so archive order is free.
- [ ] 7.9 Confirm the `message` payload field is OPTIONAL in the type but ALWAYS set on new emissions — verify by code inspection that every `evt("message_start"/"message_end", ...)` call site passes a `message` field.
