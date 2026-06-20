Now I have a good understanding of both codebases. Let me dispatch parallel explore agents to compare different subsystems. The key comparison areas are:

1. **Agent loop core** — `agent-loop.ts` (pi) vs `packages/agent/src/loop/` (ours)
2. **Compaction** — `compaction/` (pi) vs `packages/agent/src/compaction.ts` (ours)
3. **Types/messages** — `types.ts`, `base.ts` (pi) vs `packages/agent/src/types.ts` (ours)
4. **Tools** — `core/tools/` (pi) vs `packages/tools/src/` (ours)
5. **Server/session layer** — `agent-session.ts`, `agent-session-runtime.ts` (pi) vs `apps/server/src/agent/` (ours)

I'll dispatch 5 parallel explore agents, each focused on one subsystem. They should compare the pi reference against our implementation and report divergences (behavioral differences, missing features, incorrect implementations).

Let me be very specific in my prompts so the agents return useful, actionable findings.

I'll dispatch parallel agents to compare each subsystem against pi. This is the most efficient way to cover the full surface area.

**Tool: task**

**Input:**
```json
{
  "description": "Compare agent-loop core",
  "subagent_type": "explore",
  "prompt": "Thoroughness: very thorough\n\nCompare pi's agent-loop implementation against ours to find ALL behavioral divergences.\n\n**Pi reference** (source of truth):\n- `openspec/references/pi/packages/agent/src/agent-loop.ts` — the main loop\n- `openspec/references/pi/packages/agent/src/agent.ts` — AgentLoop interface\n\n**Our implementation**:\n- `packages/agent/src/loop/index.ts` — main loop\n- `packages/agent/src/loop/streaming.ts` — LLM stream consumption\n- `packages/agent/src/loop/tool-execution.ts` — tool batch execution\n- `packages/agent/src/loop/events.ts` — event types\n\nWe recently fixed these (already done, skip them):\n- message_start/message_end payload on every persisted message\n- turn_end + agent_end on error/abort paths\n- tool-batch AND termination semantics (shouldTerminateToolBatch)\n- abort breaks the tool batch (signal check between tools)\n- parallel two-phase tool execution structure\n- message lifecycle around steer injection\n\nFocus on finding NEW divergences NOT yet addressed. For each divergence you find:\n1. **What pi does** (cite file:line)\n2. **What we do** (cite file:line)\n3. **Impact** (what breaks or degrades)\n4. **Severity** (P0 = correctness bug, P1 = behavioral drift, P2 = nice-to-have parity)\n\nAreas to examine carefully:\n- Turn counting and maxTurns handling (does pi have a turn limit? do we?)\n- The turn loop structure (while/break conditions)\n- How steer messages are drained (timing, ordering)\n- How followUp messages are injected (timing relative to turn boundaries)\n- Retry logic (backoff, retryable error detection, context overflow handling)\n- Error handling in the stream consumption (does pi catch and retry within streamSimple or in the loop?)\n- The `done` vs `error` event handling from streamSimple\n- System prompt construction and passing\n- How the model/context is passed to streamSimple\n- Token estimation logic (estimateContextTokens)\n- Any pi features we completely lack (e.g., branch summarization, skill injection, extension hooks)\n\nReturn a structured list of findings, sorted by severity."
}
```

**Output:**
```
<task id="ses_11b11fe7affe0kQTPPHIBQw3e3" state="completed">
<task_result>
I have completed a thorough analysis. Here are all the behavioral divergences I found, sorted by severity.

---

# Pi vs. Sakti Agent-Loop: Behavioral Divergences

## P0 — Correctness Bugs

### P0-1. Retry logic is dead in production; `maxRetries` never reaches `streamSimple`

**Pi** (`agent-loop.ts:298-308`, `types.ts:19-26`): The loop itself contains **no retry logic**. Pi delegates retry entirely to `streamSimple` via options. The `StreamFn` contract (types.ts:18-23) explicitly states: *"Must not throw or return a rejected promise for request/model/runtime failures. Failures must be encoded in the returned stream via protocol events."* The `AgentHarness` wires this up at `agent-harness.ts:385-405`, passing `maxRetries`, `maxRetryDelayMs`, `timeoutMs` into `streamSimple`.

**Ours** (`streaming.ts:197-251`, `streaming.ts:202-221`): We wrap `streamSimple` in our own retry loop (`for attempt … catch(err) { if(isRetryable(err))…}`) but:
1. We call `streamSimple(model, ctx, { signal, reasoning })` — **`maxRetries`/`maxRetryDelayMs` are never forwarded**, so `streamSimple` uses its own default.
2. Per pi-ai's contract, retryable HTTP errors (429/5xx) come through as **stream `error` events**, not thrown exceptions. Our `consumeStream` handles `error` at `streaming.ts:167-175` by returning `{status:"error"}` → `streamLLMResponse` returns `{ok:false}` **immediately, no retry** (`streaming.ts:223-226`).
3. The `catch` block's `isRetryable(err)` path (`streaming.ts:236-245`) is only reachable if `streamSimple` itself throws — which its contract says it won't for retryable failures.

**Impact**: The `maxRetries` config (advertised to users via the server's `max_retries` setting at `runner.ts:125`) does not control LLM streaming retries at all. The `retry` event (`types.ts:186-191`) is essentially never emitted in production. The retry-abort tests pass only because the mock `streamSimple` throws (`retry-abort.test.ts:102-108`), which does not match real provider behavior.

**Severity**: P0 — a user-facing feature (retry) is silently non-functional against real providers.

---

### P0-2. No system prompt is ever sent to the LLM

**Pi** (`agent-loop.ts:291-296`, `agent.ts:319`, `agent-harness.ts:339-351`): Builds a `Context` with `systemPrompt: context.systemPrompt` and forwards it to `streamSimple`. The harness resolves the system prompt per-turn (string or async function of env/session/model/tools).

**Ours** (`streaming.ts:202-211`, `types.ts:250-266`, `runner.ts:120-132`): `AgentConfig`/`AgentConfigInput` has **no `systemPrompt` field at all**. `streamLLMResponse` builds the LLM context as `{ messages, tools }` — no `systemPrompt`. The server runner never passes one. The only `systemPrompt` reference in the package is the compaction summarizer's own prompt (`compaction.ts:239`).

**Impact**: The agent operates with zero persona/instructions — every request goes to the provider with no system prompt. A coding agent needs tool-use instructions, safety guidance, output-format rules, etc. This is a fundamental capability gap.

**Severity**: P0 — the agent cannot function as a coding assistant without instructions (no tool-use steering, no safety rules, no format conventions).

---

## P1 — Behavioral Drift

### P1-1. `followUp` "one-at-a-time" drains only one message total, not one-per-turn

**Pi** (`agent.ts:134-147`): `PendingMessageQueue.drain()` under `"one-at-a-time"` returns one message **but keeps the rest queued**. `getFollowUpMessages` is called each time the inner loop exits, so N queued follow-ups → N separate turns, one per exit point.

**Ours** (`loop/index.ts:92`, `loop/index.ts:213-223`, `loop/index.ts:260-267`): A `followUpDone` flag is set to `true` after the first follow-up is processed under `"one-at-a-time"` (`loop/index.ts:219`, `loop/index.ts:265`). Every subsequent check is gated by `if (followUpMsg && !followUpDone)`, so **all remaining follow-ups are silently dropped** for the rest of the run.

**Impact**: Under `"one-at-a-time"` mode, queued follow-ups beyond the first are lost. (Blast radius is limited because the server defaults `follow_up_mode` to `"all"` at `runner.ts:61`, but the bug is real if a user selects one-at-a-time.)

**Severity**: P1 — silent message loss in a documented mode.

---

### P1-2. `turn_start` emitted after prompt/steer messages instead of before

**Pi** (`agent-loop.ts:109-114`, `agent-loop.ts:175-190`): Emits `agent_start` → `turn_start` → prompt `message_start`/`message_end` → (steer `message_start`/`message_end`) → assistant stream. `turn_start` brackets the **entire** turn including the user messages that triggered it. The `firstTurn` flag (`agent-loop.ts:165,175-179`) ensures the first `turn_start` (from `runAgentLoop`) is not duplicated.

**Ours** (`loop/index.ts:94-141`): Emits `agent_start` → prompt `message_start`/`message_end` → `drainSteers` (steer messages) → compaction → **then** `turn_start` (`loop/index.ts:141`) → assistant stream.

**Impact**: A consumer bracketing a turn with `turn_start..turn_end` (for cost accounting, UI grouping, or timeline rendering) will, in our impl, exclude the triggering user/steer messages from the turn. Two distinct ordering drifts: (a) first turn — prompt message precedes `turn_start`; (b) steer-driven turns — steer messages precede `turn_start`.

**Severity**: P1 — event-ordering drift breaks turn-bracket consumers.

---

### P1-3. `message_update` drops the evolving message snapshot; stream event types `text_start`/`text_end`/`thinking_start`/`thinking_end` are silently ignored

**Pi** (`agent-loop.ts:322-340`): Every `text_*`/`thinking_*`/`toolcall_*` event updates `context.messages[last] = event.partial` and emits `{ type:"message_update", assistantMessageEvent: event, message: {...partial} }` — carrying both the **raw event** and the **full evolving message snapshot**. Pi handles all of: `text_start`, `text_delta`, `text_end`, `thinking_start`, `thinking_delta`, `thinking_end`, `toolcall_start`, `toolcall_delta`, `toolcall_end`.

**Ours** (`streaming.ts:115-176`, `types.ts:144-154`): The `consumeStream` switch only handles `text_delta`, `thinking_delta`, `toolcall_start`, `toolcall_delta`, `toolcall_end`. There are **no cases** for `text_start`, `text_end`, `thinking_start`, `thinking_end` — they fall through the switch and are dropped. The emitted `message_update` event (`types.ts:151-154`) carries only `{ update }` (a delta fragment), **no `message` snapshot and no `assistantMessageEvent`**. The `MessageUpdate` union (`types.ts:144-149`) doesn't even define the `_start`/`_end` variants, so the type system hides the gap.

**Impact**: UIs cannot render a complete evolving assistant message from our events — they must reconstruct from deltas only, and the reconstruction is lossy (missing block start/end boundaries needed for markdown/thinking-block rendering). The `streamingMessage` snapshot pi maintains for subscribers (`agent.ts:516`) has no equivalent here.

**Severity**: P1 — UX-significant streaming fidelity loss.

---

### P1-4. Tool progress updates are batched into one post-completion event instead of streamed live

**Pi** (`agent-loop.ts:628-668`): `executePreparedToolCall` passes an `onUpdate` callback that receives a structured `AgentToolResult` (`types.ts:363`). Each callback pushes a `tool_execution_update` event with `partialResult` and `args` (`agent-loop.ts:643-653`) **during** execution. Late callbacks after settlement are ignored via `acceptingUpdates`.

**Ours** (`tool-execution.ts:37-46`, `types.ts:161-166`, `types.ts:89-94`): `executeOneTool` passes `onUpdate: (partial: string) => { accumulated += partial }` — accumulates all partials into a string, then emits **one** `tool_execution_update` event with `{ accumulated }` **after** `tool.execute` resolves (`tool-execution.ts:40-46`). The callback type is `string`, not `AgentToolResult`.

**Impact**: Live tool progress (e.g., watching a bash command stream output, a long search accumulate results) is impossible — the UI only gets the final blob after the tool finishes. This defeats the purpose of streaming tool updates.

**Severity**: P1 — core UX feature (live tool progress) non-functional.

---

### P1-5. `beforeToolCall` / `afterToolCall` hooks are missing

**Pi** (`agent-loop.ts:581-605`, `agent-loop.ts:682-714`, `types.ts:262-276`): `beforeToolCall` runs after arg validation, can `{block:true, reason}` to prevent execution (loop emits an error tool result instead). `afterToolCall` runs after execution and can override `content`/`details`/`isError`/`terminate` field-by-field. Both receive the agent abort signal.

**Ours** (`tool-execution.ts:26-88`): No such hooks exist. `executeOneTool` goes straight from lookup → execute → result. There is no interception point.

**Impact**: No extension point for permission/approval flows (e.g., "ask user before running bash"), result redaction, audit logging, or termination override. The `AgentHarness` builds its entire permission/tool-policy system on these hooks (`agent-harness.ts:434-456`).

**Severity**: P1 — blocks permission UIs and tool-policy extensions.

---

### P1-6. `prepareNextTurn` / `shouldStopAfterTurn` / `transformContext` hooks are missing

**Pi** (`agent-loop.ts:220-251`, `agent-loop.ts:283-289`, `types.ts:186-218`):
- `prepareNextTurn` (called after every `turn_end`, `agent-loop.ts:226`): can swap `context`/`model`/`thinkingLevel` for the next turn — this is how the harness refreshes context from the session tree between turns (`agent-harness.ts:457-466`).
- `shouldStopAfterTurn` (`agent-loop.ts:241-251`): can request graceful stop after the current turn, before polling queues.
- `transformContext` (`agent-loop.ts:284-286`): transforms `AgentMessage[]` before `convertToLlm` each turn — the extension point for in-loop context pruning/injection.

**Ours** (`loop/index.ts`): None of these exist. The loop has no turn-boundary extension points; context/model are fixed for the whole run.

**Impact**: No way to swap models mid-run, refresh context from an external source between turns, request graceful stop before context fills, or prune/inject context in-loop. This is the primary extensibility surface pi provides, and it's entirely absent.

**Severity**: P1 — removes the entire turn-boundary extension surface.

---

### P1-7. API key resolved once at config time, not per-call

**Pi** (`agent-loop.ts:300-308`, `types.ts:194-196`): Resolves the key fresh on **every** LLM call via `config.getApiKey(provider)`, falling back to `config.apiKey`. Documented purpose: *"Useful for short-lived OAuth tokens (e.g., GitHub Copilot) that may expire during long-running tool execution phases."*

**Ours** (`loop/index.ts:21-25`, `streaming.ts:202-221`, `runner.ts:101`): `apiKey` is resolved once (`resolved.apiKey`) and never refreshed. `streamSimple` is called with no `apiKey` option at all (we rely on pi-ai env resolution), so even our single resolution isn't forwarded.

**Impact**: Long-running sessions using short-lived tokens (Copilot OAuth, etc.) will fail mid-run when the token expires during tool execution, with no recovery.

**Severity**: P1 — breaks for token-expiring providers.

---

### P1-8. `agent_end` does not carry the run's messages

**Pi** (`agent-loop.ts:198`, `agent-loop.ts:249`, `agent-loop.ts:268`, `types.ts:411`): `agent_end` payload is `{ type:"agent_end", messages: AgentMessage[] }` — the complete list of new messages produced by this run.

**Ours** (`loop/index.ts:171`, `loop/index.ts:180`, `loop/index.ts:271`, `types.ts:121-124`): `agent_end` payload is `{ type:"agent_end", sessionId }` — no messages.

**Impact**: Event-only consumers (e.g., a WebSocket client) cannot obtain the run's output from the terminal event; they must reconstruct by accumulating every `message_end`. The `EventStream` terminator in pi (`agent-loop.ts:147-149`) resolves the stream's final value to these messages — our `AsyncGenerator`'s return value is `void`.

**Severity**: P1 — consumers lose the run result at the API boundary.

---

### P1-9. Tool result `content` is `string`, not `(TextContent|ImageContent)[]`; no `details`; `onUpdate` receives `string`

**Pi** (`types.ts:345-363`): `AgentToolResult<T>` has `content: (TextContent|ImageContent)[]`, `details: T` (arbitrary structured data for logs/UI), and `terminate?`. The update callback receives `AgentToolResult<T>`.

**Ours** (`types.ts:81-85`, `types.ts:89-94`): `AgentToolResult` has `content: string`, `terminate: boolean`, `isError?`. No `details`. The update callback (`types.ts:93`) receives `(partial: string) => void`.

**Impact**: Tools cannot return images, structured content blocks, or side-channel details for UI rendering. Any tool wanting to return an image (e.g., screenshot, plot) or structured data (e.g., diff metadata, file lists) has no path. This also forces `toPiMessages` (`streaming.ts:16-45`) to wrap tool content as `[{type:"text", text: ...}]` — lossy.

**Severity**: P1 — caps tool expressiveness at "string in, string out".

---

### P1-10. No `validateToolArguments` — tool args are passed through unschema-validated

**Pi** (`agent-loop.ts:580`, imports `validateToolArguments` from pi-ai/base): Before execution, args are validated against the tool's schema; invalid args produce an immediate error tool result (`agent-loop.ts:619-625` catch path also covers validation throws).

**Ours** (`tool-execution.ts:26-88`, grep confirms zero `validateToolArguments` references): `tc.arguments` is passed straight to `tool.execute` with no schema check.

**Impact**: Malformed tool-call arguments (LLM hallucinated bad JSON, wrong types) reach `tool.execute` and produce confusing runtime errors instead of a clean "invalid arguments" tool result that the LLM can self-correct from.

**Severity**: P1 — degrades error recovery for malformed LLM tool calls.

---

### P1-11. `steer()` aborts running tools; pi tools always run to completion

**Pi** (`agent.ts:264-266`, `agent-harness.ts:679-683`): `steer()` only enqueues. It never aborts anything. Steering messages are drained only at turn boundaries (`agent-loop.ts:182-190`, `agent-loop.ts:253`). Tools always finish.

**Ours** (`loop/index.ts:229-230`, `loop/index.ts:276-282`): `steer()` enqueues **and** calls `steerAbort.abort()`, which feeds into `combineSignals(signal, steerAbort.signal)` passed to tool execution. A steer arriving mid-execution aborts the running tool(s).

**Impact**: A steer in our system can leave partial/interrupted tool work (half-written files, killed bash commands) that pi would never produce. This may be a deliberate design choice (our comments describe it as intentional), but it is a behavioral divergence from pi's "tools always complete" contract and changes the safety characteristics of steering.

**Severity**: P1 — behavioral drift with safety implications (partial tool side-effects).

---

### P1-12. `followUp` is checked after tool execution (mid-loop), but pi only checks after a no-tool-call turn

**Pi** (`agent-loop.ts:170-266`): Follow-ups are polled **only** at the outer loop (`agent-loop.ts:257`), which is reached solely when the inner loop exits — i.e., when `hasMoreToolCalls === false` AND no pending steers. While tools are running, follow-ups are never injected.

**Ours** (`loop/index.ts:259-268`): After tool execution (inside the tool-call branch), if no steers arrived, we **check and inject a follow-up**. This inserts a user message between tool results and the next assistant stream.

**Impact**: A follow-up queued during tool execution gets injected before the LLM has even responded to the tool results — interleaving a user message into the middle of an agentic tool→assistant cycle. Pi would let the assistant respond to the tool results first, then deliver the follow-up.

**Severity**: P1 — message-ordering divergence that can confuse the LLM mid-task.

---

## P2 — Nice-to-Have Parity / Feature Gaps

### P2-1. `tool_execution_end` missing `isError`; `tool_execution_start` missing `args`
**Pi** (`types.ts:421-423`): `tool_execution_start` carries `args`; `tool_execution_end` carries `result` **and** `isError`.
**Ours** (`types.ts:156-172`): Neither field present. UIs can't see call arguments or error status on these events.

### P2-2. `convertToLlm` is hardcoded; no custom-message filtering
**Pi** (`types.ts:138-164`, `agent.ts:203`, `agent-loop.ts:288-289`): `convertToLlm` is a configurable hook (default filters to user/assistant/toolResult); apps extend via declaration merging (`types.ts:300-309`).
**Ours** (`streaming.ts:16-45`): `toPiMessages` is a fixed function with no hook. No custom message types are possible.

### P2-3. `sessionId` not forwarded to `streamSimple` (prompt-cache efficiency)
**Pi** (`agent-harness.ts:401`): Forwards `sessionId: turnState.sessionId` to `streamSimple` for cache-aware backends.
**Ours** (`streaming.ts:202-221`): Not forwarded (we pass it to `streamLLMResponse` but it's unused there).

### P2-4. `onPayload`/`onResponse`/`transport`/`thinkingBudgets`/`headers`/`metadata`/`timeoutMs`/`cacheRetention` not forwarded
**Pi** (`agent-harness.ts:385-405`, `types.ts:135`): All forwarded to `streamSimple` via `SimpleStreamOptions`. Enables payload inspection, transport selection, per-level thinking budgets, request timeouts, cache control.
**Ours** (`streaming.ts:202-221`): Only `signal` and `reasoning` are forwarded.

### P2-5. Compaction: no file-op tracking, no iterative summary updates, no split-turn, no branch summarization, runs in-loop
**Pi** (`harness/compaction/compaction.ts:42-65`, `compaction.ts:457-712`, `harness/compaction/branch-summarization.ts`): Tracks read/modified files across compactions; supports iterative summary updates (passes `previousSummary`); handles "split turn" by summarizing the turn prefix separately; has branch summarization for session forking. Compaction is out-of-band (`agent-harness.ts:708-762`), not in the loop.
**Ours** (`compaction.ts:190-269`, `loop/index.ts:110-139`): Flat-array single-summary compaction with none of the above, runs inline in the loop. Also `shouldCompact` uses `>=` (`compaction.ts:6`) vs pi's `>` (`compaction.ts:204`).

### P2-6. `estimateContextTokens` returns a single number, not the structured estimate
**Pi** (`harness/compaction/compaction.ts:151-199`): Returns `ContextUsageEstimate { tokens, usageTokens, trailingTokens, lastUsageIndex }`.
**Ours** (`compaction.ts:57-76`): Returns a bare `number`. Loses diagnostic granularity.

### P2-7. Per-tool `executionMode` override, `prepareArguments`, and `label` missing
**Pi** (`agent-loop.ts:381-388`, `types.ts:366-389`): If any tool in a batch has `executionMode:"sequential"`, the whole batch runs sequential. `prepareArguments` shim normalizes raw args pre-validation. `label` for UI display.
**Ours**: None of these exist (`AgentTool` at `types.ts:87-97` has only name/description/execute/parameters).

### P2-8. Major pi features entirely absent
Skills (`harness/skills.ts`), prompt templates (`harness/prompt-templates.ts`), session tree with forking/navigation (`agent-harness.ts:764-862`), custom message types (`types.ts:300-309`), `nextTurn` queue (`agent-harness.ts:691-694`, distinct from followUp), mid-session model/thinking/tools changes (`agent-harness.ts:864-963`), the harness hook system (`before_provider_request`, `before_provider_payload`, `after_provider_response`, `context`, `tool_call`, `tool_result`, `before_agent_start`, `save_point`, `settled`, etc.), and the phase state machine (`idle`/`turn`/`compaction`/`branch_summary`).

### P2-9. Retry backoff is uncapped
**Pi** (via `streamSimple`'s `maxRetryDelayMs` option, `agent-harness.ts:389`): Exponential backoff capped at `maxRetryDelayMs`.
**Ours** (`streaming.ts:237`): `baseDelay * 2 ** attempt` — uncapped. (Moot given P0-1, but noted for if/when retry is fixed.)

### P2-10. Default queue modes differ
**Pi** (`agent.ts:212-213`): Defaults both `steeringMode` and `followUpMode` to `"one-at-a-time"`.
**Ours** (`runner.ts:58-65`): Server defaults both to `"all"`.

### P2-11. `response.result()` not used for the final message; uses `event.message`/`event.error`
**Pi** (`agent-loop.ts:344`, `agent-loop.ts:359`): On `done`/`error` (and after loop exit), calls `response.result()` for the authoritative final message.
**Ours** (`streaming.ts:163-169`, `streaming.ts:179`): Uses `event.message`/`event.error` from the stream event, or the stale `start` partial. If a stream ends without an explicit `done`, our `finalAssistant` is the `start` partial, not the accumulated result.

### P2-12. Partial assistant message not pushed to the messages array during streaming
**Pi** (`agent-loop.ts:316-319`, `agent-loop.ts:331-333`): Pushes the partial to `context.messages` on `start`, replaces it on every delta — so in-memory context always reflects the live stream.
**Ours** (`loop/index.ts:195`): The assistant message is pushed to `messages` only after the stream completes. A mid-stream crash loses the partial. (Consistent with our persistence model, but diverges from pi's in-memory contract.)

---

## Summary by area

| Area | Finding IDs | Worst severity |
|---|---|---|
| Retry / error handling | P0-1, P2-9, P2-11 | **P0** |
| System prompt | P0-2 | **P0** |
| Turn loop structure / turn_start | P1-2, P1-6, P1-12 | P1 |
| Steer / followUp draining | P1-1, P1-11, P1-12, P2-10 | P1 |
| Streaming event fidelity | P1-3, P1-4, P2-12 | P1 |
| Tool execution / hooks | P1-5, P1-9, P1-10, P2-1, P2-7 | P1 |
| Auth / provider options | P1-7, P2-3, P2-4 | P1 |
| Event payloads | P1-8, P1-3 | P1 |
| Compaction | P2-5, P2-6 | P2 |
| Missing features | P2-2, P2-8 | P2 |

The two P0s (dead retry + missing system prompt) are the highest-leverage fixes. The P1s around streaming fidelity (P1-3, P1-4), the missing hooks (P1-5, P1-6), and the `agent_end` messages payload (P1-8) are the most impactful for parity and UX.
</task_result>
</task>
```

**Tool: task**

**Input:**
```json
{
  "description": "Compare compaction logic",
  "subagent_type": "explore",
  "prompt": "Thoroughness: very thorough\n\nCompare pi's compaction implementation against ours to find ALL behavioral divergences.\n\n**Pi reference** (source of truth):\n- `openspec/references/pi/packages/coding-agent/src/core/compaction/compaction.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/compaction/utils.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/compaction/index.ts`\n- `openspec/references/pi/packages/agent/src/harness/compaction/compaction.ts` (older version)\n\n**Our implementation**:\n- `packages/agent/src/compaction.ts`\n\nWe recently fixed these (already done, skip them):\n- Cut-point never orphans a tool result (snap-forward past tool messages)\n- No valid cut point keeps everything (cutIndex >= messages.length guard)\n- messageToText serializer mirrors pi's serializeConversation (thinking, tool calls, truncation)\n- .filter(Boolean) before join\n- estimateContextTokens skips errored/aborted turns\n\nFocus on finding NEW divergences. For each:\n1. **What pi does** (cite file:line)\n2. **What we do** (cite file:line)\n3. **Impact**\n4. **Severity** (P0/P1/P2)\n\nAreas to examine:\n- Token budget calculation (how pi walks back to find the cut index)\n- The summary prompt template (system prompt for the summarization LLM)\n- How the compacted summary message is structured (role, content format)\n- Whether pi preserves any messages verbatim (system prompt? first user message?)\n- Branch summarization (pi has this — do we need it?)\n- How compactMessages handles the return value (summary text structure)\n- Token counting differences (does pi count differently?)\n- The keep-recent and reserve token defaults\n- Any compaction triggers we're missing (manual vs auto thresholds)\n\nReturn a structured list of findings, sorted by severity."
}
```

**Output:**
```
<task id="ses_11b11fe4cffeUWYkrRkBwh2q5f" state="completed">
<task_result>
I have everything needed. Here is the structured comparison.

---

# Pi vs. Sakti compaction — behavioral divergences

Conventions: **Pi** = `openspec/references/pi/.../compaction.ts` (newer coding-agent version; the older `packages/agent/.../compaction.ts` is identical in logic). **Ours** = `packages/agent/src/compaction.ts` unless noted.

The already-fixed items (cut-point orphaning, `cutIndex >= messages.length`, serializer fidelity, `.filter(Boolean)`, errored-turn skipping) are confirmed aligned and excluded.

---

## P1 — Meaningful quality / correctness gaps

### P1-1. Summary template drops "Constraints & Preferences" and "Blocked" sections

- **Pi does** (`compaction.ts:455-486`): the `SUMMARIZATION_PROMPT` mandates six sections, including:
  - `## Constraints & Preferences` (`:463-465`) — "Any constraints, preferences, or requirements mentioned by user"
  - `### Blocked` under Progress (`:473-474`) — "Issues preventing progress, if any"
  - Goal is also richer: "Can be multiple items if the session covers different tasks." (`:460`)
- **We do** (`compaction.ts:81-102`): our `SUMMARIZE_PROMPT` has only Goal / Progress(Done, In Progress) / Key Decisions / Next Steps / Critical Context. No constraints, no blockers.
- **Impact**: User-stated constraints (e.g. "use SolidJS not React", "don't touch X", "keep it under N lines") and known blockers are not explicitly preserved across compaction. They may survive incidentally inside the prose, but the model gets no structural instruction to carry them forward — so they drift in long sessions, exactly the regime where compaction fires.
- **Severity**: **P1** (constraint drift in a coding agent is high-cost).

### P1-2. No iterative update path — every compaction re-summarizes from scratch

- **Pi does**:
  - Maintains a separate `UPDATE_SUMMARIZATION_PROMPT` (`compaction.ts:488-525`) used whenever a previous compaction exists.
  - `prepareCompaction` extracts `previousSummary` from the prior compaction entry (`compaction.ts:663-670`).
  - `generateSummary` selects the update vs. initial prompt and injects `<previous-summary>\n${previousSummary}\n</previous-summary>` (`compaction.ts:579, 591-594`).
  - The update prompt instructs: "PRESERVE all existing information", "ADD new", "UPDATE Progress", and to remove only things no longer relevant.
- **We do**: no update prompt, no `previousSummary` parameter, no detection of prior summaries. `compactMessages` always uses the same initial `SUMMARIZE_PROMPT`.
- **Impact**: On the 2nd, 3rd, … compaction we re-summarize already-summarized history from scratch with a "create a summary" prompt rather than a "merge into the existing summary" prompt. Information that the LLM previously captured is liable to be dropped or rewritten each cycle — fidelity decays with every compaction. Pi's design is explicitly iterative to prevent this.
- **Severity**: **P1**.

### P1-3. Summary message has the wrong role + framing, and gets re-fed as a user message on the next compaction

- **Pi does**:
  - Stores the summary as a distinct `compactionSummary`-role message (`messages.ts:109-120`, `createCompactionSummaryMessage`).
  - When building LLM context, `convertToLlm` maps it to a **user** message wrapped as `COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX` (`messages.ts:176-183`), i.e. `"The conversation history before this point was compacted into the following summary:\n\n<summary>\n" … "\n</summary>"` (`messages.ts:11-17`).
  - Critically, `getMessageFromEntryForCompaction` returns `undefined` for `compaction` entries (`compaction.ts:95-100`) — the prior summary is **excluded** from the conversation text that gets re-summarized; it flows only through the dedicated `<previous-summary>` channel (see P1-2).
- **We do** (`compaction.ts:260-264`): emit a plain `user` message:
  ```ts
  { role: "user", content: `[Session Summary]\n\n${summaryText}`, timestamp: Date.now() }
  ```
- **Impact** (three separate harms):
  1. No closing marker / XML tag, and the prefix does not explain what the block is. Pi's framing signals "this is compacted context, do not treat as a request"; ours looks like a user turn.
  2. The LLM may interpret `[Session Summary]…` as a user instruction to act on.
  3. On the next compaction this user message is serialized by `messageToText` as `[User]: [Session Summary]…` and folded into the conversation the summarizer reads — so our prior summary is re-summarized as if it were ordinary dialogue. This compounds P1-2: not only is there no UPDATE prompt, the old summary actively pollutes the input as a fake user turn.
- **Note**: Our `AgentMessage` union has no `compactionSummary` role (`types.ts:49`), so fixing this properly requires either a new role or a sentinel marker the cut logic can recognise and exclude.
- **Severity**: **P1**.

### P1-4. No file-operation tracking (read / modified file lists appended to summary)

- **Pi does**:
  - `extractFileOperations` walks tool calls in the to-be-summarized history AND merges `readFiles`/`modifiedFiles` from the previous compaction's `details`, so the list is **cumulative across compactions** (`compaction.ts:41-69`, `:706-714`).
  - `extractFileOpsFromMessage` records `read`/`write`/`edit` tool calls (`utils.ts:29-56`).
  - After the LLM summary is produced, `compact()` appends `formatFileOperations(readFiles, modifiedFiles)` (`compaction.ts:828-830`), emitting `<read-files>…</read-files>` and `<modified-files>…</modified-files>` XML blocks (`utils.ts:62-82`) inside the summary.
- **We do**: nothing — our summary is only the LLM text. No file tracking, no `<read-files>`/`<modified-files>` blocks.
- **Impact**: After every compaction the agent loses the authoritative record of which files it has already read and which it has modified in the compacted past. Concretely: redundant `read` calls on files already seen, and failure to remember that a file was edited (risking conflicting re-edits). For a coding agent whose entire job is file manipulation, this is a significant capability regression vs. pi.
- **Severity**: **P1** (arguably P0 for the coding-agent use case).

### P1-5. Summarization system prompt is weakened

- **Pi does** (`utils.ts:168-170`):
  > "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified. **Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.**"
- **We do** (`compaction.ts:78-79`):
  > "You are a context summarization assistant. Produce a structured summary. Do NOT continue the conversation."
- **Impact**: We drop "Do NOT respond to any questions in the conversation" and "ONLY output the structured summary." If the compacted history contains a question (e.g. a user asking "should we use X?"), our summarizer is more likely to answer it or add free-form commentary instead of producing only the checkpoint. Lower-fidelity / noisier summaries.
- **Severity**: **P1** (cheap to fix, real effect on summary discipline).

---

## P2 — Smaller divergences / feature gaps

### P2-1. No split-turn (turn-prefix) summarization

- **Pi does**: `findCutPoint` returns `isSplitTurn`/`turnStartIndex` (`compaction.ts:439-448`); when the cut lands mid-turn, `compact()` runs `generateTurnPrefixSummary` in parallel with the history summary using `TURN_PREFIX_SUMMARIZATION_PROMPT` (`compaction.ts:732-745, 779-810, 847-887`) and merges: `summary = history + "\n\n---\n\n**Turn Context (split turn):**\n\n" + turnPrefix`. This preserves the originating request for the in-flight turn.
- **We do** (`compaction.ts:204-221`): purely token-based cut; no turn awareness, no prefix summary.
- **Impact**: When one turn is so large it straddles the cut, the kept recent messages can begin mid-turn (e.g. an assistant reply or tool results) without any explicit link back to the user request that's now in the summary. The model loses the immediate "what am I doing" framing for in-flight work. Only affects very long single turns.
- **Severity**: **P2**.

### P2-2. `maxTokens` for summary not capped by `model.maxTokens`

- **Pi does** (`compaction.ts:573-576`): `maxTokens = min(floor(0.8 * reserveTokens), model.maxTokens > 0 ? model.maxTokens : Infinity)` (same pattern at `:858-861` for turn prefix).
- **We do** (`compaction.ts:245`): `maxTokens: Math.floor(reserveTokens * 0.8)` — no `model.maxTokens` cap.
- **Impact**: If `reserveTokens` (default 16000) exceeds the model's output limit (some models cap at 4096/8192), we will request more tokens than the provider allows → either an API error or silent truncation of the summary. Pi clamps to the model's limit.
- **Severity**: **P2**.

### P2-3. `tokensBefore` reported via `estimateTokens` (char/4) instead of `estimateContextTokens`

- **Pi does** (`compaction.ts:673`): `tokensBefore = estimateContextTokens(...).tokens` — uses provider-reported `usage.totalTokens` when available.
- **We do** (`compaction.ts:202`): `tokensBefore = estimateTokens(messages)` — pure char/4. (We *have* `estimateContextTokens` at `:57-76` and even use it for the trigger in `loop/index.ts:111`, but not for the reported `tokensBefore`.)
- **Impact**: The `tokensBefore` we return to the UI / persist for stats is a crude estimate, not the real provider token count, even though the real number is what drove the compaction decision. `tokensAfter` (`:267`) has the same issue.
- **Severity**: **P2** (reporting inaccuracy; does not affect trigger correctness).

### P2-4. No `thinkingLevel` / reasoning passed to the summarization call

- **Pi does** (`compaction.ts:527-541`): `createSummarizationOptions` adds `options.reasoning = thinkingLevel` when `model.reasoning && thinkingLevel && thinkingLevel !== "off"`. Applied to both `generateSummary` and `generateTurnPrefixSummary`.
- **We do** (`compaction.ts:244-248`): options carry only `maxTokens`, `apiKey`, `signal`. No reasoning.
- **Impact**: On reasoning models, summarization cannot use extended thinking, likely lower-quality summaries. Minor.
- **Severity**: **P2**.

### P2-5. No `customInstructions` parameter

- **Pi does** (`compaction.ts:560, 580-582`): accepts `customInstructions`, appends `\n\nAdditional focus: ${customInstructions}` to the prompt — lets callers steer the summary (e.g. "focus on API decisions").
- **We do**: no such parameter; callers cannot steer summarization.
- **Impact**: feature gap; the manual compaction route and the loop can't inject focus.
- **Severity**: **P2**.

### P2-6. No `streamFn` / `headers` / `env` on the summarization call

- **Pi does** (`compaction.ts:527-554, 604-611`): supports `streamFn` (run summarization through the session's stream fn to preserve SDK request behavior — timeouts, retries, attribution headers), plus `headers` and provider-scoped `env`.
- **We do** (`compaction.ts:236-249`): direct `completeSimple` with only `apiKey`. No headers, no env, no stream fn.
- **Impact**: Loses request-consistency (timeouts/retries) and attribution/telemetry headers on the summarization call.
- **Severity**: **P2**.

### P2-7. Manual route ignores session/project config + has no abort

- **Pi does**: manual and auto compaction share `prepareCompaction` + `compact`, both honor session settings; the SDK path passes a signal.
- **We do** (`apps/server/src/routes/compaction.ts:36-42`): hardcodes `keepRecentTokens: 20_000`, omits `reserveTokens` (so it falls back to the 16_000 default), and passes no `signal`. The auto path (`loop/index.ts:120-128`) in contrast uses `resolved.keepRecentTokens`/`resolved.reserveTokens` from config.
- **Impact**: Manual and auto compaction use different budgets when the project config deviates from defaults; manual compaction can't be cancelled by the client.
- **Severity**: **P2**.

### P2-8. `shouldCompact` uses `>=` vs pi's `>`

- **Pi does** (`compaction.ts:222`): `contextTokens > contextWindow - reserveTokens`.
- **We do** (`compaction.ts:6`): `tokens >= contextWindow - reserveTokens`.
- **Impact**: Off-by-one at the exact boundary. Negligible in practice (token counts are estimates) but it's a divergence.
- **Severity**: **P2** (trivial).

### P2-9. `estimateTokens` undercounts assistant tool-call tokens (tool name omitted)

- **Pi does** (`compaction.ts:268-269`): for a `toolCall` block, counts `block.name.length + JSON.stringify(block.arguments).length`.
- **We do** (`compaction.ts:9-33`): `contentTokenEstimate` only counts `b.arguments` (via the `b.arguments` branch); the tool `name` is never added.
- **Impact**: Underestimates recent-window token usage by the sum of tool-name lengths during the cut-point walk, so we keep marginally more history than intended. Small in absolute terms.
- **Note on images**: pi also counts image blocks at 4800 chars each (`compaction.ts:229-245`); we don't, but our `UserMessage.content` is typed `string` (`types.ts:19-23`), so we cannot represent image content today — that part is moot, not a live divergence.
- **Severity**: **P2**.

---

## Informational / by-design (not bugs, noted for completeness)

- **Branch summarization** (`branch-summarization.ts`): pi summarises abandoned branches during tree navigation. Our session model is linear (`SessionStore.loadMessages/replaceMessages`, `types.ts:244-248`) — there are no branches, so this is intentionally absent. **Not applicable.**
- **"No valid cut point" / cut-point fallback, snap-forward past tool results**: aligned (your earlier fix). Pi also walks back before `cutIndex` to pull in preceding non-message session entries (`compaction.ts:424-437`) — we have no such non-message entry types, so this loop is correctly omitted.
- **Error/abort handling diverges by design**: pi throws on `stopReason === "error"` (`compaction.ts:613-615`); we degrade gracefully and return the original messages (`compaction.ts:251-253`), which matches the `AGENTS.md` compaction-route spec. Intentional — keep as is.
- **System prompt / first user message preservation**: Neither pi nor us preserves the first user message verbatim — it enters the summarized history. The system prompt is implicitly preserved in both because it lives outside the message array (pi: passed via `context.systemPrompt`; us: passed to `streamLLMResponse` separately). **Aligned**, not a divergence.
- **`enabled` flag**: pi folds `settings.enabled` into `shouldCompact` (`compaction.ts:221`); we gate at the loop level with `resolved.autoCompaction && resolved.apiKey` (`loop/index.ts:110`). Functionally equivalent for auto-compaction; manual compaction bypasses the gate in both. **Aligned.**

---

## Recommended fix priority

1. **P1-3 + P1-2 together** (root cause): introduce a recognisable compaction-summary representation (new role or sentinel) so the cut logic can exclude it from re-summarization, and add the `UPDATE_SUMMARIZATION_PROMPT` + `previousSummary` channel. These two are the same architectural fix.
2. **P1-4** file-operation tracking — high value for a coding agent, self-contained to add.
3. **P1-1 + P1-5** prompt template/system-prompt text alignment — trivial edits, immediate quality win.
4. P2-2 (`maxTokens` clamp) and P2-7 (route config) — small, low-risk fixes worth doing now.
5. P2-1 split-turn, P2-3 tokensBefore, P2-4 reasoning, P2-5 customInstructions, P2-6 streamFn — defer or batch.
</task_result>
</task>
```

**Tool: task**

**Input:**
```json
{
  "description": "Compare types and messages",
  "subagent_type": "explore",
  "prompt": "Thoroughness: very thorough\n\nCompare pi's type definitions and message models against ours to find structural divergences.\n\n**Pi reference** (source of truth):\n- `openspec/references/pi/packages/agent/src/types.ts` — core agent types\n- `openspec/references/pi/packages/agent/src/base.ts` — base message types\n- `openspec/references/pi/packages/coding-agent/src/core/messages.ts` — coding-agent message extensions\n\n**Our implementation**:\n- `packages/agent/src/types.ts` — all types\n- `packages/agent/src/loop/events.ts` — event types\n\nFor each divergence:\n1. **What pi's type looks like** (cite file:line)\n2. **What our type looks like** (cite file:line)\n3. **Impact** (what information is lost or misinterpreted)\n4. **Severity** (P0/P1/P2)\n\nAreas to examine:\n- Message types: UserMessage, AssistantMessage, ToolMessage — field-by-field comparison\n- AssistantMessage: does pi have fields we lack? (thinking, toolCalls, attribution fields like api/provider/model/responseModel/responseId/diagnostics)\n- ToolMessage: does pi carry more than content? (tool name, call ID, error flag)\n- AgentEvent types: are all pi event types present in our model?\n- AgentConfig: field-by-field comparison (what config options does pi support that we don't?)\n- AgentTool interface: does pi's tool interface have methods/fields we lack?\n- SessionStore interface: method signatures compared\n- Any pi-specific types that map to concepts we should have\n\nReturn a structured list of findings, sorted by severity."
}
```

**Output:**
```
<task id="ses_11b11fe2bffebZB76PM3GsSdDa" state="completed">
<task_result>
I have everything needed for a thorough comparison. Here are the findings.

---

# Pi vs. Sakti Type & Message Model Divergences

**Sources compared**
- Pi (truth): `openspec/references/pi/packages/ai/src/types.ts` (pi-ai base), `.../agent/src/types.ts` (agent core), `.../agent/src/harness/types.ts` + `.../harness/session/session.ts` (storage), `.../coding-agent/src/core/messages.ts` (custom messages), `.../ai/src/utils/diagnostics.ts`
- Ours: `packages/agent/src/types.ts`, `packages/agent/src/loop/events.ts`, plus observed usage in `packages/agent/src/loop/{streaming,tool-execution,index}.ts` and `packages/tools/src/lib/types.ts`

Severity scale: **P0** = correctness/data-loss for core flows; **P1** = capability gap or type-system lie with real downstream impact; **P2** = looseness/ergonomics/architectural drift.

---

## P0 — Critical (correctness / data loss)

### 1. `ThinkingContent` drops `thinkingSignature` and `redacted`
- **Pi** (`ai/src/types.ts:259-267`): `ThinkingContent = { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean }`. `thinkingSignature` is the opaque blob providers (Anthropic, OpenAI Responses) require to replay reasoning across turns; `redacted` marks safety-redacted blocks whose encrypted payload lives in `thinkingSignature`.
- **Ours** (`packages/agent/src/types.ts:12-15`): `ThinkingContent = { thinking: string; type: "thinking" }` — both fields absent.
- **Impact**: Multi-turn thinking continuity is broken at the type level. For Anthropic/OpenAI-Responses models, the signature must be echoed back on the next turn or the provider rejects/drops the reasoning. Our `mapPiAssistantMessage` passes `piMsg.content` through opaquely (`loop/streaming.ts:82`), so the field may *survive* at runtime, but every TS consumer in our repo is blocked from reading/forwarding it without casts. `redacted` blocks cannot be round-tripped at all by typed code.
- **Severity**: P0 — silent corruption of reasoning-enabled multi-turn conversations for the providers sakti targets.

---

## P1 — High (capability gaps / type lies with real impact)

### 2. `ToolResultMessage` role string is `"tool"`, not `"toolResult"`
- **Pi** (`ai/src/types.ts:323, 333`): `role: "toolResult"`; the `Message` union discriminates on it.
- **Ours** (`packages/agent/src/types.ts:40-47`): `role: "tool"`.
- **Impact**: Our `AgentMessage` is structurally incompatible with pi-ai's `Message`. Every boundary needs translation — `toPiMessages` does it (`loop/streaming.ts:36-43`), `streaming.ts` maps back implicitly. Any direct interop with pi-ai (or pi's `convertToLlm`) fails to match the discriminator. High maintenance hazard and a class of bugs that silent translation masks.
- **Severity**: P1.

### 3. `ToolResultMessage` has no `details` field; content is `TextContent[]` not `(TextContent | ImageContent)[]`
- **Pi** (`ai/src/types.ts:323-331`): `content: (TextContent | ImageContent)[]; details?: TDetails` (generic structured metadata channel).
- **Ours** (`packages/agent/src/types.ts:40-47`): `content: TextContent[]`; no `details`.
- **Impact**: (a) No structured details channel for UI/logs — everything must be flattened into text. (b) Tools cannot return images (blocks screenshot/image-gen/plot tools). `tool-execution.ts:101` hard-wraps the string result as `[{ type: "text", text: result.content }]`, so images are impossible end-to-end.
- **Severity**: P1.

### 4. `AgentToolResult` model is fundamentally different (string vs blocks; no `details`; extra `isError`; divergent error contract)
- **Pi** (`agent/src/types.ts:345-355`): `{ content: (TextContent | ImageContent)[]; details: T; terminate?: boolean }`. Contract: tools **throw** on failure; error status lives on the *message* (`ToolResultMessage.isError`), not the result. `AgentToolResult` is generic over `TDetails`.
- **Ours** (`packages/agent/src/types.ts:81-85`): `{ content: string; isError?: boolean; terminate: boolean }`. Tools return `{isError: true}` instead of throwing; no `details`; `terminate` is required (pi: optional).
- **Impact**: (a) No images/structured content from tools. (b) No structured details — the `details` channel is what pi's `afterToolCall` override, UI rendering, and the generic `AgentTool<TDetails>` all rely on. (c) Inverted error model means pi-style hooks/tools cannot be ported without re-architecting; the `AfterToolCallResult.isError` override target doesn't exist on our result. Mirrored in `packages/tools/src/lib/types.ts:1-5` (`ToolResult`), so the whole tools package inherits the divergence.
- **Severity**: P1.

### 5. `UserMessage.content` is `string`, not multimodal
- **Pi** (`ai/src/types.ts:302-306`): `content: string | (TextContent | ImageContent)[]`.
- **Ours** (`packages/agent/src/types.ts:19-23`): `content: string`.
- **Impact**: Users cannot attach images (screenshots, pasted figures) to prompts. `injectMessage` (`loop/index.ts:42-46`) constructs only `{ content: text }`. Blocks multimodal input entirely.
- **Severity**: P1.

### 6. `TextContent` drops `textSignature`
- **Pi** (`ai/src/types.ts:253-257`): `TextContent = { type: "text"; text: string; textSignature?: string }` (OpenAI Responses message metadata / legacy id).
- **Ours** (`packages/agent/src/types.ts:7-10`): `{ text: string; type: "text" }`.
- **Impact**: Provider-side text metadata lost from typed access; same passthrough caveat as finding 1 (runtime may preserve via opaque `any`, TS consumers cannot see it). Relevant for OpenAI Responses `store`/signature replay.
- **Severity**: P1.

### 7. `AssistantMessage` attribution fields are optional + untyped; `stopReason` is `string` not `StopReason`; `diagnostics` is `unknown[]`
- **Pi** (`ai/src/types.ts:308-321`): `api: Api` (req), `provider: Provider` (req), `model: string` (req), `stopReason: StopReason` (req, union `"stop" | "length" | "toolUse" | "error" | "aborted"`), `diagnostics: AssistantMessageDiagnostic[]` (structured per `utils/diagnostics.ts:8-13`: `{type, timestamp, error?: {name,message,stack,code}, details?}`).
- **Ours** (`packages/agent/src/types.ts:25-38`): `api?`, `provider?`, `model?` all optional `string`; `stopReason?: string`; `diagnostics?: unknown[]`.
- **Impact**: (a) The streaming adapter *fakes* attribution with sentinel defaults when missing (`loop/streaming.ts:28-30`: `api ?? "openai-completions"`, `provider ?? "openai"`, `model ?? "unknown"`), producing lying data on round-trip. (b) `stopReason` can't be exhaustively switched — callers can't type-safely distinguish `length`/`toolUse`/`error`/`aborted`. (c) Diagnostics lose their structured shape; consumers must guess.
- **Severity**: P1.

### 8. No `convertToLlm` / `transformContext` hooks; `AgentMessage` is a closed 3-arm union
- **Pi** (`agent/src/types.ts:135-186, 309`): `AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages]` (open via declaration merging); `AgentLoopConfig.convertToLlm` (required) and `transformContext` (optional) are the transformation seams.
- **Ours** (`packages/agent/src/types.ts:49`): `AgentMessage = UserMessage | AssistantMessage | ToolResultMessage` — closed; no `CustomAgentMessages`; no conversion hook in `AgentConfig`.
- **Impact**: Cannot represent compaction summaries, branch summaries, bash-execution messages, or any extension message in the transcript (see finding 9). The loop's `toPiMessages` (`loop/streaming.ts:16-45`) hard-codes the three cases. This blocks first-class `CompactionSummaryMessage`/`BranchSummaryMessage` even though our compaction runs.
- **Severity**: P1.

### 9. No custom message types (`CompactionSummaryMessage`, `BranchSummaryMessage`, `BashExecutionMessage`, `CustomMessage`)
- **Pi** (`coding-agent/src/core/messages.ts:29-77`): declares four custom message types via `CustomAgentMessages` merging, with `convertToLlm` turning each into a user message with `<summary>` wrapping (lines 148-194).
- **Ours**: none. Our compaction (`compaction.ts`) produces a summary string but has no typed message to carry it; it must be jammed into a `UserMessage` ad hoc.
- **Impact**: No auditable, typed record of compaction/branch events in the transcript; `convertToLlm`-style rendering is impossible to do generically.
- **Severity**: P1.

### 10. No `beforeToolCall` / `afterToolCall` hooks (and none of their context/result types)
- **Pi** (`agent/src/types.ts:55-109, 262-276`): `beforeToolCall` (block/allow), `afterToolCall` (override content/details/isError/terminate), with `BeforeToolCallContext`, `AfterToolCallContext`, `BeforeToolCallResult`, `AfterToolCallResult`.
- **Ours**: absent. `AgentConfig` has no hook fields; `loop/tool-execution.ts` runs tools directly with no interception points.
- **Impact**: Cannot block tool calls, rewrite results, force errors, or coerce termination — core extensibility points. Also blocks policy/guardrail layers.
- **Severity**: P1.

### 11. No `getApiKey` callback (static key only)
- **Pi** (`agent/src/types.ts:189-196`): `getApiKey?: (provider) => string | undefined | Promise<...>` — resolves per LLM call, for short-lived OAuth tokens.
- **Ours** (`packages/agent/src/types.ts:251`): `apiKey?: string` (static).
- **Impact**: Blocks OAuth/short-lived-token providers (GitHub Copilot, etc.) whose keys expire mid-run. AGENTS.md explicitly calls out `getEnvApiKey(provider)` resolution, but the loop can't refresh per call.
- **Severity**: P1.

### 12. Steering/follow-up are string-queue based, not callback based
- **Pi** (`agent/src/types.ts:219-243`): `getSteeringMessages?: () => Promise<AgentMessage[]>`, `getFollowUpMessages?: () => Promise<AgentMessage[]>` — return full structured messages, drained at decision points.
- **Ours** (`loop/index.ts:14-18, 27-36`): `steer(message: string)` / `followUp(message: string)` push plain strings into bounded queues (`QUEUE_BOUND = 10`, silently dropped on overflow).
- **Impact**: Cannot steer with images, custom types, or assistant/role-different messages; cannot defer generation until drain; overflow is silently lossy.
- **Severity**: P1.

### 13. `SessionStore` is a flat message log; pi models a typed entry tree
- **Pi** (`harness/types.ts:334-454`, `harness/session/session.ts`): `SessionStorage` stores `SessionTreeEntry` union of 11 typed entry kinds (Message, ThinkingLevelChange, ModelChange, ActiveToolsChange, Compaction, BranchSummary, Custom, CustomMessage, Label, SessionInfo, Leaf); `Session` exposes `appendMessage`, `appendCompaction`, `appendModelChange`, `moveTo`, `getBranch`, `buildContext`, etc.; `SessionRepo` adds `create/open/list/delete/fork`.
- **Ours** (`packages/agent/src/types.ts:244-248`): `SessionStore { appendMessage; loadMessages; replaceMessages }`.
- **Impact**: (a) No representation for branching/forking, model/thinking/active-tool changes, labels, session names, or compaction audit trail. (b) **Compaction is destructive**: `replaceMessages` overwrites history, whereas pi's `CompactionEntry { summary, firstKeptEntryId, tokensBefore }` is reconstructable (see `buildSessionContext` at `session/session.ts:61-77`). (c) No fork. This is the storage-layer mirror of findings 8/9.
- **Severity**: P1.

---

## P2 — Medium (looseness / ergonomics / architectural drift)

### 14. `AgentTool` interface: no `label`, untyped `parameters`, no `prepareArguments`, no per-tool `executionMode`, weaker `onUpdate`
- **Pi** (`agent/src/types.ts:366-389`): `extends Tool<TParameters>`; `label: string` (req); `parameters: TSchema` (typebox, compile-time-validated); `prepareArguments?`; `executionMode?: ToolExecutionMode` (per-tool override); `execute`'s `onUpdate: AgentToolUpdateCallback<TDetails>` yields structured `AgentToolResult<TDetails>` partials.
- **Ours** (`packages/agent/src/types.ts:87-97`): no `label`; `parameters: Record<string, unknown>`; no `prepareArguments`; no `executionMode`; `onUpdate: (partial: string) => void`.
- **Impact**: UI shows only the machine `name`; no schema-validated args; no per-tool sequential override; streaming tool updates limited to strings.
- **Severity**: P2.

### 15. `tool_execution_*` events lose `args` and `isError`; `tool_execution_update` is `accumulated: string` not structured `partialResult`
- **Pi** (`agent/src/types.ts:421-423`): `tool_execution_start { toolCallId, toolName, args }`, `tool_execution_update { ..., args, partialResult }`, `tool_execution_end { ..., result, isError }`.
- **Ours** (`packages/agent/src/types.ts:156-172`): start/update/end carry only `toolCallId`, `toolName` (+ `accumulated` on update, + `result` on end). No `args`, no `isError`.
- **Impact**: Observers/UI can't show tool arguments or error status from the event alone.
- **Severity**: P2.

### 16. `message_update` shape diverges: delta-union vs full partial message + raw provider event
- **Pi** (`agent/src/types.ts:418`): `{ type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }` — full partial message and the raw provider event.
- **Ours** (`packages/agent/src/types.ts:144-154`): `{ type: "message_update"; update: MessageUpdate }` where `MessageUpdate` is our own delta union (`text_delta`/`thinking_delta`/`toolcall_*`). No full partial message, no raw event.
- **Impact**: Consumers can't render the full in-flight assistant message from the event; must reconstruct from deltas.
- **Severity**: P2.

### 17. `message_start` / `message_end` `message` is optional; `agent_end` has no `messages` payload
- **Pi** (`agent/src/types.ts:411, 416, 419`): `message_start { message }`, `message_end { message }` (both required); `agent_end { messages: AgentMessage[] }`.
- **Ours** (`packages/agent/src/types.ts:121-124, 135-142`): `message?: AgentMessage` (optional) on both; `agent_end { sessionId }` — **no `messages`**.
- **Impact**: TS consumers must null-check where pi guarantees presence; `agent_end` consumers can't read the final transcript from the event (must query the store).
- **Severity**: P2.

### 18. Extra event types we emit that pi's `AgentEvent` doesn't have: `error`, `compaction_start/end`, `retry`
- **Pi** (`agent/src/types.ts:408-423`): the core `AgentEvent` has exactly 10 variants; errors are encoded via `AssistantMessage.stopReason === "error"|"aborted"`; compaction/retry live at the **`AgentHarness`** layer (`AgentHarnessOwnEvent`, `harness/types.ts:634-656`, with `AgentHarnessPhase = "idle"|"turn"|"compaction"|"branch_summary"|"retry"`).
- **Ours** (`packages/agent/src/types.ts:174-207`): `error`, `compaction_start`, `compaction_end`, `retry` are all in the core `AgentEvent` union; `agent_start`/`agent_end` also carry extra `sessionId`.
- **Impact**: Our `AgentEvent` conflates loop-level and harness-level concerns that pi deliberately separates. Porting pi's harness event model on top will require re-layering.
- **Severity**: P2.

### 19. Loose `string` types where pi uses unions: `thinkingLevel`, `steeringMode`, `followUpMode`
- **Pi**: `ThinkingLevel = "off"|"minimal"|"low"|"medium"|"high"|"xhigh"` (`agent/src/types.ts:284`); `QueueMode = "all"|"one-at-a-time"` (`agent/src/types.ts:44`).
- **Ours** (`packages/agent/src/types.ts:254, 261, 263`): all three are `string`. Our loop *implements* both `QueueMode` values (`loop/index.ts:62-79`) and passes `thinkingLevel` straight through to pi-ai as `reasoning` (`loop/streaming.ts:214-219`, with an inline `import("@earendil-works/pi-ai").ThinkingLevel` cast — a banned inline import per pi's own rules, and a smell).
- **Impact**: No compile-time exhaustiveness; typos fall through silently.
- **Severity**: P2.

### 20. `AgentConfig` lacks `SimpleStreamOptions` passthrough; bakes in harness/session concerns
- **Pi** (`agent/src/types.ts:135`): `AgentLoopConfig extends SimpleStreamOptions` — inherits `temperature`, `maxTokens`, `transport`, `cacheRetention`, `timeoutMs`, `maxRetries`, `maxRetryDelayMs`, `headers`, `metadata`, `env`, `sessionId`, etc. The config has *no* session storage, no compaction settings, no retry base delay.
- **Ours** (`packages/agent/src/types.ts:250-266`): none of the `SimpleStreamOptions` knobs; instead carries `store`, `autoCompaction`, `autoRetry`, `keepRecentTokens`, `reserveTokens`, `retryBaseDelayMs`, `sessionId`.
- **Impact**: (a) Can't tune provider request options per agent. (b) Architectural: our config conflates loop + harness + session concerns; pi's loop is pure (storage/compaction/retry policy live above).
- **Severity**: P2.

### 21. No `shouldStopAfterTurn` / `prepareNextTurn` hooks (and their context types)
- **Pi** (`agent/src/types.ts:111-131, 198-217`): `ShouldStopAfterTurnContext`, `PrepareNextTurnContext`, `AgentLoopTurnUpdate`, and the two hooks for graceful stop and mid-run model/context/thinking swap.
- **Ours**: absent.
- **Impact**: Caller can't request graceful stop before context fills, nor rotate model/thinking mid-run. Less pressing than the tool hooks but limits advanced orchestration.
- **Severity**: P2.

### 22. No `AgentState` / `AgentContext` interfaces
- **Pi** (`agent/src/types.ts:317-342, 391-399`): `AgentState` (systemPrompt, model, thinkingLevel, tools/messages accessors, `isStreaming`, `streamingMessage`, `pendingToolCalls`, `errorMessage`); `AgentContext` (systemPrompt, messages, tools snapshot).
- **Ours**: neither exists; the loop keeps ad-hoc locals.
- **Impact**: No typed public state surface for observers/UI; no typed context snapshot contract for hooks (which don't exist either — compounding).
- **Severity**: P2.

---

## Summary by severity

| Sev | # | Theme |
|-----|---|-------|
| **P0** | 1 | `ThinkingContent` loses `thinkingSignature`/`redacted` (multi-turn reasoning corruption) |
| **P1** | 2 | `ToolResultMessage.role` is `"tool"` not `"toolResult"` (interop incompatibility) |
| **P1** | 3 | `ToolResultMessage` lacks `details`, image content |
| **P1** | 4 | `AgentToolResult` is string-based, no `details`, inverted error model |
| **P1** | 5 | `UserMessage.content` is string-only (no multimodal) |
| **P1** | 6 | `TextContent` loses `textSignature` |
| **P1** | 7 | `AssistantMessage` attribution/`stopReason`/`diagnostics` untyped & optional |
| **P1** | 8 | No `convertToLlm`/`transformContext`; closed `AgentMessage` union |
| **P1** | 9 | No custom message types (compaction/branch/bash/custom) |
| **P1** | 10 | No `beforeToolCall`/`afterToolCall` hooks |
| **P1** | 11 | No `getApiKey` callback (blocks OAuth providers) |
| **P1** | 12 | Steering/follow-up are string queues, not message callbacks |
| **P1** | 13 | `SessionStore` is a flat log; no entry tree, branching, reconstructable compaction |
| **P2** | 14 | `AgentTool`: no `label`, untyped params, no `prepareArguments`/`executionMode` |
| **P2** | 15 | `tool_execution_*` events lack `args`/`isError`/structured `partialResult` |
| **P2** | 16 | `message_update` is delta-only (no full partial / raw provider event) |
| **P2** | 17 | `message_*` optional; `agent_end` lacks `messages` |
| **P2** | 18 | Loop-level `AgentEvent` conflates harness concerns (error/compaction/retry) |
| **P2** | 19 | `thinkingLevel`/`steeringMode`/`followUpMode` typed as `string` not unions |
| **P2** | 20 | No `SimpleStreamOptions` passthrough; config mixes loop/harness/session |
| **P2** | 21 | No `shouldStopAfterTurn`/`prepareNextTurn` |
| **P2** | 22 | No `AgentState`/`AgentContext` surfaces |

**Cross-cutting observation**: the single biggest architectural delta is that pi separates three layers — **pi-ai base messages** → **agent core loop (pure, hook-driven, open `AgentMessage` via declaration merging)** → **harness/session (entry tree, compaction audit, branching, retry/compaction phases)** — while sakti collapses all three into one `AgentMessage`/`AgentConfig`/`SessionStore`/`AgentEvent`. Most P1/P2 findings follow from that collapse. The P0 (`thinkingSignature`) is an independent data-loss bug in our local content-block redefinitions.
</task_result>
</task>
```

**Tool: task**

**Input:**
```json
{
  "description": "Compare tools implementation",
  "subagent_type": "explore",
  "prompt": "Thoroughness: very thorough\n\nCompare pi's coding tools against ours to find behavioral divergences.\n\n**Pi reference** (source of truth):\n- `openspec/references/pi/packages/coding-agent/src/core/tools/read.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/tools/write.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/tools/edit.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/tools/bash.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/tools/grep.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/tools/find.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/tools/ls.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/tools/truncate.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/tools/path-utils.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/tools/output-accumulator.ts`\n\n**Our implementation**:\n- `packages/tools/src/tools/read.ts`\n- `packages/tools/src/tools/write.ts`\n- `packages/tools/src/tools/edit.ts`\n- `packages/tools/src/tools/bash.ts`\n- `packages/tools/src/tools/grep.ts`\n- `packages/tools/src/tools/find.ts`\n- `packages/tools/src/tools/ls.ts`\n- `packages/tools/src/lib/shared.ts`\n- `packages/tools/src/lib/shell.ts`\n- `packages/tools/src/lib/types.ts`\n\nFor each divergence:\n1. **What pi does** (cite file:line)\n2. **What we do** (cite file:line)\n3. **Impact** (user-visible behavior difference)\n4. **Severity** (P0 = broken/wrong, P1 = degraded UX, P2 = minor)\n\nAreas to examine:\n- Read tool: line limits, truncation behavior, binary file handling, offset/limit support\n- Write tool: path validation, overwrite protection\n- Edit tool: fuzzy matching, whitespace normalization, multi-edit support\n- Bash tool: timeout handling, output truncation, working directory, env vars\n- Grep tool: regex vs literal, output format, context lines, file filtering\n- Find tool: pattern matching, output format, max results\n- Ls tool: output format, hidden files, sorting\n- Output truncation: how pi truncates large outputs (char limits, line limits, markers)\n- Path resolution: relative vs absolute, cwd scoping\n- Tool result format: content structure, isError handling, terminate flag\n\nReturn a structured list of findings, sorted by severity."
}
```

**Output:**
```
<task id="ses_11b11fe10ffely7Du5tNiixvdF" state="completed">
<task_result>
I have all the information needed. Here is the structured comparison.

---

# Pi vs. Sakti Coding Tools — Behavioral Divergences

## Foundational: Tool Result Type

This single structural mismatch underpins many per-tool divergences.

| | Pi | Ours |
|---|---|---|
| `content` | `(TextContent \| ImageContent)[]` — structured parts | `string` |
| Errors | `throw` from `execute`; wrapper sets `isError` | return `{ content, isError: true }` |
| `details` | `{ truncation, diff, patch, fullOutputPath, ... }` | absent |
| Streaming `onUpdate` | `(update: { content, details }) => void` | `(text: string) => void` |
| `ctx` param | carries `model`, `cwd`, etc. | absent |
| `terminate` | lives on `AgentToolResult`, set by agent loop | on `ToolResult`, always `false` from every tool |

- **Pi**: `openspec/references/pi/.../extensions/types.ts` (ToolDefinition); execute signatures throughout `bash.ts:287`, `read.ts:216`, etc. carry `(id, args, signal, onUpdate, ctx)`.
- **Ours**: `packages/tools/src/lib/types.ts:1-17` — `content: string`, `terminate: boolean` (hard-coded `false` everywhere), no `details`, `onUpdate: (p: string) => void`.

**Impact:** No way to emit real image parts, diffs, truncation metadata, or model-aware behavior. The `terminate` flag is dead weight that the agent loop must ignore or re-implement. Every per-tool finding below compounds this.

**Severity:** P0 (architectural; drives several P0s below)

---

## P0 — Broken / Wrong

### 1. Read: byte truncation slices characters, not bytes (corrupts UTF-8)
- **Pi:** `truncateHead` counts `Buffer.byteLength(line, "utf-8")` and never splits a line (`truncate.ts:126-137`); multi-byte safe.
- **Ours:** `content = content.slice(0, maxBytes)` (`packages/tools/src/tools/read.ts:140`) — `String.slice` on UTF-16 code units against a byte limit. Splits multi-byte sequences; the returned string can contain a replacement char or be invalid for any non-ASCII file.
- **Impact:** Garbled or invalid output for any file containing emoji, CJK, accented Latin, etc.
- **Severity:** P0

### 2. Read: `limit` silently discarded on large files without `offset`
- **Pi:** Honors user `limit` first, then applies truncation with an actionable `[N more lines in file. Use offset=…]` continuation (`read.ts:291-321`).
- **Ours:** `read.ts:127-137`:
  ```
  const endLine = limit ? startLine + limit : maxLines;   // L128
  const sliced = lines.slice(startLine, endLine);         // L129
  ...
  if (lines.length > maxLines && !offset) {               // L134
    content = lines.slice(0, maxLines).join("\n");        // L135  ← re-slices from 0
  }
  ```
  `read({path, limit: 5})` on a 3000-line file: L129 slices `[0,5)`, then L134–135 (true because `!offset`) overwrites `content` with the first 2000 lines. The user's `limit: 5` is discarded.
- **Impact:** Model asks for 5 lines, gets 2000. Token blowup / wrong data.
- **Severity:** P0

### 3. Read: large `offset` returns empty with no error
- **Pi:** `if (startLine >= allLines.length) throw new Error("Offset ${offset} is beyond end of file (${allLines.length} lines total)")` (`read.ts:285-287`).
- **Ours:** `endLine = limit ? startLine + limit : maxLines` (`read.ts:128`) — without `limit`, `endLine` is the constant `2000`. `read({offset: 5000})` on a 10000-line file slices `[4999, 2000)` → empty string, no error. (`read({offset:5000, limit:5})` happens to work, but the no-limit case is broken.)
- **Impact:** Model gets an empty file and concludes the file is empty.
- **Severity:** P0

### 4. Read: images returned as `data:` URL text, not structured image parts
- **Pi:** Returns `[{type:"text", text: note}, {type:"image", data, mimeType}]` and auto-resizes to ≤2000×2000; omits with a note on non-vision models (`read.ts:247-274`).
- **Ours:** Returns a single `string` `Read image file [${mime}]\ndata:${mime};base64,...` (`read.ts:113-119`). Because `content` is a `string` (`types.ts:2`), there is no image part. No resize, no model-awareness.
- **Impact:** Vision models cannot consume the image as an image (most won't decode an inline data URL in a text part); huge base64 balloons context; non-vision models still pay the token cost.
- **Severity:** P0

### 5. Edit: no legacy `oldText`/`newText` or JSON-string `edits` support
- **Pi:** `prepareArguments` (referenced at `edit.ts:307`, defined in the tool wrapper) converts top-level `oldText`/`newText` → `edits[]` and parses `edits` sent as a JSON string (some models — Opus 4.6, GLM-5.1 — do this per pi's own comment).
- **Ours:** `packages/tools/src/tools/edit.ts:75-106` only accepts `{path, edits}`. A model that sends `{path, oldText, newText}` fails with `Missing required argument 'edits' for edit`; a model that sends `edits: "[{...}]"` fails validation.
- **Impact:** Whole classes of edit calls fail outright depending on model habits.
- **Severity:** P0

### 6. Grep: `--max-count` is per-file, not total — `limit` semantics wrong
- **Pi:** Counts matches globally and kills rg when the total hits `limit` (`grep.ts:287-290`).
- **Ours:** `rg --max-count ${maxMatches}` (`grep.ts:50`). rg's `--max-count N` means "≤N matching lines **per file**." With 50 files, `limit:100` can return up to 5000 lines.
- **Impact:** Limit is effectively unbounded for multi-file searches; context window blowup.
- **Severity:** P0

---

## P1 — Degraded UX / Wrong in Common Cases

### 7. Edit: no fuzzy matching (fails on trailing whitespace, smart quotes, unicode dashes/spaces)
- **Pi:** `fuzzyFindText` tries exact, then `normalizeForFuzzyMatch` (NFKC, trim trailing whitespace per line, smart quotes→ASCII, en/em-dash→`-`, special spaces→space) (`edit-diff.ts:33-54, 206-244`). `applyEditsToNormalizedContent` overlays fuzzy matches onto original lines (`edit-diff.ts:304-366`).
- **Ours:** `normalized.split(edit.oldText).length - 1` and `result.replace(edit.oldText, edit.newText)` — pure exact match (`edit.ts:115, 134`).
- **Impact:** Trailing-whitespace mismatch (extremely common when models copy from rendered docs) → hard failure with no recovery. Models often paste smart quotes from docs.
- **Severity:** P1 (high frequency)

### 8. Edit: missing safety checks present in pi
- **Pi:** rejects empty `oldText` (`edit-diff.ts:315-318`), detects no-op edits (`edit-diff.ts:361-363`), detects overlapping edits across the array (`edit-diff.ts:346-354`), and CRLF detection picks the ending that appears *first* (`edit-diff.ts:10-16`).
- **Ours:** none of these (`edit.ts:114-135`). Empty `oldText` → `split("").length - 1` is enormous → reported as "matches N locations" (confusing message, not the real reason). Overlapping edits applied sequentially with silently wrong results.
- **Impact:** Confusing errors; silent bad edits on overlap.
- **Severity:** P1

### 9. Edit: lone `\r` not normalized; BOM detection by magic number
- **Pi:** `normalizeToLF` converts both `\r\n` and lone `\r` to `\n` (`edit-diff.ts:18-20`); `stripBom` checks `startsWith("\uFEFF")` (`edit-diff.ts:247-249`).
- **Ours:** `normalizeToLf` only handles `\r\n` (`edit.ts:18-20`); `stripBom` checks `charCodeAt(0) === 0xfe_ff` (`edit.ts:7-12`) — works, but lone `\r` (classic Mac, or `\r` inside content) breaks matching.
- **Severity:** P1

### 10. Edit: no diff/patch/firstChangedLine in the result
- **Pi:** returns `details: { diff, patch, firstChangedLine }` (`edit.ts:350-360`) — model sees what changed.
- **Ours:** returns only `Applied N edit(s) to ${path}` (`edit.ts:140`). No structured channel (`details` absent in `types.ts`).
- **Impact:** Model has to re-read the file to verify edits; more turns, more tokens.
- **Severity:** P1

### 11. Bash: keeps HEAD of output, not TAIL
- **Pi:** `OutputAccumulator` + `truncateTail` keep the **last** N lines/bytes, because errors and final results are at the end (`output-accumulator.ts`, `truncate.ts:168-241`, `bash.ts:284`).
- **Ours:** `OutputAccumulator.append` fills from the start and stops at the cap (`shell.ts:59-68`); `.content` returns the head. A long build log loses the failing line.
- **Impact:** The most useful part of long command output (the error at the end) is dropped.
- **Severity:** P1

### 12. Bash: no process-tree kill → orphaned children
- **Pi:** `detached: true` on non-Windows + `killProcessTree(child.pid)` on timeout/abort (`bash.ts:82, 95-96, 102-104`).
- **Ours:** `child.kill("SIGKILL")` (`shell.ts:140, 158`) — only the direct `/bin/sh` child. `npm run dev`, `npm | xargs`, backgrounded servers, etc. survive and keep running (ports held).
- **Impact:** Leaked processes after timeouts/aborts; subsequent commands fail (port in use).
- **Severity:** P1

### 13. Bash: forced 30s default timeout; `timeout:0` cannot disable
- **Pi:** no default timeout — `timeout` is purely opt-in (`bash.ts:26-27, 100`).
- **Ours:** `defaultTimeout = 30_000` (`bash.ts:7`); `ms = timeout ? timeout * 1000 : defaultTimeout` (`bash.ts:37`) — `timeout:0` is falsy → 30s. Long-running commands (dev servers, watchers) are silently killed.
- **Impact:** Intentional long commands die; models can't disable timeout.
- **Severity:** P1

### 14. Bash: truncated output is gone (no temp file)
- **Pi:** writes full output to `/tmp/pi-bash-*.log` and embeds `Full output: <path>` + `[Showing lines X-Y of Z]` (`bash.ts:362-373`, `output-accumulator.ts`).
- **Ours:** `[Output truncated. Use grep/head/tail to read specific parts.]` (`bash.ts:46-47`). No file, no line range.
- **Impact:** Lost output is unrecoverable; model must rerun with `| tail`.
- **Severity:** P1

### 15. Bash: non-zero exit and timeout drop status line
- **Pi:** appends `Command exited with code N` / `Command timed out after N seconds` / `Command aborted` to the output before throwing (`bash.ts:393-407`).
- **Ours:** non-zero exit → `isError:true` with just the raw output (`bash.ts:56-57`); timeout → `isError:true` with `[Command timed out after Ns]` but no exit-code line on failure.
- **Impact:** Model doesn't see the exit code; must guess why a command failed.
- **Severity:** P1

### 16. Grep: missing `glob`, `literal`, `context` parameters
- **Pi:** schema supports all of them (`grep.ts:24-36`); `context` emits `path-lineNum- text` separator lines (`grep.ts:250-268`).
- **Ours:** only `pattern, path, ignoreCase, limit` (`grep.ts:10-22`).
- **Impact:** No file-type filtering, no literal mode (regex-special search terms break), no surrounding context.
- **Severity:** P1

### 17. Grep: parses output by first colon → breaks on colon in filenames
- **Pi:** `rg --json` → structured `{path, line_number, lines}` events; no ambiguity (`grep.ts:280-292`).
- **Ours:** `line.indexOf(":")` and `slice` (`grep.ts:61-64`). `my:file.ts:5:foo` → filePath=`my`, rest=`file.ts:5:foo`, then `relative(cwd, "my")` → wrong.
- **Impact:** Wrong paths whenever a filename contains `:`.
- **Severity:** P1

### 18. Grep/Find: synchronous `execSync` blocks the event loop
- **Pi:** `spawn` + streaming readline; async throughout (`grep.ts:221-298`, `find.ts:248-269`).
- **Ours:** `runCommand` → `execSync` with `maxBuffer: 1MB` (`shell.ts:36-44`), called by `grep.ts:49` and `find.ts:45`. The bash tool's own "does not block the event loop" test (`tools.test.ts:257-267`) exists for `spawnCommand`, but grep/find still block.
- **Impact:** UI/server freezes during grep/find on large trees; output >1MB throws instead of truncating.
- **Severity:** P1

### 19. Find: patterns containing `/` aren't handled (no `--full-path`)
- **Pi:** if pattern includes `/`, adds `--full-path` and prepends `**/` unless already anchored (`find.ts:239-245`). `src/**/*.spec.ts` matches as expected.
- **Ours:** `fd --glob '<pattern>' ...` bare (`find.ts:46`). `fd --glob` matches against the basename unless `--full-path`; `src/**/*.spec.ts` returns nothing in most layouts.
- **Impact:** Path-style globs silently return no results.
- **Severity:** P1

### 20. No path normalization: `~`, unicode spaces, `@`, `file://` all fail
- **Pi:** `resolveToCwd` → `normalizePath` expands `~`, normalizes unicode spaces, strips leading `@`, converts `file://` (`paths.ts:57-84`); `resolveReadPathAsync` additionally tries macOS screenshot name variants (`path-utils.ts:86-117`).
- **Ours:** every tool does `resolve(cwd, path)` (`read.ts:97`, `write.ts:32`, `edit.ts:91`, `grep.ts:44`, `find.ts:41`, `ls.ts:30`). Node's `resolve` does none of the above.
- **Impact:** `~/foo.txt`, pasted paths with non-breaking spaces, and `@/file` all fail with "not found".
- **Severity:** P1

### 21. Read/Write/Edit/Bash: no abort signal honored
- **Pi:** every tool registers an abort listener and checks `signal.aborted` after each `await`; rejects with `Operation aborted` (`read.ts:225-234`, `write.ts:208-219`, `edit.ts:317-348`, `bash.ts:94-96, 110-113`).
- **Ours:** `read.ts:79`, `write.ts:19`, `edit.ts:75` are `async (_id, args) =>` — signal dropped. `bash.ts` passes signal to `spawnCommand` (`bash.ts:41`) which does kill the child, but grep/find take no signal.
- **Impact:** Cancellation requests don't stop in-flight reads/writes/edits/grep/find; user "stop" button feels broken, and a cancelled write can still land.
- **Severity:** P1

### 22. Ls: no abort, no precheck, no empty/limit/byte notices
- **Pi:** checks exists + isDirectory, emits `Path not found` / `Not a directory` errors, `(empty directory)` message, entry-limit and byte-limit notices, and is abort-aware (`ls.ts:113-208`).
- **Ours:** just `readdir` and lets it throw (`ls.ts:33-49`). Empty dir → empty string (not `(empty directory)`); large dirs beyond `limit` silently sliced with no notice; no byte limit.
- **Severity:** P1

---

## P2 — Minor

### 23. Ls: sort order differs (dirs-first + case-sensitive vs pure alphabetical case-insensitive)
- **Pi:** `a.toLowerCase().localeCompare(b.toLowerCase())` — pure alphabetical, case-insensitive (`ls.ts:150`).
- **Ours:** directories first, then `a.name.localeCompare(b.name)` — case-**sensitive** (`ls.ts:36-45`). `Z.txt` sorts before `a.txt`; all dirs cluster at top.
- **Severity:** P2

### 24. Grep/Find: relativize against `cwd`, not the requested `searchPath`
- **Pi:** `formatPath` relativizes against `searchPath` so results are short relative paths (`grep.ts:190-198`, `find.ts:300-313`).
- **Ours:** `relative(cwd, filePath)` (`grep.ts:64`, `find.ts:55`) — searching `src/` yields `src/foo.ts`, pi yields `foo.ts`.
- **Severity:** P2

### 25. Find: missing result-limit / byte-limit notices and "No files" wording
- **Pi:** `${N} results limit reached. Use limit=${N*2} for more, or refine pattern` and `No files found matching pattern` (`find.ts:321-323, 292`).
- **Ours:** no notices (`find.ts:60`); message is `No files found.` (`find.ts:57`).
- **Severity:** P2

### 26. Grep: no per-line truncation; no match/byte-limit notices
- **Pi:** `truncateLine` caps match lines at 500 chars with `[truncated]`; emits `100 matches limit reached…`, `50KB limit reached`, `Some lines truncated to 500 chars` (`grep.ts:262, 324, 340-355`).
- **Ours:** nothing (`grep.ts:60-66`). A 50KB minified line streams straight into context.
- **Severity:** P2

### 27. Read: image MIME detected by extension first, then magic bytes; file read twice
- **Pi:** `detectSupportedImageMimeTypeFromFile` (sniffs content) is the only path (`read.ts:243`). One read.
- **Ours:** `detectImageMime` by extension, else `readFile`→`subarray(0,12)` for sniffing, then `readFile` again for the body (`read.ts:107-114`). Two reads on image files.
- **Severity:** P2

### 28. Bash: streaming polls on a 50ms `setInterval` instead of throttling on data
- **Pi:** throttles `onUpdate` at 100ms, driven by data arrival, with structured snapshots (`bash.ts:302-336`).
- **Ours:** `setInterval(..., 50)` polling `accum.content.length` (`shell.ts:106-114`) — timer-based, sends a growing raw string, no truncation metadata.
- **Severity:** P2

### 29. Write: `dirname` via `join(filePath, "..")`; byte-length vs char-length in message
- **Pi:** `dirname(absolutePath)` (`write.ts:202`); success uses `content.length` (char count) (`write.ts:222`).
- **Ours:** `join(filePath, "..")` (`write.ts:34`) — works but fragile; success uses `Buffer.byteLength` (`write.ts:39`).
- **Severity:** P2

### 30. Bash: no working-directory existence check; no env/commandPrefix/spawnHook hooks
- **Pi:** `fsAccess(cwd, F_OK)` with friendly error (`bash.ts:71-74`); `commandPrefix`, `shellPath`, `spawnHook` options (`bash.ts:146-155`).
- **Ours:** spawn fails with a cryptic OS error if cwd is missing (`shell.ts:99-103`); none of those hooks.
- **Severity:** P2

### 31. Grep/Find: `ensureTool` auto-download missing
- **Pi:** `ensureTool("rg"|"fd", true)` downloads the binary if absent (`grep.ts:172-176`, `find.ts:214-222`).
- **Ours:** `resolveBin` falls back to hardcoded paths then to the bare name (`shell.ts:10-31`); if neither rg nor fd is on PATH, the tool fails.
- **Severity:** P2

### 32. Grep/Find: hardcoded timeouts (30s / 15s), no per-call override
- **Pi:** no internal timeout; abort-driven only.
- **Ours:** `runCommand(..., 30_000)` (`grep.ts:52`), `runCommand(..., 15_000)` (`find.ts:48`).
- **Severity:** P2

### 33. Edit/Write: no per-file mutation queue (write) / weaker lock primitive
- **Pi:** both `write` and `edit` route through `withFileMutationQueue(absolutePath, …)` so concurrent tool calls on the same file serialize (`write.ts:203`, `edit.ts:312`).
- **Ours:** `edit` has `withFileLock` (`edit.ts:29-50`) — close equivalent. `write` has no serialization at all (`write.ts:19-42`); two concurrent writes to the same path race.
- **Severity:** P2

### 34. Edit: `existsSync` instead of `R_OK | W_OK` access check
- **Pi:** `access(absolutePath, R_OK | W_OK)` with a typed error including `error.code` (`edit.ts:325-331`).
- **Ours:** `existsSync(filePath)` (`edit.ts:93`) — file can exist but be read-only; the failure surfaces later as a cryptic write error.
- **Severity:** P2

### 35. Grep: empty-match / no-result on flag-injection test diverges from test intent
- The test at `packages/tools/src/__tests__/tools.test.ts:384-391` asserts that `pattern: "-i password"` yields `isError`. With single-quote shell-quoting (`grep.ts:50`), rg searches for the literal string `-i password`, finds nothing, exits 1, and our handler returns `{content: "No matches found."}` with **no** `isError` (`grep.ts:69-71`) — the test's expectation isn't met. Pi avoids this entirely via `--` + structured args (`grep.ts:219`).
- **Severity:** P2 (likely-failing test + divergent behavior)

---

## Severity Summary

| Sev | # | Highlights |
|-----|---|-----------|
| **P0** | 6 | UTF-8 corruption in read (#1); `limit`/`offset` bugs (#2, #3); images as data-URL text (#4); legacy edit args rejected (#5); grep `--max-count` per-file (#6) — plus the foundational result-type mismatch |
| **P1** | 16 | Edit fuzzy-match absence (#7); bash HEAD-not-TAIL truncation (#11) + no tree-kill (#12) + forced 30s timeout (#13) + lost output (#14); grep missing params (#16) + colon-parse (#17); sync `execSync` blocking (#18); find `/` patterns (#19); no path normalization (#20); no abort across tools (#21) |
| **P2** | 13 | ls sort order, relativization base, missing notices, double image read, polling stream, ensureTool, timeouts, no write queue, etc. |

The most leveraged single fix is the **tool-result type** (`types.ts`) — adopting pi's `{ content: Array<TextContent|ImageContent>, details?, isError }` (errors via `throw`) unblocks #4, #10, #28 and gives every tool a channel for truncation/diff metadata. The next highest-leverage fix is a **shared `truncate.ts`** port (fixes #1, #6-partial, #11, #14, #24-partial, #26).
</task_result>
</task>
```

**Tool: task**

**Input:**
```json
{
  "description": "Compare server/session layer",
  "subagent_type": "explore",
  "prompt": "Thoroughness: very thorough\n\nCompare pi's session/runtime layer against our server's agent layer to find architectural and behavioral divergences.\n\n**Pi reference** (source of truth):\n- `openspec/references/pi/packages/coding-agent/src/core/agent-session.ts` — session orchestration\n- `openspec/references/pi/packages/coding-agent/src/core/agent-session-runtime.ts` — runtime setup\n- `openspec/references/pi/packages/coding-agent/src/core/agent-session-services.ts` — service dependencies\n- `openspec/references/pi/packages/coding-agent/src/core/model-resolver.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/system-prompt.ts`\n- `openspec/references/pi/packages/coding-agent/src/core/settings-manager.ts`\n\n**Our implementation**:\n- `apps/server/src/agent/runner.ts` — runPrompt generator\n- `apps/server/src/agent/ws-handler.ts` — WS message handler\n- `apps/server/src/agent/ws.ts` — WS route\n- `apps/server/src/agent/model-resolver.ts`\n- `apps/server/src/agent/tools-builder.ts`\n- `apps/server/src/context.ts` — server context/DI\n\nWe recently fixed these (already done, skip them):\n- Same-session concurrent prompt rejection (concurrency guard)\n- resolveModel returns { model, provider }\n- .catch() on fire-and-forget runAgentStream\n\nFor each NEW divergence:\n1. **What pi does** (cite file:line)\n2. **What we do** (cite file:line)\n3. **Impact**\n4. **Severity** (P0/P1/P2)\n\nAreas to examine:\n- System prompt: how pi constructs it vs how we do (do we even pass a system prompt?)\n- Model resolver: provider resolution, fallback logic, available models\n- How pi handles steer/followUp queueing vs our WS approach\n- Session lifecycle: creation, loading, persistence patterns\n- Settings management: per-session vs global, what settings exist\n- Context injection: cwd, env vars, project metadata\n- Error handling in the session layer\n- How pi wires tools (any tools we're missing? MCP tools? extension tools?)\n- Streaming behavior options (pi has streamingBehavior enum)\n- Abort/cancellation flow compared\n\nReturn a structured list of findings, sorted by severity."
}
```

**Output:**
```
<task id="ses_11b11fdf2ffetJk5Oamk5Tem09" state="completed">
<task_result>
I now have a complete picture. Let me do a final confirmation on two details: whether thinking blocks survive the DB round-trip (relevant to session lifecycle) and the compaction route's provider resolution path — both already strongly indicated by the code I've read.

The evidence is already conclusive from the files read:
- `session-store.ts:114-131` reconstructs assistant content as a single text block + toolcalls (thinking blocks dropped, multi-text flattened).
- `compaction.ts:27-28` reads provider from `getForProject` only, ignoring `resolveModel`'s returned provider.

I have everything needed. Here is the structured comparison.

---

# Pi Session/Runtime vs. Our Server Agent Layer — Divergence Findings

Scope: pi `coding-agent` core (`agent-session.ts`, `agent-session-runtime.ts`, `agent-session-services.ts`, `model-resolver.ts`, `system-prompt.ts`, `settings-manager.ts`, `sdk.ts`) vs. our `apps/server/src/agent/*`, `packages/agent/src/*`, `packages/db/src/session-store.ts`. Already-fixed items (concurrency guard, `resolveModel` return shape, fire-and-forget `.catch`) verified present and excluded.

---

## P0 — breaks core functionality

### P0-1. No system prompt is ever sent to the LLM
- **Pi does:** Builds a rich system prompt per turn via `buildSystemPrompt()` (`system-prompt.ts:28-173`) and sets it on `agent.state.systemPrompt` every prompt (`agent-session.ts:1130-1136`, `_rebuildSystemPrompt` at `:907-941`). The prompt is threaded into the LLM call as `context.systemPrompt` (`pi-ai types.ts:365`). Contents: available-tools list + per-tool snippets/guidelines, default + extension guidelines, project context files (CLAUDE.md/AGENTS.md via `resourceLoader.getAgentsFiles()`), skills block, current date, current cwd.
- **We do:** `streamLLMResponse` calls `streamSimple(model, { messages, tools }, …)` with **no `systemPrompt` field** (`packages/agent/src/loop/streaming.ts:202-221`). `runPrompt` never constructs or passes one (`apps/server/src/agent/runner.ts:82-143`). Grep confirms zero `systemPrompt`/`buildSystemPrompt` references in `apps/server/src`; the lone `systemPrompt` in the agent package is the compaction summarizer's own (`compaction.ts:239`).
- **Impact:** The model receives raw messages + tool schemas and nothing else — no operating instructions, no tool-usage guidelines, no awareness of cwd, no date, no project conventions, no skills. This is the single biggest quality gap versus pi. Every pi capability that depends on prompt framing (concise output, file-path clarity, skill invocation, pi-doc handling) is absent.
- **Severity:** P0.

---

## P1 — significant behavioral / robustness gaps

### P1-1. In-stream LLM errors are never retried; no context-overflow recovery
- **Pi does:** Classifies retryable errors from the assistant message's `errorMessage` via a broad regex (`agent-session.ts:2484-2497`: overloaded/rate-limit/429/5xx/network/websocket/fetch/timeout/terminated), explicitly **excludes** context-overflow (→ compaction) and billing/quota (→ fail fast). On retry it removes the error message from state, backs off exponentially, and re-runs (`_prepareRetry` `:2503-2553`). On context-overflow specifically it removes the error, compacts, and retries **once** (`_checkCompaction` overflow branch `:1842-1869`, `_overflowRecoveryAttempted`).
- **We do:** Retry only catches **thrown** exceptions whose error has `statusCode` 429 or 5xx (`packages/agent/src/loop/streaming.ts:47-53`, applied at `:236-245`). In-stream `error` events (the `error` case in `consumeStream`, `streaming.ts:167-175`) return `{status:"error"}` → `streamLLMResponse` returns `{ok:false}` and ends the turn (`streaming.ts:223-226`) with **no retry**. No overflow detection or compaction-and-retry path exists; auto-compaction is only a proactive pre-turn threshold check (`loop/index.ts:110-139`).
- **Impact:** Transient provider failures that arrive inside the stream (Anthropic `overloaded_error`/529, in-band rate limits, WebSocket closes, "stream ended before message_stop") kill the whole turn. Long sessions that exceed the context window keep failing instead of self-healing via compaction.
- **Severity:** P1.

### P1-2. WS disconnect orphans the active run (no cleanup, session stuck busy)
- **Pi does:** `dispose()` aborts agent + retry + compaction + branch-summary + bash + extensions, disconnects listeners, cleans up session resources (`agent-session.ts:728-745`). The runtime tears down the session on switch/fork/new/resume (`agent-session-runtime.ts:167-175`).
- **We do:** The WS `close` handler deletes `connectionStores`/`wsConnections` and closes terminals (`apps/server/src/agent/ws.ts:114-125`) but **never aborts the active run**. `runAgentStream` is fire-and-forget (`ws-handler.ts:67-93, 147`); after socket close it keeps streaming the LLM and executing tools, burning tokens, and `ws.send` failures are swallowed by the `.catch(()=>{})`. The run stays registered in the module-global `activeRuns` map (`runner.ts:13, 31`), so the session is permanently "busy" — any later `prompt` for that sessionId gets `busyMessage` forever (`runner.ts:24-29`, `ws-handler.ts:143-146`).
- **Impact:** Disconnecting mid-run leaks a run per session, wastes provider tokens, and bricks the session until server restart. No path to recover.
- **Severity:** P1.

### P1-3. Model resolver has no fallback, no fuzzy match, no custom-model support
- **Pi does:** 5-tier resolution: CLI args → scoped models → session-restored → settings default → `defaultModelPerProvider` → first available (`model-resolver.ts:527-607`), with fuzzy/alias/glob matching (`tryMatchModel` `:124-154`, `parseModelPattern` `:192-245`), `buildFallbackModel` for ids not in the catalog (`:163-177`), and `restoreModelFromSession` with graceful degradation (`:612-681`). Uses `getAll()` (everything) so first-time setup works.
- **We do:** `resolveModel` does project-config → global-config → **throw** (`apps/server/src/agent/model-resolver.ts:13-34`). It calls `getModel(provider, modelId)` which throws if the exact id isn't in the static catalog. No fallback, no fuzzy, no custom-id path, no restore-from-session.
- **Impact:** Any model id not present verbatim in `pi-ai`'s `models.generated.ts` (a newly released model, a fine-tune, a self-hosted/gateway model, a typo) crashes `runPrompt` with an unhelpful error. No way to force a custom model id. No recovery if the configured model is removed upstream.
- **Severity:** P1.

### P1-4. No project-context / agents-files / skills injection machinery
- **Pi does:** `ResourceLoader` discovers and loads context files (CLAUDE.md, AGENTS.md, `.pi/agents/*`), skills, and prompt templates; `_rebuildSystemPrompt` injects them (`agent-session.ts:923-941`; `system-prompt.ts:60-67, 153-166`). Reloadable mid-session (`agent-session.ts:2446-2468`).
- **We do:** None. `buildTools` only constructs the 7 file tools from `cwd` (`apps/server/src/agent/tools-builder.ts:12-22`); `runPrompt` passes nothing project-specific to the loop (`runner.ts:82-143`). No file-discovery, no skill loading, no prompt-template expansion.
- **Impact:** Even after P0-1 is fixed, there is no code path to feed per-project instructions or skills to the model. The agent cannot honor repo conventions.
- **Severity:** P1.

---

## P2 — gaps, polish, missing features

### P2-1. Compaction REST route fails when the model comes from the global default
- **Pi does:** Compaction resolves auth from the *effective* model via `_getCompactionRequestAuth(this.model)` (`agent-session.ts:1663, 1925`), and the effective model is always the one in `agent.state.model`.
- **We do:** `POST /api/sessions/:id/compact` calls `resolveModel(ctx, session)` (which correctly falls back to global) but then **re-derives** the provider from `ctx.repos.models.getForProject(session.projectId)` alone (`apps/server/src/routes/compaction.ts:27-28`). If only a global default is configured, `config` is null → `provider = ""` → `getEnvApiKey("")` is undefined → returns 500 "No API key for  in env", even though `resolveModel` succeeded and a key exists.
- **Impact:** Manual compaction 500s for any session relying on the global model default. Fix is one line: use the `provider` already returned by `resolveModel`.
- **Severity:** P2 (clear bug, narrow trigger).

### P2-2. Compaction is uninterruptible and emits no events (route); loop compaction is hard-gated on env key
- **Pi does:** `compact()`/`_runAutoCompaction()` are abortable via dedicated `_compactionAbortController`, emit `compaction_start`/`compaction_end` with reason/aborted/willRetry, support `customInstructions`, extension override, and a graceful degrade (`agent-session.ts:1652-1784, 1904-2068`).
- **We do:** The compact route calls `compactMessages` with no `signal` (`routes/compaction.ts:36-42`) — uninterruptible. Loop auto-compaction is gated on `resolved.apiKey` being truthy (`runner.ts:110`, `loop/index.ts:110`); since pi-ai auto-resolves env keys (`pi-ai stream.ts:18-26,54-61`), this gate only matters when no env key exists — but then it silently disables compaction rather than letting `completeSimple` resolve or fail. `compactMessages` returns the same array on no-op (`compaction.ts:223-224, 251-253`), which is fine, but there's no `willRetry`/overflow-recovery semantics (ties to P1-1).
- **Impact:** No way to cancel a long compaction; behavior diverges from pi's abortable, event-driven flow.
- **Severity:** P2.

### P2-3. No queue introspection / `queue_update` events
- **Pi does:** `AgentSession` tracks `_steeringMessages`/`_followUpMessages`, emits `queue_update` events, exposes `pendingMessageCount`, `getSteeringMessages()`, `getFollowUpMessages()`, `clearQueue()` (`agent-session.ts:277-279, 475-481, 1392-1415`).
- **We do:** Queues live privately inside `createAgentLoop` (`packages/agent/src/loop/index.ts:27-28`); no events, no counts, no clear. `AgentEvent` has no `queue_update` variant (`packages/agent/src/types.ts:193-207`). WS `steer`/`followUp` messages call `loop.steer/followUp` directly (`ws-handler.ts:118-134`) with no feedback to the client.
- **Impact:** A client cannot render "N steers queued" or restore queued text on abort.
- **Severity:** P2.

### P2-4. `streamingBehavior` semantics absent on prompt
- **Pi does:** `prompt()` requires `streamingBehavior: "steer" | "followUp"` when called while streaming and routes accordingly (`agent-session.ts:1042-1055`, `PromptOptions:200-211`).
- **We do:** Separate top-level `steer`/`followUp` WS message types exist (`ws-handler.ts:24-34`), but a `prompt` while busy is rejected with `busyMessage` (`ws-handler.ts:143-146`). There is no single-call "prompt-and-queue-as-followUp" path. Functionally acceptable for our transport, but diverges from pi's API surface.
- **Impact:** Minor — clients must use explicit steer/followUp frames.
- **Severity:** P2.

### P2-5. No tool hooks, no extension/MCP tools, no per-tool prompt snippets
- **Pi does:** Wires `agent.beforeToolCall`/`afterToolCall` for extension interception (`agent-session.ts:415-462`), has a full extension + custom-tool registry with allow/deny lists and per-tool `promptSnippet`/`promptGuidelines` (`agent-session.ts:2299-2390`, fed into `_rebuildSystemPrompt` `:909-921`).
- **We do:** `AgentTool` has no hook surface (`packages/agent/src/types.ts:87-97`); `buildTools` returns only the 7 static built-ins (`tools-builder.ts`). No MCP, no extension tools, no per-tool prompt text (compounds P0-1 — even the tool list/guidelines pi puts in the system prompt don't exist here).
- **Impact:** No extensibility; cannot add project-specific or MCP tools.
- **Severity:** P2.

### P2-6. Assistant message fidelity lost on DB round-trip (thinking blocks, multi-block text)
- **Pi does:** Session manager persists typed tree entries preserving full message structure (`session-manager.ts`, pi.md:222-240).
- **We do:** `SqliteSessionStore` flattens assistant content to `row.content = textParts.join("")` and stores toolcalls separately (`session-store.ts:198-215`); on load it rebuilds `content = [{text}, ...toolCalls]` (`session-store.ts:114-131`), **dropping** `thinking` blocks and any multi-text-block structure. Tool-result ordering across the user→assistant→tool boundary is preserved only by `createdAt`.
- **Impact:** Reasoning/thinking content is lost across session reload, fork, and compaction-text-serialization. Potential ordering fragility for interleaved text/toolcall sequences.
- **Severity:** P2.

### P2-7. No model-change / thinking-level-change / compaction entries; re-resolved fresh each run
- **Pi does:** Appends `model_change`, `thinking_level_change`, and `compaction` entries to the session (`agent-session.ts:1461, 1557, 1734`); on resume, restores model/thinking from session history (`sdk.ts:194-242`).
- **We do:** `runPrompt` resolves model from DB config every run (`runner.ts:98`) and thinking level from settings/session row (`runner.ts:108-116`). No session-history entries for these transitions; `SqliteSessionStore` has no entry types. Model and thinking level are not part of the persisted session narrative.
- **Impact:** A session resumed on a different project/global model config silently switches models with no record; pi captures and restores the exact model/thinking in use.
- **Severity:** P2.

### P2-8. Settings scope is flat KV; no compaction/retry/timeout tuning
- **Pi does:** `SettingsManager` does global+project deep-merge with migration and lockfiles; exposes `compaction.{enabled,reserveTokens,keepRecentTokens}`, `retry.{enabled,maxRetries,baseDelayMs,provider.{timeoutMs,maxRetries,maxRetryDelayMs}}`, `httpIdleTimeoutMs`, `websocketConnectTimeoutMs`, etc. (`settings-manager.ts:754-834`, `Settings:80-123`).
- **We do:** Global settings are flat string KV (`routes/settings.ts`); session settings are a fixed 6-key set (`routes/session-settings.ts:5-12`, mirrored in `runner.ts:58-65`). `reserveTokens`/`keepRecentTokens`/`retryBaseDelayMs` are hardcoded in `createAgentConfig` (`packages/agent/src/types.ts:286-295`). No project-scoped settings, no provider retry/timeout config threaded into the stream call (our `streamSimple` options at `streaming.ts:212-221` pass only `signal`/`reasoning` — no `timeoutMs`/`maxRetries`/`maxRetryDelayMs`).
- **Impact:** No operator tuning of compaction/retry windows; pi-ai SDK client defaults apply unchecked.
- **Severity:** P2.

### P2-9. Available-models catalog not auth-filtered
- **Pi does:** `getAvailable()` returns only models with configured auth (`hasConfiguredAuth`); `getApiKeyAndHeaders` is the auth boundary (`sdk.ts:302`, model-registry).
- **We do:** `GET /api/available-models` returns the full static catalog via `getProviders()`/`getModels(provider)` with no auth filtering (`routes/available-models.ts:7-9`).
- **Impact:** Model-picker UIs must filter client-side or show models the user cannot actually use.
- **Severity:** P2.

### P2-10. Abort is fire-and-forget; no wait-for-idle, no per-operation abort
- **Pi does:** `abort()` aborts retry/compaction/branch/bash, calls `agent.abort()`, then **awaits** `agent.waitForIdle()` (`agent-session.ts:1424-1428`).
- **We do:** `abortRun` calls `controller.abort()` and returns a boolean immediately (`runner.ts:43-50`). No wait-for-idle; a steer aborts the running tool via a combined signal (`loop/index.ts:229-230`, good), but the caller has no guarantee the run has unwound before issuing the next prompt (mitigated only by the `registerRun`/`unregisterRun` finally block at `runner.ts:138-142`).
- **Impact:** Race window between abort and the next prompt; clients can't know when the session is truly idle.
- **Severity:** P2.

---

## Cross-cutting note (not a separate finding)
`runPrompt` reconstructs a fresh `AgentLoop` per call (`runner.ts:120-132`) rather than holding a long-lived session object as pi's `AgentSession` does. This is the root cause behind several findings above: queue state, model/thinking transitions, abort controllers, and extension runners all live for a single prompt in our design vs. the lifetime of a session in pi. Converging toward a per-session loop object would naturally resolve P2-3, P2-7, and parts of P1-2 and P2-10.
</task_result>
</task>
```

---
