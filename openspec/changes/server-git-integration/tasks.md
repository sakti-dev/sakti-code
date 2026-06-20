## 1. Git route module (TDD)

- [x] 1.1 Write failing test `apps/server/src/__tests__/git.test.ts`. Build a temp git repo helper (`mkdtempSync` → `git init -q` → config user → commit a file → modify it). Create a project via `ctx.repos.projects.create(name, tempCwd)` so `projectId` resolves to the temp cwd. Assert: `GET /api/git/status?projectId=<id>` → 200, body contains the modified filename; `GET /api/git/branch?projectId=<id>` → 200, body contains the branch; `GET /api/git/log?projectId=<id>&limit=5` → 200, body contains the commit message; `GET /api/git/status?projectId=unknown` → 404. Run → RED.
- [x] 1.2 Create `apps/server/src/routes/git.ts` exporting `gitRoutes` (`new Elysia({ name: "routes.git" })`). Implement a local async `runGit(args: string[], cwd: string)` helper: `Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })`, race `proc.exited` against a 10s `setTimeout(() => proc.kill())`, capture stdout+stderr, return text on both exit-0 and non-zero-exit. Routes: `/api/git/status` (`["status","--short"]`), `/api/git/branch` (`["branch","--show-current"]`), `/api/git/diff` (spread `...(staged ? ["--cached"] : [])` + `...(path ? [path] : [])`), `/api/git/log` (`["log","-n",String(limit ?? 20),"--oneline"]`). Each route reads `projectId` from query, resolves `cwd` via `store.ctx.repos.projects.findById`, returns 404 if missing. Query schema: `t.Object({ projectId: t.String(), ...(diff: staged?: Boolean, path?: String; log: limit?: Number) })`.
- [x] 1.3 Run → GREEN. Typecheck + lint (`bun typecheck && bun x ultracite fix`).

## 2. Register via route composition + injection-edge test

- [x] 2.1 Write failing test asserting `buildServer` composed with `gitRoutes` responds to `/api/git/status` — without editing the foundation's `index.ts`. (Drive the route directly via `gitRoutes.state("ctx", ctx)` for the unit test; the composition assertion reuses `makeApp()` from `server-rest-api`'s helper if it accepts extra routes, otherwise assert the route module is importable and composable.) Run → expect GREEN (composition pattern already exists from `server-rest-api`).
- [x] 2.2 Add `gitRoutes` to the server's route composition (the array/barrel surface `server-rest-api` exposes). Do NOT edit `apps/server/src/index.ts`.
- [x] 2.3 Optional hardening test: `GET /api/git/diff?projectId=<id>&path=foo%3Brm` (path `foo;rm`) returns 200 with git's "no such path"/empty output — proves no shell injection. Run → GREEN.

## 3. Verification

- [x] 3.1 Run full server suite: `bun vitest run apps/server/` — git tests pass alongside the foundation's REST tests.
- [x] 3.2 `bun typecheck` — 0 errors. `bun x ultracite check` — 0 errors.
- [x] 3.3 Smoke test against a real repo: create a project whose cwd is this repo, `curl 'http://localhost:3001/api/git/status?projectId=<id>'` returns modified files; `curl .../api/git/log?projectId=<id>&limit=5` returns recent commits.

## Notes for the executor

- **Grounded facts & code sketches** live in `docs/plans/2026-06-20-elysia-server.md` (now general guidelines). This change owns **plan Task 13 only**. The plan's sketch used `execSync` + a `cwd` query param — this change deliberately diverges on both (see design.md Decisions 1 & 2: `Bun.spawn` args-array + `projectId` resolution). When this tasks file conflicts with the plan, **this file wins**.
- **Conventions** (from the plan): TDD (RED→GREEN→commit), `bun typecheck` + `bun x ultracite fix` before each commit, `exactOptionalPropertyTypes: true` (use conditional spread `...(x !== undefined ? { x } : {})`), commit per GREEN.
- **Reuse from `server-rest-api`:** `ServerContext` (for `repos.projects`), `buildServer` route composition, and `makeApp()` test helper. Do not re-derive these. Do not edit the foundation's `index.ts`.
- **No `lib/` directory.** The `runGit` helper has a single consumer (`git.ts`) and stays local to it. If a second consumer appears later, promote then.
- **Non-zero-exit handling is intentional** (design Decision 3): benign git exits (clean tree, no such path) return 200 with captured output, NOT 500. Only project-not-found (404) and git-binary-missing (500, caught at boundary) are error responses.
- **Timeout** is 10s via `setTimeout` + `proc.kill()`; do not add a `SAKTI_GIT_TIMEOUT` env knob until asked.
- **This change is read-only** (status/branch/diff/log). Git *mutations* and structured porcelain parsing are explicitly out of scope (see proposal Non-Goals).
