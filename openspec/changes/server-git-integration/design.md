## Context

`server-rest-api` exposes the DB over REST and `server-agent-streaming` runs the agent loop, but neither shows git state. Plan Task 13 calls for git routes that shell to `git` in the project cwd. The plan's sketch used `execSync` with a shell string and passed `cwd` as a query param, with an explicit note that `projectId` resolution is "the robust approach" and that either execution path (`execSync` or `Bun.spawn`) is acceptable. This design locks in the safer choice on both axes and documents why.

Constraints carried over: `exactOptionalPropertyTypes: true` (conditional spread), TS 6.0.3, Bun 1.3.14, Elysia route composition pattern (no `index.ts` edits in leaf changes). `ProjectRepo.findById(id)` returns the project row (with `cwd`) or `undefined`. The `git` binary is expected on `$PATH` (it's a coding-agent desktop app; git is a hard prerequisite).

## Goals / Non-Goals

**Goals:**
- Four read-only git routes (status, branch, diff, log) returning git's text output.
- Resolve cwd from `projectId` (never from a client-supplied path).
- Shell-free execution so the `path` diff param can't inject.
- Bounded execution (timeout) so a giant repo can't hang the server.
- Benign non-zero exits (e.g. "nothing to commit") surface as output, not 500s.

**Non-Goals:**
- Structured parsing of porcelain output — v1 returns raw text; a parser is a follow-up only if the UI needs objects.
- Git *mutations* (add/commit/push/checkout) — read-only visibility only. The agent can already run arbitrary git via `createBashTool`.
- Blame, stash, reflog, branch listing, merge-state — add when a concrete UI need appears.
- A git library / abstraction — the `git()` helper is local to `git.ts`; no shared module (single consumer).
- Caching git output — git status is fast; caching adds staleness bugs.

## Decisions

### 1. Resolve cwd from `projectId`, not a client-supplied `cwd`
**Decision:** routes accept `projectId` and call `ProjectRepo.findById` to get `cwd`. Unknown project → 404. **Alternative considered (plan's sketch):** accept `cwd` as a query param. **Rejected for the security surface:** a raw-`cwd` endpoint lets any client read git state of *any* directory the server process can see (e.g. `/etc`, another user's repo, `~/.ssh` if it were a repo). For a localhost desktop app this is low-stakes, but `projectId` resolution removes the surface entirely at zero cost — every codebase in sakti-code is already a project, so there's no use case for git state of a non-project directory. **Bonus:** it's consistent with the rest of the API (everything else is keyed by resource ID, not raw paths).

### 2. `Bun.spawn` with an args array, no shell
**Decision:** `Bun.spawn(["git", "status", "--short"], { cwd })` — argv form, no `/bin/sh`. **Alternative considered (plan's sketch):** `execSync(\`git ${args}\`, { shell: "/bin/sh" })`. **Rejected for injection safety:** the diff route takes a `path` param. In a shell string, `${query.path}` is a direct injection vector (`path=".; rm -rf /"`). With an args array, `path` is a single argv element that git treats as a literal filename — no shell ever sees it. `Bun.spawn` is also non-blocking (doesn't stall the event loop the way `execSync` does) and is the Bun-native idiom. The cost is a 3-line async capture (`stdout`/`stderr`/`exited`) instead of `execSync`'s one-liner — trivial.

### 3. Non-zero exits return captured output, not exceptions
**Decision:** await `proc.exited`; if non-zero, return `stdout + stderr` (or the captured text) with HTTP 200. **Rationale:** many git non-zero exits are benign and UI-meaningful — `git diff` on a clean tree, `git status` mid-merge with conflicts, "nothing to commit". Treating these as 500 errors forces the client to parse exception bodies. Returning the captured output (the same text git prints to the terminal) lets the UI show it directly. Only the *missing-project* case is a real 4xx (404). A genuine process-spawn failure (git not on PATH) is the one case that should throw → caught at the route boundary → 500.

### 4. v1 returns raw text, no porcelain parsing
**Decision:** routes return git's stdout as a string (status as `--short` lines, log as `--oneline` lines, branch as the name, diff as unified text). **Alternative:** parse `--porcelain`/`--format` into structured objects. **Rejected for now:** parsing is real work (every output shape needs its own parser + tests), and a SolidJS UI can render `--short`/`--oneline` text directly with a few CSS rules. Defer structured parsing until a concrete UI need proves the text form isn't enough. This keeps the change genuinely small and shippable.

### 5. Timeout kills runaway processes
**Decision:** wrap each spawn in a 10s guard (`setTimeout` → `proc.kill()`). **Rationale:** `git status`/`diff` are fast, but `git log` on a giant repo or a repo on a slow/networked filesystem can hang. A bounded timeout ensures one bad repo can't wedge the server. 10s is generous for any local repo; if it fires we return a clear "git timed out" message rather than hanging forever. Configurable later via `SAKTI_GIT_TIMEOUT` if needed — not adding the env knob until someone asks.

### 6. Registration via route composition
**Decision:** add `gitRoutes` to `buildServer`'s routes array (the pattern `server-rest-api` bakes in). Do NOT edit `apps/server/src/index.ts`. **Rationale:** identical to the other two leaves — keeps this change parallelizable with `server-session-utils` without `index.ts` merge conflicts.

## Risks / Trade-offs

- **[git not on PATH]** if `git` is missing, `Bun.spawn` throws synchronously. → **Mitigation:** catch at the route boundary, return 500 with a clear message. This is a misconfigured environment, not a runtime bug — acceptable to surface as a server error.
- **[Raw text ties the UI to git's output format]** if the frontend later wants structured data, the route shape changes. → **Acceptable:** the route is read-only and the change is small; a structured successor can version the endpoint (`/api/git/status?format=porcelain`) or replace it. Pay-for-play — don't build the parser speculatively.
- **[No auth on git output]** anyone who can reach the server can read project git state. → **Mitigation:** localhost-only binding (assumed by the whole server); projectId resolution already prevents arbitrary-dir reads. Same threat model as the rest of the API.
- **[Timeout may be too short for huge repos]** a legitimate `git log` on a massive monorepo could exceed 10s. → **Mitigation:** `limit` defaults to 20 (bounds the log work); the env-knob escape hatch is documented but not built until needed.
- **[Non-zero-exit-as-200 could mask real errors]** a genuinely broken git command returns 200 with stderr text. → **Acceptable trade-off:** the alternative (500 on every non-zero) breaks the common benign cases. The UI can still show the stderr text; a `git exit code` field could be added later if the UI needs to distinguish.
