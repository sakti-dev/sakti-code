## Why

Three interlocking correctness defects in `executeToolCalls` (`packages/agent/src/loop/tool-execution.ts`), all verified against pi's `executeToolCallsSequential`/`executeToolCallsParallel` (`openspec/references/pi/packages/agent/src/agent-loop.ts:380-516`). They bundle because T7's parallel-mode rewrite is the natural place to fix T3 (terminate) and T10 (abort-breaks-batch) — and because T7's plan sketch was **wrong** (naive `Promise.all`), so doing them together lets the rewrite follow pi's actual two-phase structure rather than retrofitting pi-correct T3/T10 onto a wrong T7.

### The three defects

1. **T3 — `terminate` uses OR, pi uses AND (`shouldTerminateToolBatch`).** Our code (`tool-execution.ts:82-84`) sets `shouldTerminate = true` if ANY tool result has `terminate: true`. pi requires ALL results in a batch to terminate: `shouldTerminateToolBatch = finalizedCalls.length > 0 && finalizedCalls.every(f => f.result.terminate === true)` (`agent-loop.ts:544-546`). A single terminate-flagged tool in a multi-tool batch wrongly stops the whole turn.

2. **T7 — `toolExecutionMode: "parallel"` is the default but execution is always sequential.** `AgentConfig.toolExecutionMode` defaults to `"parallel"` (`types.ts:278`), but `executeToolCalls` (`tool-execution.ts:24`) is always a sequential `for…of`. Parallel tool calls (e.g. two independent reads) run one-after-the-other instead of concurrently. pi has a proven parallel implementation (`executeToolCallsParallel`, `agent-loop.ts:456-516`).

3. **T10 — abort does not break the batch.** Our `for…of` loop has no `signal?.aborted` check between tools; a steer-abort (or caller abort) that fires mid-batch still executes all remaining tools in the loop. pi checks `if (signal?.aborted) break;` after each tool in the sequential path (`agent-loop.ts:444-446`) and in the parallel prepare-loop (`:489-491`).

### Why T7's plan sketch is wrong, and why that matters for T3/T10

The plan's T7 sketched a naive `Promise.all(toolCalls.map(async tc => execute(tc)))` with "buffer updates per-tool and flush after completion." **pi's actual parallel design is a two-phase structure** (`agent-loop.ts:456-516`):
- **Phase 1 (sequential prepare loop):** for each tool call, emit `tool_execution_start`, prepare the call, and — for non-immediate tools — push an async thunk onto a list. Check `if (signal?.aborted) break;` here. (Immediate/synchronous tool outcomes are finalized inline.)
- **Phase 2 (`Promise.all`):** await all thunks concurrently (the actual parallel execution). Each thunk, when it runs, executes the tool and emits `tool_execution_end`. Updates inside `Promise.all` are emitted as they happen (concurrent event interleaving across tools is expected).
- **Phase 3 (sequential finalize loop):** for each finalized result IN ORIGINAL ORDER, build the tool-result message and emit `message_start`/`message_end` (via `emitToolResultMessage`). Compute `shouldTerminateToolBatch` over the ordered results.

This structure is what makes T3 (the `every()` AND) and T10 (the abort break) fall out naturally: `shouldTerminateToolBatch` operates on the ordered finalized list, and the abort break lives in the prepare loop. Retrofitting T3/T10 onto a naive `Promise.all` would either lose the abort-break (T10) or compute terminate over a race-prone set (T3). Doing the rewrite to follow pi is correct and makes the other two trivial.

## What Changes

- **T7 — Implement parallel mode following pi's two-phase structure.** In `executeToolCalls`, when `toolExecutionMode === "parallel"` AND there's more than one tool call, run pi's prepare-loop → `Promise.all` → finalize-loop structure. The sequential path (default for single tool calls, and when mode is `"sequential"`) keeps the current `for…of` (with the T3/T10 fixes applied). Each tool's `tool_execution_start` → `tool_execution_update`* → `tool_execution_end` events are grouped per-tool (in parallel mode, events from concurrent tools may interleave — that's pi's behavior and is acceptable since each event carries `toolCallId`).
- **T3 — `shouldTerminateToolBatch` AND semantics.** Replace the `if (result.terminate) shouldTerminate = true` accumulator with pi's `shouldTerminateToolBatch(finalizedCalls)`: `finalizedCalls.length > 0 && finalizedCalls.every(f => f.result.terminate === true)`. Applied to BOTH sequential and parallel paths.
- **T10 — abort breaks the batch.** In the sequential `for…of`, after each tool completes (and in the parallel prepare-loop, after each prepare), check `if (signal?.aborted) break;`. A steer-abort or caller-abort mid-batch stops executing remaining tools. Already-completed tool results are kept (their messages persisted).
- **Thread `toolExecutionMode` into `executeToolCalls`.** Currently `executeToolCalls` doesn't receive it; the loop (`index.ts:201-208`) calls it without the mode. Add the `toolExecutionMode` parameter and pass `resolved.toolExecutionMode`.

### No Breaking Changes

- **Sequential path is unchanged in observable behavior except T3 (AND terminate) and T10 (abort break).** T3 changes termination only for multi-tool batches where some-but-not-all tools set `terminate: true` (previously terminated, now continues) — this is a bug fix. T10 stops executing remaining tools after an abort — previously they ran (and their results were discarded if the loop then exited); now they don't run. Both are correctness fixes.
- **Parallel mode becomes the actual default behavior** (it was already the config default `"parallel"`, just not implemented). Single-tool batches run identically in both modes (the parallel path with one tool call is equivalent to sequential). Multi-tool batches now run concurrently where they previously ran sequentially — the intended behavior the config name promised.
- **Existing single-tool tests (C4b/C4c steer-abort, terminate=true, message ordering) remain valid** — they exercise single-tool batches where sequential and parallel are equivalent. Verified by reading the tests.
- **`AgentTool` interface is unchanged.** pi's per-tool `executionMode?: ToolExecutionMode` override and `prepareArguments`/immediate-vs-prepared distinctions are NOT added (see Non-Goals) — our tools don't declare them. The dispatch decision is the config-level `toolExecutionMode` only.

## Capabilities

### New Capabilities

_(None.)_

### Modified Capabilities

- `agent-streaming`: ADDS requirements — (1) tool-batch termination uses AND semantics (ALL tools must request terminate); (2) abort breaks the tool batch (remaining tools skipped after an abort); (3) when `toolExecutionMode` is `"parallel"`, multiple tool calls in one turn execute concurrently via pi's two-phase structure (prepare-loop → `Promise.all` → ordered finalize-loop), with the sequential path as default for `"sequential"` mode and single-tool batches.

## Impact

- **`packages/agent/src/loop/tool-execution.ts`** — the main rewrite: add `toolExecutionMode` param; implement pi's two-phase parallel path; replace terminate accumulator with `shouldTerminateToolBatch`; add `signal?.aborted` break in both paths. Extract a `shouldTerminateToolBatch(finalizedCalls)` helper mirroring pi (`agent-loop.ts:544-546`).
- **`packages/agent/src/loop/index.ts`** — pass `resolved.toolExecutionMode` to `executeToolCalls` (one line, at the existing call site ~line 201-208).
- **`packages/agent/src/__tests__/loop-behavior.test.ts`** — new tests: multi-tool batch AND-terminate (T3); parallel timing (two slow tools start within a tolerance, T7); abort-breaks-batch mid-batch (T10); parallel + abort interaction. Existing single-tool tests (C4b/C4c in `steer-behavior.test.ts`, terminate/echo in `loop-behavior.test.ts`) must remain green.
- **No DB / server / WS-format changes.** Confined to `packages/agent/src/loop/`.
- **Regression risk** — the steer-abort mechanism (`combineSignals`, `index.ts:199-200`) threads the same `toolSignal` into all tools; in parallel mode a steer-aborts-the-batch (acceptable — pi aborts the batch too). C4b/C4c single-tool abort tests must stay green. The `onUpdate` callback can yield mid-execution in sequential mode (the function is an async generator); in parallel mode, `onUpdate`-driven events are emitted as they fire during `Promise.all` (interleaved across tools — each carries `toolCallId`).
- **Dependencies** — none new; all within `packages/agent`.
