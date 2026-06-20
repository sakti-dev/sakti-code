## 1. agent/ folder — model-resolver + tools-builder + runner

- [ ] 1.1 Write failing test `apps/server/src/agent/__tests__/runner.test.ts` (mock `@earendil-works/pi-ai` `streamSimple`+`getModel` per `packages/agent/src/__tests__/loop.test.ts` pattern; assert valid-session run yields `agent_start`+`agent_end` and persists messages; assert unknown-session throws `/Session not found/`). Run → RED.
- [ ] 1.2 Create `apps/server/src/agent/model-resolver.ts` exporting `resolveModel(ctx, session)` (project config → `getGlobalDefault` fallback → throw if neither; `getModel(cfg.provider, cfg.modelId)` with boundary cast → `AnyModel`).
- [ ] 1.3 Create `apps/server/src/agent/tools-builder.ts` exporting `buildTools(cwd): AgentTool[]` (the 7 `create*Tool(cwd)` factories).
- [ ] 1.4 Create `apps/server/src/agent/runner.ts` exporting `runPrompt(ctx, sessionId, message, signal): AsyncGenerator<AgentEvent>` (resolve session+project → `resolveModel` → `buildTools(project.cwd)` → `new SqliteSessionStore(ctx.db)` → `createAgentLoop` → `yield* loop.prompt(message, signal)`). Add `activeRuns` map + `registerRun`/`unregisterRun`/`abortRun`.
- [ ] 1.5 Run runner test → GREEN. Typecheck + lint.

## 2. WebSocket handler

- [ ] 2.1 Write failing test `apps/server/src/agent/__tests__/ws.test.ts` (reuse the pi-ai mock; drive the WS `message` handler with an in-memory fake `{ send, data: { store: { ctx } } }`; assert a `prompt` produces an `event` frame carrying the right `sessionId` and `event.type:"agent_start"`; assert an unknown-session `prompt` produces an `error` frame). Run → RED.
- [ ] 2.2 Create `apps/server/src/agent/ws.ts` exporting `buildWsApp()` returning an `Elysia({name:"ws"}).ws("/ws", {...})`. Define `WsIn`/`WsOut` types. `message` handler: `abort` → `abortRun`; `prompt` → **fire-and-forget** `runAgentStream(...).catch(err => ws.send errorFrame)`. `runAgentStream` registers/unregisters via `finally`, sends `event` frames per yielded `AgentEvent`.
- [ ] 2.3 Run WS test → GREEN. Typecheck + lint.

## 3. Register via route composition

- [ ] 3.1 Write failing test that composes `buildServer` (from `server-rest-api`) with `buildWsApp()` and asserts the `/ws` endpoint responds — without editing the foundation's `index.ts`. Run → RED.
- [ ] 3.2 Add the route module to whatever composition surface `server-rest-api` exposes (routes array / barrel — use whatever it established). Do NOT edit `apps/server/src/index.ts`.
- [ ] 3.3 Run → GREEN. Typecheck + lint.

## 4. Multi-session e2e

- [ ] 4.1 Write `apps/server/src/__tests__/e2e.test.ts`: mock pi-ai; compose a full server; create two projects with different cwds + two sessions; send a `prompt` for each over two in-memory WS clients (each `{ send, data: { store: { ctx } } }`); after both complete, assert each session's `MessageRepo.loadBySession` contains only its own messages and each client received only its own `sessionId` frames. Run → expect GREEN (integration proof; all pieces built).
- [ ] 4.2 Typecheck + lint.

## 5. Verification

- [ ] 5.1 Run full suite: `bun vitest run apps/server/` — runner + WS + e2e + composition tests pass alongside the foundation's REST tests.
- [ ] 5.2 `bun typecheck` — 0 errors. `bun x ultracite check` — 0 errors.

## Notes for the executor

- **Grounded facts & code sketches** live in `docs/plans/2026-06-20-elysia-server.md` (now general guidelines). This change owns plan Tasks 7 (agent/ folder), 8 (ws.ts), the WS-wiring half of 9, and 11 (e2e). When this tasks file conflicts with the plan, **this file wins**.
- **Conventions** (from the plan): TDD (RED→GREEN→commit), `bun typecheck` + `bun x ultracite fix` before each commit, `exactOptionalPropertyTypes: true` is on (use conditional spread), commit per GREEN.
- **Reuse from `server-rest-api`:** `ServerContext`, `buildServer` route composition, and `makeApp()` test helper. Do not re-derive these. Do not edit the foundation's `index.ts`.
- **pi-ai mock pattern:** `vi.mock("@earendil-works/pi-ai", async () => { const actual = await vi.importActual(...); return { ...actual, streamSimple: vi.fn(), getModel: (...) => ({...}) } })` — see `packages/agent/src/__tests__/loop.test.ts`. The mock must include `getModel` (not just `streamSimple`) because the runner resolves the model.
- **Open risks** (verify against installed Elysia version): the `ws.data.store.ctx` accessor, the `message(ws, msg)` signature, and how to invoke the handler in tests (`app.config.websocket.message(ws, payload)`). If the WS body validator rejects the `type` union, widen `body` to `t.String()` and narrow inside the handler. The TDD tests catch mismatches.
- **Same-session overlap is a known accepted trade-off** (see design.md Risks) — documented as a client responsibility for v1, not enforced server-side. Do not add a per-session lock.
