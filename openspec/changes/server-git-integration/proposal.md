## Why

Every coding agent needs to show git state — what's modified, what branch, recent commits, the working diff. The foundation (`server-rest-api`) and agent layer (`server-agent-streaming`) don't expose any of this. This change adds the git surface: thin REST routes that shell to `git` in the project's cwd and return its output. It's a small, independently-shippable change (one route file, no schema, no new deps) that closes a high-impact v1 gap and is deliberately split out because subprocess-driven git is a different beast from the pure-DB projections in `server-session-utils`.

## What Changes

- Create `apps/server/src/routes/git.ts` — a single Elysia route module exposing:
  - `GET /api/git/status?projectId=<id>` — `git status --short`
  - `GET /api/git/branch?projectId=<id>` — current branch name
  - `GET /api/git/diff?projectId=<id>&staged=&path=` — working or staged diff, optionally scoped to a path
  - `GET /api/git/log?projectId=<id>&limit=` — recent commits (`--oneline`)
- Resolve `cwd` from the `projectId` via `ProjectRepo.findById` (NOT from a client-supplied `cwd` string). Unknown project → HTTP 404.
- Execute git via `Bun.spawn(["git", ...args], { cwd })` with an **args array, no shell** — so the `path` query param can't shell-inject. Capture stdout+stderr; a non-zero exit returns the captured output (so benign cases like "nothing to commit" surface to the UI instead of throwing). A 10s timeout kills runaway processes.
- Return git's text output verbatim (no porcelain parsing) for v1 — a structured parser is a v1.5 follow-up if the UI needs it.
- Register via `buildServer`'s route-composition array (from `server-rest-api`) — no edit to the foundation's `index.ts`.
- Create `apps/server/src/__tests__/git.test.ts` — drives each route against a real temp git repo (`mkdtempSync` + `git init`).

## Capabilities

### New Capabilities
- `git-integration`: The subprocess-driven git surface — status, branch, diff, and log routes that shell to `git` in a project's cwd. Includes the cwd-from-projectId resolution, the shell-free args-array execution model, the timeout/exit-code handling, and the route-composition registration.

### Modified Capabilities
<!-- None. This consumes `server-rest-api` (its buildServer composition + ServerContext + makeApp helper) and `ProjectRepo` from `@sakti-code/db` without changing their requirements. -->

## Impact

- **New code**: `apps/server/src/routes/git.ts` + `apps/server/src/__tests__/git.test.ts`. No `lib/` — the `git()` helper has a single consumer (`git.ts`) and stays local to it.
- **Dependencies**: no new deps. Uses `Bun.spawn` (built-in), Elysia (already a dep of the server), `ProjectRepo` (already in `ServerContext`).
- **Consumes `server-rest-api`**: `ServerContext` (for `repos.projects`), `buildServer` route composition, and the `makeApp()` test helper. MUST NOT edit the foundation's `index.ts`.
- **Runtime**: each request spawns one short-lived `git` process in the project cwd; there is no persistent git process or working-tree lock. Timeout-bounded so a giant repo can't hang the server.
- **Out of scope (deferred)**: structured porcelain parsing, `git add`/`commit`/`push` mutations (git as a *tool the agent uses* is a separate concern — the agent already has a `createBashTool` for that), blame, stash, per-file status objects, branch switching. This change is read-only git *visibility* for the UI.
