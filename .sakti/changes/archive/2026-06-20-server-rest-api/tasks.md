## 1. Scaffold & root config

- [x] 1.1 Create `apps/server/package.json` (`@sakti-code/server`, deps: `elysia@^1.4.29`, `@elysiajs/eden@^1.4.9`, `@sakti-code/agent|db|tools` workspace, `@earendil-works/pi-ai`). Run `bun install`.
- [x] 1.2 Create `apps/server/tsconfig.json` extending `../../tsconfig.base.json`.
- [x] 1.3 Add `apps/*/src/**/*.ts` to root `tsconfig.json` `include`.
- [x] 1.4 Add `apps/**/__tests__/**/*.test.ts` to root `vitest.config.ts` `include`.
- [x] 1.5 Add `dev:server` script to root `package.json`.
- [x] 1.6 Verify: `bun typecheck` passes with no errors after the new package exists.

## 2. ServerContext, test helper, health route

- [x] 2.1 Write failing test `apps/server/src/__tests__/health.test.ts`: `GET /health` → `{ status: "ok", uptime: <number> }`. Run → RED.
- [x] 2.2 Create `apps/server/src/context.ts` exporting `ServerContext` interface + `createContext(db)` (constructs all 6 repos).
- [x] 2.3 Create `apps/server/src/__tests__/helpers.ts` exporting `makeApp(routes?)` (in-memory `Database(":memory:")` + `initDatabase` + `createContext` + `.state("ctx", ctx)`).
- [x] 2.4 Create `apps/server/src/routes/health.ts` exporting `healthRoutes`.
- [x] 2.5 Run health test → GREEN. Typecheck + lint (`bun x ultracite fix`).

## 3. Projects routes

- [x] 3.1 Write failing test `apps/server/src/__tests__/projects.test.ts`: POST then GET lists the project; `GET /:id` returns 404 for unknown id. Run → RED.
- [x] 3.2 Create `apps/server/src/routes/projects.ts` (`healthRoutes` pattern; `.model({ project })`; GET list, GET :id, POST, PUT :id, DELETE :id; 404 on unknown).
- [x] 3.3 Run → GREEN. Typecheck + lint.

## 4. Sessions + messages routes

- [x] 4.1 Write failing test `apps/server/src/__tests__/sessions.test.ts`: create session under a project and list it; `GET /:id/messages` returns `[]` for a new session. Run → RED.
- [x] 4.2 Create `apps/server/src/routes/sessions.ts` (`.model({ session })`; GET list by `?projectId=`, GET :id, POST, PATCH :id, GET :id/messages). No standalone `/api/messages` route.
- [x] 4.3 Run → GREEN. Typecheck + lint.

## 5. Settings, model-configs, costs routes

- [x] 5.1 Write failing test `apps/server/src/__tests__/misc-routes.test.ts`: settings PUT→GET round-trip + 404 on unknown key; costs project-aggregation returns zeros for an empty project. Run → RED.
- [x] 5.2 Create `apps/server/src/routes/settings.ts` (`GET /api/settings`, `GET /api/settings/:key`, `PUT /api/settings/:key`).
- [x] 5.3 Create `apps/server/src/routes/models.ts` (`GET /api/model-configs/global`, `GET /api/model-configs/projects/:projectId`, `POST /api/model-configs`). No `apiKey` field in body or response.
- [x] 5.4 Create `apps/server/src/routes/costs.ts` (`GET /api/costs/projects/:projectId`, `GET /api/costs/sessions/:sessionId` — zeros not 404 when empty).
- [x] 5.5 Run → GREEN. Typecheck + lint.

## 6. Available-models route

- [x] 6.1 Write failing test `apps/server/src/__tests__/available-models.test.ts` that `vi.mock("@earendil-works/pi-ai")` to stub `getProviders`/`getModels`. Assert list-providers + list-models-for-provider. Run → RED.
- [x] 6.2 Create `apps/server/src/routes/available-models.ts` (`GET /api/available-models`, `GET /api/available-models/:provider`).
- [x] 6.3 Run → GREEN. Typecheck + lint.

## 7. buildServer composition + listen

- [x] 7.1 Write failing test `apps/server/src/__tests__/wiring.test.ts`: `buildServer({ db })` responds to `/health` and `/api/projects` (empty list); `buildServer({ db, routes: [customRoutes] })` also responds to the custom route. Run → RED.
- [x] 7.2 Create `apps/server/src/index.ts` exporting `buildServer({ db, routes })` that folds the foundation routes + any `routes` array via `.use()`. Add `import.meta.main` block: `new Database(SAKTI_DB_PATH)` → `initDatabase` → `buildServer` → `.listen(SAKTI_PORT ?? 3001)`.
- [x] 7.3 Run → GREEN. Typecheck + lint.

## 8. Eden treaty client

- [x] 8.1 Add `@elysiajs/eden` + `@sakti-code/server` to `apps/app/package.json`. Run `bun install`.
- [x] 8.2 Create `apps/app/src/lib/api.ts`: `treaty<App>("http://localhost:3001")` where `App` is the `buildServer` return type (re-export the type from `apps/server` if needed for workspace resolution).
- [x] 8.3 Verify `bun typecheck` resolves the `App` type across the workspace (adjust import path if `@elysia/eden` vs `@elysiajs/eden` differs in installed version).

## 9. Verification & docs

- [x] 9.1 Run full suite: `bun vitest run apps/server/` — all route + wiring tests pass.
- [x] 9.2 Run `bun typecheck` — 0 errors. Run `bun x ultracite check` — 0 errors.
- [x] 9.3 Smoke test: `bun dev:server` starts; `curl http://localhost:3001/health` → `{"status":"ok",...}`.
- [x] 9.4 Update `AGENTS.md` with the `dev:server` command and a one-paragraph server note (REST for state via Elysia + repos; Eden treaty for typed frontend access; API keys from env; model config provider+modelId in DB).

## Notes for the executor

- **Grounded facts & code sketches** live in `docs/plans/2026-06-20-elysia-server.md` — the plan is now general guidelines. Tasks 1–6, 9 (REST half), and 10 of that plan map to this change (see the plan's "OpenSpec change split" → task→change mapping). When this tasks file conflicts with the plan, **this file wins**.
- **Conventions** (from the plan): TDD (RED→GREEN→commit), `bun typecheck` + `bun x ultracite fix` before each commit, `exactOptionalPropertyTypes: true` is on (use conditional spread), commit per GREEN.
- **Open risks** (verify against installed Elysia version): `.state("ctx", ...)` typing, `import.meta.main` semantics, the Eden import path (`@elysia/eden` vs `@elysiajs/eden`). The TDD tests catch mismatches.
- **Coordination:** this change bakes in the two patterns the three leaf changes depend on — (a) `buildServer` array-composition of routes (task 7.2), (b) `__tests__/helpers.ts` (task 2.3). Do not skip or defer either.
