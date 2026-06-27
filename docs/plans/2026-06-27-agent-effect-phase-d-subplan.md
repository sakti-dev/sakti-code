# Phase D Sub-Plan: agent-loop.ts → Effect

> Parent plan: `docs/plans/2026-06-27-agent-effect-full-effect-migration.md` (Phase D)
> Scope: `packages/agent-effect/src/loop/agent-loop.ts` (1125 lines, 10 functions)

## Current structure

```
agentLoop()           → fire-and-forget wrapper, returns EventStream
agentLoopContinue()   → same, for continue path
runAgentLoop()        → async, emits agent_start + prompts, calls runLoop
runAgentLoopContinue()→ same, for continue path
runLoop()             → 160-line while loop (the core)
streamAssistantResponse() → 236 lines, consumes LLM fullStream
executeToolCalls()    → dispatcher (seq vs parallel)
executeToolCallsSequential() → 72 lines
executeToolCallsParallel()   → 116 lines
prepareToolCall()     → 135 lines (preflight)
executePreparedToolCall()  → 47 lines
finalizeExecutedToolCall() → 47 lines
```

All are async/await with Promise-based `AgentLoopConfig` callbacks (~15 callbacks).

## Conversion strategy: inside-out, 5 steps

Each step ships green. The public API (`agentLoop` → `EventStream`) stays unchanged until step 5.

### Step D.1: Effect facade for runAgentLoop/runAgentLoopContinue
- Add `runAgentLoopEffect` / `runAgentLoopContinueEffect` returning `Effect.Effect<AgentMessage[]>`
- Internally: `Effect.gen` wrapping the existing `await emit()` calls + `runLoop` via `Effect.promise`
- Keep existing Promise functions as wrappers
- **Risk:** minimal (just wrapping). **Value:** Effect API available for callers.

### Step D.2: Convert runLoop internals to Effect.gen
- `runLoop` → `runLoopEffect` returning `Effect.Effect<void>`
- Replace `await config.getX()` → `yield* Effect.promise(() => config.getX() ?? Promise.resolve([]))`
- Replace `await streamAssistantResponse()` → `yield* streamAssistantResponseEffect()`
- Replace `await executeToolCalls()` → `yield* executeToolCallsEffect()`
- Keep Promise wrapper: `runLoop = (..) => Effect.runPromise(runLoopEffect(..))`
- **Risk:** medium (160 lines of loop logic). **Value:** structured control flow.

### Step D.3: Convert streamAssistantResponse to Effect
- `streamAssistantResponse` → `streamAssistantResponseEffect`
- Replace `streamFn(req)` with `yield* StreamProvider.stream(req)` (optional — can keep streamFn for now)
- Replace `for await (const part of fullStream)` with `Effect.async` or `Stream.fromAsyncIterable`
- **Risk:** high (236 lines, streaming logic, error handling). **Value:** StreamProvider integration.

### Step D.4: Convert tool execution to Effect
- `executeToolCalls`, `executeToolCallsSequential`, `executeToolCallsParallel`, `prepareToolCall`, `executePreparedToolCall`, `finalizeExecutedToolCall`
- Replace `await config.beforeToolCall()` → `yield* Effect.promise(...)`
- Replace `Promise.all` for parallel tools → `Effect.all`
- Replace permission flow → `Effect.service`-based (or keep as Effect.promise wrappers)
- **Risk:** medium. **Value:** parallel tool prep, structured permission flow.

### Step D.5: Convert EventStream → Stream (optional, deferred)
- Replace `EventStream<AgentEvent, AgentMessage[]>` return type with `Stream<AgentEvent, AgentError, R>`
- Convert `agentLoop`/`agentLoopContinue` fire-and-forget → `Effect.fork` + `Stream`
- **Risk:** very high (breaks all consumers). **Value:** native Effect streaming, structured interrupt.
- **Decision: DEFER** until Phase E (agent.ts) and Phase Harness are ready to consume Stream.

## What this phase does NOT do (deferred)
- AgentLoopConfig callbacks → service tags (Phase Harness)
- EventStream → Stream (step D.5, deferred)
- AbortSignal → Fiber.interrupt (Phase Harness)
- Perf P1/P2/P8 (folded into Phase Harness where the callers live)

## Bug fixes integrated
- **C6:** Effect.gen has no `Promise.all` masking footgun (step D.4 uses `Effect.all` which propagates errors correctly)
