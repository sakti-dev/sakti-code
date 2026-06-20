## Context

Three interlocking defects in `executeToolCalls` (`packages/agent/src/loop/tool-execution.ts`), verified against pi's `executeToolCallsSequential`/`executeToolCallsParallel` (`openspec/references/pi/packages/agent/src/agent-loop.ts:380-516`). Full evidence in `docs/plans/2026-06-20-agent-runtime-pi-alignment.md` (Tasks 3, 7, 10). They bundle because T7's parallel rewrite is the natural vehicle for T3 (terminate) and T10 (abort-breaks-batch), and because the plan's T7 sketch was architecturally wrong.

**pi's tool-execution structure (the load-bearing reference).** pi dispatches (`agent-loop.ts:380-385`):

```ts
const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
const hasSequentialToolCall = toolCalls.some(
    (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
);
if (config.toolExecution === "sequential" || hasSequentialToolCall) {
    return executeToolCallsSequential(...);
}
return executeToolCallsParallel(...);
```

**`executeToolCallsSequential`** (`:395-448`): a `for (const toolCall of toolCalls)` loop. Per iteration: emit `tool_execution_start` (with `args`), prepare+execute, emit `tool_execution_end` (`emitToolExecutionEnd`), emit `message_start`/`message_end` for the result (`emitToolResultMessage`), push to `messages`. **`if (signal?.aborted) break;`** at the end of each iteration (T10). Returns `{ messages, terminate: shouldTerminateToolBatch(finalizedCalls) }`.

**`executeToolCallsParallel`** (`:456-516`) — pi's two-phase design (this is what the plan's naive `Promise.all` sketch got wrong):
- **Phase 1 (sequential prepare loop):** `for (const toolCall of toolCalls)` — emit `tool_execution_start`, prepare. If the preparation is `immediate` (synchronous outcome), finalize inline, emit `tool_execution_end`, push to `finalizedCalls`, `if (signal?.aborted) break;`, `continue`. Otherwise push an **async thunk** onto `finalizedCalls` (the thunk, when called, executes the tool, finalizes, emits `tool_execution_end`, and returns the finalized result). `if (signal?.aborted) break;` after pushing the thunk.
- **Phase 2:** `const orderedFinalizedCalls = await Promise.all(finalizedCalls.map(entry => typeof entry === "function" ? entry() : Promise.resolve(entry)));` — executes all thunks concurrently, preserves original order.
- **Phase 3 (sequential finalize loop):** `for (const finalized of orderedFinalizedCalls)` — build the tool-result message, emit `message_start`/`message_end` (`emitToolResultMessage`), push to `messages`.
- Returns `{ messages, terminate: shouldTerminateToolBatch(orderedFinalizedCalls) }`.

**`shouldTerminateToolBatch`** (`:544-546`): `finalizedCalls.length > 0 && finalizedCalls.every(f => f.result.terminate === true)` — the AND semantics (T3).

**Our current code (the divergences):**
- `tool-execution.ts:24-90` — a single sequential `for (const tc of toolCalls)` loop. No parallel path. No `signal?.aborted` break (T10 missing).
- `tool-execution.ts:82-84` — `if (result.terminate) shouldTerminate = true` — OR semantics (T3 wrong).
- `types.ts:278` — `toolExecutionMode: input.toolExecutionMode ?? "parallel"` — default is parallel, but `executeToolCalls` doesn't receive or honor it.
- `index.ts:201-208` — calls `executeToolCalls(...)` without the mode.
- Our `AgentTool` interface (`types.ts`) has no `executionMode` per-tool override and no immediate/prepared distinction — our tools are always "prepared" (always `await tool.execute(...)`). This simplifies the port: pi's immediate-vs-prepared branch collapses to always-prepared.

## Goals / Non-Goals

**Goals:**
- T3: batch terminates only when ALL tool results request it (pi `shouldTerminateToolBatch`).
- T7: parallel mode actually runs tool calls concurrently, following pi's two-phase structure (prepare-loop → `Promise.all` → ordered finalize-loop).
- T10: abort (steer or caller) breaks the batch — remaining tools skipped; completed results kept.
- Preserve all existing single-tool behavior (C4b/C4c steer-abort, terminate=true, event ordering).

**Non-Goals:**
- **pi's per-tool `executionMode?: ToolExecutionMode` override** (`agent-loop.ts:382`, `types.ts:388`): pi downgrades the whole batch to sequential if ANY tool in it declares `executionMode: "sequential"`. Our `AgentTool` interface has no such field; our tools don't declare it. Adding it would be a `tools-builder.ts` + interface change touching every tool, for a flag no tool sets. **Deferred as a documented trigger** — if a tool ever needs sequential-only, add the field + the `hasSequentialToolCall` check then. For now, the dispatch uses only the config-level `toolExecutionMode`.
- **pi's `immediate` vs `prepared` preparation distinction** (`agent-loop.ts:416, 470`): pi has tool outcomes that finalize synchronously without execution (the `immediate` kind). Our tools are always `await tool.execute(...)` (always "prepared"). The immediate branch in pi's structure is a no-op for us; we port only the prepared/thunk path. Stated explicitly, not silently dropped.
- **pi's `prepareArguments` shim** (`types.ts:373`, `agent-loop.ts:549-557`): argument preprocessing before schema validation. Our tools don't have it; out of scope.
- **pi's `AgentToolResult<TDetails>` generic + `details` field.** Our `AgentToolResult` is `{content, isError?, terminate}`. pi's carries typed `details` for richer UI. Distinct concern; out of scope.
- **Event-ordering guarantees in parallel mode beyond per-tool grouping.** pi's parallel mode interleaves events from concurrent tools; we accept the same (each event carries `toolCallId` for disambiguation). We do NOT promise a global ordering across concurrent tools.
- **`args` on `tool_execution_start`.** pi emits `args: toolCall.arguments` on `tool_execution_start` (`:401, 464`). Our `ToolExecutionStartEvent` has no `args` field. Adding it is a separate event-shape change; noted, out of scope here.

## Decisions

### 1. Follow pi's two-phase parallel structure, not naive `Promise.all`

**Decision:** Port pi's `executeToolCallsParallel` structure: Phase 1 sequential prepare-loop (emit `tool_execution_start`, build the execution thunk, `if (signal?.aborted) break;`); Phase 2 `Promise.all` of thunks; Phase 3 ordered finalize-loop. The thunk captures per-tool and, when invoked, runs `tool.execute(...)`, emits `tool_execution_update` (via `onUpdate`) and `tool_execution_end`, and returns the finalized result.

**Rationale:** pi's structure solves two problems a naive `Promise.all` does not: (a) **abort-break in the prepare loop** (T10) — if the signal aborts while preparing tool N, tools N+1..end are never prepared, so never executed; a naive `Promise.all` would prepare all upfront and race-abort them; (b) **ordered results** — `Promise.all` preserves array order, so `shouldTerminateToolBatch` and the finalize-loop see results in tool-call order regardless of completion order. This is the proven design; deviating would re-introduce the bugs pi already solved.

**Alternatives considered:**
- *Naive `Promise.all(toolCalls.map(async tc => execute(tc)))` (the plan's sketch).* **Rejected:** no abort-break in prepare (T10 lost); requires buffering events per-tool and flushing after (the plan hand-waved this as "hardest change" — pi already solved it by emitting `tool_execution_start` in the prepare loop and results in the finalize loop). Following pi removes the "hardest" framing entirely.
- *Sequential-only, drop parallel.* **Rejected:** `toolExecutionMode: "parallel"` is the documented default; dropping it breaks the config contract. T7 is a real missing-pattern.

### 2. Port the "thunk" pattern faithfully — emit `tool_execution_start` in prepare, results in finalize

**Decision:** Mirror pi's split exactly:
- **Prepare loop (sequential):** for each tool call, `yield evt("tool_execution_start", {toolCallId, toolName})`, then push a thunk. The thunk, when called, does the `await tool.execute(...)` (with `onUpdate` yielding `tool_execution_update`), catches errors (our existing error→`isError` logic), and `yield`s `tool_execution_end` — returning the finalized `{tc, result}`. `if (signal?.aborted) break;` after each prepare.
- **`Promise.all`:** `const results = []; for await ... ` — since we're an async generator, we cannot literally `Promise.all` thunks that `yield`. **Resolution:** the thunks are themselves async generators (or we collect events per-thunk into arrays and flush). The clean port: each thunk is an `async function*` yielding its events and returning the finalized result; we kick them all off, but since `yield*` is sequential we need to interleave. **Faithful-but-pragmatic resolution:** run the thunks via `Promise.all` returning `{events: AgentEvent[], result}` tuples (each thunk buffers its own events into an array as it runs, since mid-`Promise.all` we cannot `yield` to the outer generator); then in Phase 3, flush each thunk's buffered events in order and build the message. This preserves pi's semantics (concurrent execution, ordered output, per-tool event grouping) within our async-generator constraint.

**Rationale:** Our `executeToolCalls` is an `async function*` (yields events to the loop). pi's is a plain `async function` with an `emit` callback — pi can `emit` from anywhere, including inside `Promise.all`. We cannot `yield` from inside a `Promise.all` callback. The buffer-per-thunk + ordered-flush is the faithful translation: execution is concurrent (the `Promise.all` actually runs the thunks in parallel), output is ordered and per-tool-grouped (we flush thunk[0]'s events, then thunk[1]'s, etc., in tool-call order). The only divergence from pi is *when* events are yielded to the outer generator (pi yields live as tools run; we yield buffered-in-order after all complete) — an acceptable divergence given the async-generator constraint, documented as such.

**Alternatives considered:**
- *Make `executeToolCalls` a plain async function with an emit callback (match pi's signature exactly).* **Rejected:** ripples through the loop (`index.ts` does `yield* executeToolCalls(...)`); would force the whole loop to adopt pi's `emit` callback model (the `AgentEventSink` Non-Goal). Large refactor, out of scope.
- *Sequential-only event emission in parallel mode (no interleaving).* **Accepted as the consequence of buffer-and-flush** — events come out grouped per-tool in order, not interleaved live. This is a *stricter* ordering than pi (pi interleaves), so consumers that handle pi's interleaving handle ours trivially.

### 3. `shouldTerminateToolBatch` helper mirroring pi (applies to both paths)

**Decision:** Extract `function shouldTerminateToolBatch(results: {terminate: boolean}[]): boolean { return results.length > 0 && results.every(r => r.terminate === true); }`. Use it in both the sequential and parallel return paths. Replace the `if (result.terminate) shouldTerminate = true` accumulator.

**Rationale:** This is pi's exact function (`agent-loop.ts:544-546`). Extracting it as a named helper makes the AND semantics explicit and testable in isolation, and applies identically to both paths (DRY). The `length > 0` guard means an empty batch (no tool calls — shouldn't happen since the loop only calls `executeToolCalls` when `toolCalls.length > 0`, but defensive) does not terminate.

**Alternatives considered:**
- *Inline `results.every(r => r.terminate)`.* **Rejected:** duplicates across two paths; the named helper is clearer and matches pi's structure.

### 4. Abort-break in both paths (T10)

**Decision:** In the sequential `for…of`, after each tool completes (after `store.appendMessage`), `if (signal?.aborted) break;`. In the parallel prepare-loop, after each `tool_execution_start` + thunk-push, `if (signal?.aborted) break;`. Already-completed tool results (sequential) / already-pushed thunks (parallel, which then run in `Promise.all`) are kept.

**Rationale:** pi does exactly this (`agent-loop.ts:444-446` sequential, `:489-491` parallel-prepare). The break skips remaining tools; completed work persists. In parallel mode, the `Promise.all` still runs all pushed thunks (those prepared before the abort) — pi does the same; an abort between prepare-of-tool-2 and prepare-of-tool-3 means tool-3+ never prepare/execute, but tools 1-2 run to completion concurrently.

**Alternatives considered:**
- *Abort immediately cancels in-flight tools (via the signal).* **Already the case:** the `toolSignal` is threaded into `tool.execute(..., signal)`, so a tool that respects the signal aborts mid-flight (C4b/C4c). The break here is about not *starting* remaining tools after the abort — complementary, not redundant.

## Risks / Trade-offs

- **[Parallel mode changes timing for multi-tool batches]** → **Accepted / intended:** multi-tool batches now run concurrently. This is the behavior `toolExecutionMode: "parallel"` always promised. Single-tool batches (the common case, and all existing tests) are unaffected. Tests asserting sequential timing for multi-tool batches would need updating — verified no such test exists (existing multi-tool tests use `callCount`-based mocking, not timing).
- **[Buffer-and-flush diverges from pi's live event emission in parallel mode]** → **Accepted / documented:** in parallel mode, we yield events grouped-per-tool-in-order after `Promise.all`, whereas pi yields them live (interleaved) as tools run. Our ordering is stricter (a consumer handling pi's interleaving handles ours). The divergence is forced by our async-generator constraint (cannot `yield` from inside `Promise.all`). The *execution* is genuinely concurrent; only *event delivery* is batched-ordered.
- **[Steer-abort in parallel mode aborts the whole batch]** → **Accepted / pi-consistent:** `combineSignals` threads one `toolSignal` to all tools; a steer aborts all in-flight tools and (via the prepare-loop break) prevents unprepared tools from starting. pi's behavior is equivalent (one signal, batch abort). C4b/C4c single-tool tests stay green (single tool = both paths equivalent).
- **[T3 AND-semantics changes termination for mixed-terminate batches]** → **Accepted / correct:** a batch where tool A sets `terminate: true` and tool B sets `terminate: false` previously terminated (OR); now continues (AND). This is the bug fix. A batch where ALL tools set `terminate: true` still terminates (unchanged).
- **[`onUpdate` events buffered in parallel mode]** → **Accepted:** in parallel mode, a tool's `tool_execution_update` events are buffered into its thunk's event array and flushed in Phase 3, not yielded live. A UI showing live progress for parallel tools would see grouped updates, not live streaming. Acceptable for our current (no-UI) consumer; if live parallel progress is needed, revisit the buffer-and-flush decision.

## Migration Plan

No migration. Pure runtime behavior change in `packages/agent/src/loop/`; no schema, route, event-shape (events themselves are unchanged — same types, same payloads), or persisted-data change. `toolExecutionMode` config is unchanged (still defaults to `"parallel"`; now actually honored). Rollback is reverting the commits.

## Open Questions

- Should we add the per-tool `executionMode` override now (pi `types.ts:388`)? **Decision: no** — no tool declares it; adding the field + the `hasSequentialToolCall` check is dead code until a tool opts in. Documented trigger: when a tool needs sequential-only, add the field to `AgentTool`, thread it through `tools-builder.ts`, and add the `hasSequentialToolCall` downgrade check (one line in the dispatch).
- Should `tool_execution_start` carry `args` (pi `:401`)? **Decision: no for this change** — our `ToolExecutionStartEvent` lacks the field; adding it is a separate event-shape change. Noted.
- In parallel mode, should we emit a `tool_batch_start`/`tool_batch_end` bracket? **Decision: no** — pi doesn't; the per-tool `tool_execution_start`/`end` + the existing `turn_start`/`turn_end` suffice. YAGNI.
