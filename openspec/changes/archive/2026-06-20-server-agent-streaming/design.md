## Context

`server-rest-api` provides typed REST over the repos but nothing runs the agent. The `packages/agent` loop is a pure async generator — `createAgentLoop(config).prompt(message, signal): AsyncIterable<AgentEvent>` — that depends only on an injected `SessionStore` and `tools[]`. `SqliteSessionStore(db)` is the store impl. `@sakti-code/tools` provides 7 cwd-scoped factories. `@earendil-works/pi-ai` provides `getModel(provider, modelId)` (static registry; API keys from env).

This change wires those into a WebSocket surface. The design's load-bearing concerns are: (a) the loop must be **ephemeral per prompt** (no singleton, no persistent process — that's what makes us lighter than PiBun, which spawns a subprocess per session), (b) **concurrency must work on a single connection** (two projects open in two tabs over one WS), and (c) **abort must reach the loop**.

## Goals / Non-Goals

**Goals:**
- `runPrompt` — an `AsyncGenerator<AgentEvent>` that constructs a fresh loop per prompt (model + cwd-scoped tools + store) and forwards the loop's events.
- A WS protocol with exactly two inbound message types (prompt, abort) and two outbound (event, error).
- Fire-and-forget prompt handling so the WS `message` callback returns immediately, enabling same-connection concurrency.
- An abort registry (`Map<sessionId, AbortController>`) so `abort` signals the running loop's `AbortSignal`.
- An e2e test proving two concurrent sessions on two projects persist independently.

**Non-Goals:**
- REST CRUD — done in `server-rest-api`. This change adds only the WS route via route composition.
- Cost recording from usage events — can be layered on later without changing this contract.
- Per-session config wiring (thinkingLevel → streamSimple, per-session maxRetries) — separate agent-domain change.
- Session forking, steering, user-bash, interactive terminals — v1.5.
- Crash isolation across sessions (a throw is caught per-run; full process isolation would require worker threads, out of scope).

## Decisions

### 1. The loop is ephemeral per prompt
**Decision:** `runPrompt` constructs a fresh `createAgentLoop(...)` on every call and the loop dies when the generator completes. **Alternative considered:** a persistent loop registry keyed by sessionId (closer to PiBun's process-per-session model). **Rejected:** a persistent loop pins the `messages` array in memory for the session's lifetime and serializes prompts on the same session. The ephemeral model loads messages fresh per prompt (`store.loadMessages`) and GCs them when the prompt ends — verified by the `mem-bench` test in `packages/agent` (200-msg history retains only ~63KB after a prompt completes, vs Pi's permanent `Map`). The only long-lived state is the `Map<sessionId, AbortController>` for abort, which is correct because an active run should not survive a server restart.

### 2. Fire-and-forget in the WS message handler
**Decision:** the `message` callback does NOT `await` the stream — it calls `runAgentStream(...).catch(...)` and returns. **Alternative considered:** `await` the whole stream inside `message`. **Rejected — this is the concurrency bug:** WS `message` callbacks on a single connection are processed serially (one socket, one queue). Awaiting the full stream means a second prompt from the same client won't start until the first ends — serializing same-connection prompts and defeating the "two projects at once" use case. Fire-and-forget lets both streams interleave on the event loop. Each outbound frame carries `sessionId` so the client routes frames to the right conversation.

### 3. WS protocol: 2 in, 2 out
**Decision:** inbound `{type:"prompt", sessionId, message}` and `{type:"abort", sessionId}`; outbound `{type:"event", sessionId, event: AgentEvent}` and `{type:"error", sessionId, message}`. **Alternative considered:** PiBun's 51 WS methods including all CRUD. **Rejected:** CRUD is request/response = HTTP (done in `server-rest-api`). The only thing that genuinely streams is the agent loop, and `AgentEvent` (a 14-variant discriminated union from `packages/agent`) is already the complete wire payload — no translation layer, no mapper. Keeping the protocol this small is the explicit payoff of the REST/WS split.

### 4. Model resolution: stored config + env keys
**Decision:** `resolveModel(ctx, session)` reads `ModelConfigRepo.getForProject(projectId)` (falls back to `getGlobalDefault()`), then calls `getModel(provider, modelId)`. **Rationale:** the `model_configs` schema has no `apiKey` column — keys come from env (pi-ai reads `OPENAI_API_KEY` etc.). This matches the schema reality and keeps secrets out of the DB. **Cast at the boundary:** `getModel` is generic over literal provider/modelId types and won't accept runtime `string`s cleanly; cast `as never` → `AnyModel` at this one runtime-value boundary (biome `noExplicitAny` already suppressed on `AnyModel` in the agent package).

### 5. Tools built fresh per prompt from project cwd
**Decision:** `buildTools(cwd)` returns 7 new tool instances each call. **Rationale:** each tool closes over its `cwd`. Project A's `createBashTool("/proj/a")` and Project B's `createBashTool("/proj/b")` are independent objects; a bash call in A spawns with `cwd:"/proj/a"`. This cwd-scoping is the load-bearing isolation between concurrent projects — if tools captured a global cwd, two projects would cross-contaminate. Building fresh per prompt (not once per server) is cheap and removes any shared-state risk.

### 6. Abort via injected AbortSignal
**Decision:** `runPrompt` takes an `AbortSignal`; the WS handler creates an `AbortController` per prompt, registers it in `activeRuns`, and `abortRun(sessionId)` calls `.abort()`. The agent loop already honors `signal?.aborted` at every await point (verified — the infinite-loop bug fix `0e60327` added exactly this). The controller is removed in a `finally` block when the stream ends.

### 7. agent/ folder for cohesion
**Decision:** the 4 files live in `apps/server/src/agent/`, the only promoted folder. **Rationale:** model resolution, tool building, the runner, and the WS transport are mutually dependent and change together. Colocating them is real cohesion payoff; `model-resolver.ts` and `tools-builder.ts` are currently small seams that exist for the growth paths they unlock (per-provider keys, custom tool registration), not because 8-line files need their own module. WS lives with the runner it calls — transport + execution are one domain.

## Risks / Trade-offs

- **[WS internals are version-sensitive]** `ws.data.store.ctx` access, the `message(ws, msg)` signature, and how to drive the WS in tests (`app.config.websocket.message`) vary across Elysia versions. → **Mitigation:** the WS test drives the handler with an in-memory fake `{ send, data: { store: { ctx } } }`; a version mismatch surfaces as a failing test. If the body validator rejects the `type` union, widen to `t.String()` and narrow inside the handler. Notes in the plan.
- **[No cross-session crash isolation]** an unhandled throw could affect the process. → **Mitigation:** every run is wrapped in try/catch that emits an `error` frame; the `finally` always unregisters. Full isolation (worker threads) is out of scope.
- **[Abort doesn't survive restart]** the `activeRuns` map is in-process. → **Intentional:** an active agent run shouldn't outlive the server. On restart, orphaned runs simply don't exist.
- **[Same-session prompts can overlap]** fire-and-forget means two prompts on the *same* sessionId could run concurrently and both append messages. → **Mitigation for v1:** document as a client responsibility (don't send a second prompt on a session until the first `agent_end`). A server-side per-session lock is a candidate follow-up if it becomes a real problem; not added now because it would re-introduce serialization and complicate abort.
- **[Peak RAM during concurrent prompts]** each active loop holds its full `messages` array in RAM during a turn. → **Acceptable** for the 2-project target; bounded by compaction (`keepRecentTokens`). The mem-bench showed 2 concurrent prompts add ~nothing measurable over 1.
