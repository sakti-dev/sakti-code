## Why

`server-rest-api` exposes state over REST, but the agent itself can't run yet — there's no real-time surface for token streaming, tool execution, or abort. This change adds the WebSocket layer that makes the agent *come alive*: a `prompt` message spins up an ephemeral agent loop (model resolution + per-cwd tools + session store) and streams `AgentEvent`s back as frames; an `abort` message kills it. It is the riskiest of the four server changes because it exercises model resolution, the in-process loop under concurrency, the WS internals, and the `SqliteSessionStore` under real streaming — and it is the change that proves the whole architecture works.

## What Changes

- Create `apps/server/src/agent/` — the one folder promoted for cohesion (4 mutually-dependent files):
  - `model-resolver.ts` — `resolveModel(ctx, session)`: reads the project's `ModelConfigRepo` row (falls back to global default) and calls pi-ai `getModel(provider, modelId)`. API keys come from env (pi-ai reads them); the DB stores only provider+modelId.
  - `tools-builder.ts` — `buildTools(cwd)`: constructs the 7 `@sakti-code/tools` factories scoped to the project cwd. Fresh per prompt (tools capture cwd — isolation between concurrent projects depends on this).
  - `runner.ts` — `runPrompt(ctx, sessionId, message, signal)`: an `AsyncGenerator<AgentEvent>` that resolves session+project, builds the model+tools+store, constructs an ephemeral `createAgentLoop`, and `yield*`s its `prompt()` stream. Also owns the `activeRuns` `Map<sessionId, AbortController>` with `registerRun`/`unregisterRun`/`abortRun`.
  - `ws.ts` — the Elysia `.ws("/ws")` handler. Inbound: `{type:"prompt", sessionId, message}` and `{type:"abort", sessionId}`. Outbound: `{type:"event", sessionId, event}` and `{type:"error", sessionId, message}`. The prompt handler is **fire-and-forget** (does not await the stream) so multiple prompts on one connection run concurrently.
- Register the WS route via `buildServer`'s array-composition (from `server-rest-api`) — this change adds `buildWsApp()` to the routes array, no edit to the foundation's `index.ts`.
- Add an end-to-end integration test proving **multi-session concurrency**: two prompts on two different projects over two WS clients, each persisting its own messages with no cross-contamination.

## Capabilities

### New Capabilities
- `agent-streaming`: The real-time WebSocket surface for running the agent loop — model resolution from stored config, per-cwd tool construction, the ephemeral per-prompt runner with abort registry, the WS prompt/abort protocol, and the multi-session concurrency guarantee. This is the change that exercises the agent package end-to-end against the DB.

### Modified Capabilities
<!-- None. This consumes `server-rest-api` (its buildServer + ServerContext + makeApp helper) and `packages/agent` (createAgentLoop, AgentEvent, types) without changing their requirements. -->

## Impact

- **New code**: `apps/server/src/agent/` (4 files + `__tests__/`). An e2e test at `apps/server/src/__tests__/e2e.test.ts`.
- **Dependencies**: no new deps. Uses existing `@sakti-code/agent` (`createAgentLoop`, `AgentEvent`, `AgentTool`, `AnyModel`), `@sakti-code/db` (`SqliteSessionStore`), `@sakti-code/tools` (7 factories), `@earendil-works/pi-ai` (`getModel`). Elysia's `.ws()` ships with elysia.
- **Consumes `server-rest-api`**: `buildServer` route-composition + `ServerContext` + `makeApp()` test helper. This change MUST NOT edit the foundation's `index.ts` (it registers via the routes array).
- **Runtime**: WebSocket at `/ws`. Active runs tracked in an in-process `Map` (does not survive restart — correct, since an active run shouldn't outlive the server process).
- **Out of scope (deferred)**: wiring `thinkingLevel`/`maxRetries` through to `streamSimple` (separate agent-domain change); cost recording from usage events (can be added without changing this contract).
