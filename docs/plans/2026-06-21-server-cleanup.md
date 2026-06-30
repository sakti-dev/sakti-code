# Server Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove five leaking agent abstractions from `apps/server/src/routes/` so the server returns to its documented "REST-for-state, WS-for-streaming" split.

**Architecture:** Five independent tasks ordered by risk. Three are pure deletions (route + test + spec). Two are modifications (drop a body param; move a route under a different prefix). Task 5 is the largest in concept but smallest in code: the WS handler at `apps/server/src/agent/ws-handler.ts:14-26, 88-101` already implements `steer` and `followUp` inbound frames — we're deleting the redundant REST fallback, not building anything new.

**Tech Stack:** Elysia (REST), native WebSocket (`apps/server/src/agent/ws.ts`), `bun:test` for tests, OpenSpec markdown for specs.

**Design doc:** `docs/plans/2026-06-21-server-cleanup-design.md` (approved)

---

## Conventions for every task

- **Test runner:** `cd apps/server && bun run test` (uses `preload` script; do NOT run `bun test` directly — it picks up vitest tests from `packages/agent` and fails).
- **Typecheck:** `bun typecheck` (workspace-wide, ~1s).
- **Lint:** `bun x ultracite check` (Biome; should remain clean).
- **Branch:** `feat/port-pi-agent` (already checked out, all unify-persistence work is here).
- **Commit message style:** `refactor(server): ...`, `feat(server): ...`, `docs: ...` — match recent `git log --oneline`.
- **TDD note:** For pure deletions there is no RED phase (you can't write a failing test for "file is gone"). Instead: grep for consumers → delete → run remaining tests → commit. For modifications, write the failing test first.

---

## Task 1: Delete `naming.ts` (duplicate of `sessions.PATCH`)

**Why:** `PATCH /api/sessions/:id` in `apps/server/src/routes/sessions.ts:53-67` already accepts `{ title }` via `t.Partial(...)`. `PATCH /api/sessions/:id/name` in `naming.ts` does the same thing with a narrower body.

**Files:**

- Delete: `apps/server/src/routes/naming.ts`
- Delete: `apps/server/src/__tests__/naming.test.ts` (if present — `ls` first)
- Delete: `openspec/specs/session-naming/spec.md` and the folder
- Modify: `apps/server/src/index.ts:16, 52`

**Step 1: Verify no consumers**

Run: `rg -n "/api/sessions/.*/name|namingRoutes" apps/ openspec/`
Expected: only `apps/server/src/index.ts` imports `namingRoutes`. The client (`apps/app/`) returns zero matches.

**Step 2: Check for naming test file**

Run: `ls apps/server/src/__tests__/naming*`
Expected: either no match, or `naming.test.ts`. Delete whichever exists.

**Step 3: Delete the route file, test, and spec folder**

```bash
rm apps/server/src/routes/naming.ts
rm -rf openspec/specs/session-naming/
# Only if Step 2 found a test file:
rm -f apps/server/src/__tests__/naming.test.ts
```

**Step 4: Remove the import and registration from `index.ts`**

In `apps/server/src/index.ts`:

- Delete line 16: `import { namingRoutes } from "./routes/naming.ts";`
- Delete line 52: `  namingRoutes,` from the `defaultRoutes` array.

**Step 5: Verify everything still passes**

Run:

```bash
cd apps/server && bun run test 2>&1 | tail -5
bun typecheck && bun x ultracite check 2>&1 | tail -3
```

Expected: 111 tests pass (or the new count minus any naming tests that existed). 0 type errors. 0 lint errors.

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor(server): delete redundant naming route (subset of sessions PATCH)"
```

---

## Task 2: Delete `commands.ts` (server-curated slash-command catalog)

**Why:** `GET /api/commands` returns a hardcoded list (`search`, `clear`, `compact`, `help`). Slash commands are a client/agent concern, not server state. The server has no business curating this catalog.

**Files:**

- Delete: `apps/server/src/routes/commands.ts`
- Delete: `apps/server/src/__tests__/commands.test.ts`
- Delete: `openspec/specs/session-commands/spec.md` and the folder
- Modify: `apps/server/src/index.ts:8, 41`

**Step 1: Verify no consumers**

Run: `rg -n "/api/commands|commandsRoutes" apps/ openspec/`
Expected: only `apps/server/src/index.ts`, `apps/server/src/routes/commands.ts`, `apps/server/src/__tests__/commands.test.ts`, and `openspec/specs/session-commands/` match. Zero client matches.

**Step 2: Delete files**

```bash
rm apps/server/src/routes/commands.ts
rm apps/server/src/__tests__/commands.test.ts
rm -rf openspec/specs/session-commands/
```

**Step 3: Remove import and registration from `index.ts`**

In `apps/server/src/index.ts`:

- Delete line 8: `import { commandsRoutes } from "./routes/commands.ts";`
- Delete line 41: `  commandsRoutes,` from the `defaultRoutes` array.

**Step 4: Verify**

Run:

```bash
cd apps/server && bun run test 2>&1 | tail -5
bun typecheck && bun x ultracite check 2>&1 | tail -3
```

Expected: test count drops by 2 (commands test had 2 `it` blocks). 0 type errors. 0 lint errors.

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(server): delete commands route (slash commands are a client concern)"
```

---

## Task 3: Drop `injectToContext` from `bash.ts`

**Why:** `POST /api/sessions/:id/bash` with `{ injectToContext: true }` writes a `toolResult` entry with `toolName: "user_bash"` via `Session.appendMessage()` (`bash.ts:139-158`). This reinvents agent tool calls alongside the real `BashTool` in `packages/tools/`. Without it, `bash.ts` becomes a clean host-execution endpoint (same flavor as `terminals.ts`). Users who want the agent to see command output paste it as a user message.

**Files:**

- Modify: `apps/server/src/routes/bash.ts:1-3, 111-115, 139-158`
- Modify: `apps/server/src/__tests__/bash.test.ts:56-85` (delete the inject test)
- Modify: `openspec/specs/user-bash/spec.md:3, 8, 41-47`

**Step 1: Delete the inject test (RED)**

In `apps/server/src/__tests__/bash.test.ts`, delete the entire `it("POST /api/sessions/:id/bash with injectToContext appends a toolResult entry", ...)` block (lines 56-85). Also delete the now-unused imports on lines 2-3:

```ts
import { buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
```

(They were only used by the inject test.)

**Step 2: Run remaining tests to verify they still pass**

Run: `cd apps/server && bun run test src/__tests__/bash.test.ts 2>&1 | tail -10`
Expected: 6 bash tests pass (down from 7). If any test mentions `injectToContext` in the body and the server still rejects it, that test still passes (Elysia ignores unknown body fields by default — but we're about to remove the field from the schema, so it would 422 if any test sends it. None should after step 1.)

**Step 3: Drop `injectToContext` from `bash.ts`**

In `apps/server/src/routes/bash.ts`:

3a. Remove unused imports (line 1-2):

```ts
import { Session } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
```

Both become unused after step 3b.

3b. Remove `injectToContext` from the body schema (around line 111-115):

```ts
const bashBody = t.Object({
  command: t.String(),
  injectToContext: t.Optional(t.Boolean()),
  timeout: t.Optional(t.Number()),
});
```

becomes:

```ts
const bashBody = t.Object({
  command: t.String(),
  timeout: t.Optional(t.Number()),
});
```

3c. Delete the entire inject-to-context block inside the POST handler (around lines 139-158):

```ts
if (body.injectToContext) {
  const content = JSON.stringify({
    command: body.command,
    exitCode: result.exitCode,
    output: result.output,
  });
  const storage = new SqliteSessionStorage(ctx.db, session.id, {
    id: session.id,
    createdAt: new Date(session.createdAt).toISOString(),
  });
  const sessionInstance = new Session(storage);
  await sessionInstance.appendMessage({
    role: "toolResult",
    content: [{ type: "text", text: content }],
    toolCallId: crypto.randomUUID(),
    toolName: "user_bash",
    isError: false,
    timestamp: Date.now(),
  });
}
```

**Step 4: Verify tests pass and lint is clean**

Run:

```bash
cd apps/server && bun run test 2>&1 | tail -5
bun typecheck && bun x ultracite check 2>&1 | tail -3
```

Expected: test count drops by 1 (from 111 to 110, or from 109 to 108 if Task 1/2 already ran). 0 type errors. 0 lint errors.

**Step 5: Update spec**

In `openspec/specs/user-bash/spec.md`:

5a. Replace the Purpose line (line 3):

```md
User bash allows executing shell commands independently from the agent loop, with optional result injection into session context.
```

becomes:

```md
User bash allows executing shell commands independently from the agent loop. The output is shown in the UI; users who want the agent to see it paste it as a user message.
```

5b. Remove `injectToContext?: boolean` from the body shape in the "User bash executes a shell command" requirement (line 8). The body becomes `{ command: string, timeout?: number }`.

5c. Delete the entire "Bash result injection into session context" requirement block (lines 41-47 inclusive).

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor(server): drop injectToContext from user-bash (redundant with BashTool)"
```

---

## Task 4: Merge `turn-diff.ts` into `git.ts`

**Why:** `GET /api/sessions/:id/turn-diff` overlaps with `GET /api/git/diff`. Move it under the `/api/git/*` prefix as `GET /api/git/turn-diff?projectId=...&files[]=...` (project-scoped, consistent with siblings).

**Files:**

- Delete: `apps/server/src/routes/turn-diff.ts`
- Delete: `apps/server/src/__tests__/turn-diff.test.ts`
- Modify: `apps/server/src/routes/git.ts` (add `parseNumstat` + new route)
- Modify: `apps/server/src/__tests__/git.test.ts` (add turn-diff tests)
- Delete: `openspec/specs/turn-diff/spec.md` and the folder
- Modify: `apps/server/src/index.ts:25, 43` (drop turn-diff import + registration; git is already registered)

**Step 1: Write the failing tests (RED)**

Append to `apps/server/src/__tests__/git.test.ts`, inside the existing `describe("git routes", ...)` block (after the last `it`), using the `tempDir` and `projectId` already set up in `beforeAll`. Note: the existing `beforeAll` creates a repo with a modified `hello.txt` — that's enough to show a turn-diff.

```ts
it("GET /api/git/turn-diff returns structured diff against HEAD", async () => {
  const res = await app.handle(
    new Request(`http://localhost/api/git/turn-diff?projectId=${projectId}`),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.files)).toBe(true);
  expect(body.files.length).toBeGreaterThan(0);
  const hello = body.files.find((f: { path: string }) => f.path === "hello.txt");
  expect(hello).toBeDefined();
  expect(hello.additions).toBeGreaterThanOrEqual(1);
  expect(typeof body.diff).toBe("string");
  expect(body.diff).toContain("hello.txt");
  expect(body.cwd).toBe(tempDir);
});

it("GET /api/git/turn-diff?files[]=hello.txt scopes the diff", async () => {
  const res = await app.handle(
    new Request(`http://localhost/api/git/turn-diff?projectId=${projectId}&files[]=hello.txt`),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.files).toHaveLength(1);
  expect(body.files[0].path).toBe("hello.txt");
});

it("GET /api/git/turn-diff returns 404 for unknown project", async () => {
  const res = await app.handle(new Request("http://localhost/api/git/turn-diff?projectId=nope"));
  expect(res.status).toBe(404);
});

it("GET /api/git/turn-diff returns empty files for a repo with no commits", async () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "sakti-git-empty-"));
  try {
    await execGit(emptyDir, "init", "-b", "main");
    writeFileSync(join(emptyDir, "x.txt"), "x\n");
    const built = await makeApp([gitRoutes]);
    const p = await built.ctx.repos.projects.create("empty", emptyDir);
    const res = await built.app.handle(
      new Request(`http://localhost/api/git/turn-diff?projectId=${p.id}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toEqual([]);
    expect(body.diff).toBe("");
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});
```

Also add to the top of `git.test.ts` the missing imports if not already there:

```ts
import { tmpdir } from "node:os";
```

(`join` and `mkdtempSync`/`rmSync`/`writeFileSync` are already imported per the file header.)

**Step 2: Run the new tests — verify they FAIL**

Run: `cd apps/server && bun run test src/__tests__/git.test.ts 2>&1 | tail -20`
Expected: 4 new tests FAIL with 404 (route doesn't exist yet under `/api/git/turn-diff`).

**Step 3: Move `parseNumstat` and add the route to `git.ts`**

3a. In `apps/server/src/routes/git.ts`, add `parseNumstat` (lifted verbatim from `turn-diff.ts:12-37`) just below the existing `GIT_TIMEOUT_MS` constant:

```ts
interface NumstatEntry {
  additions: number;
  deletions: number;
  path: string;
}

function parseNumstat(output: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const addStr = parts[0] ?? "-";
    const delStr = parts[1] ?? "-";
    const path = parts.slice(2).join("\t");

    const additions = addStr === "-" ? 0 : Number.parseInt(addStr, 10);
    const deletions = delStr === "-" ? 0 : Number.parseInt(delStr, 10);

    if (path) {
      entries.push({ path, additions, deletions });
    }
  }
  return entries.toSorted((a, b) => a.path.localeCompare(b.path));
}

async function hasHead(cwd: string): Promise<boolean> {
  const head = await runGitTimed(["rev-parse", "HEAD"], cwd);
  return head.trim().length > 0;
}
```

`runGitTimed` doesn't exist in `git.ts` — `git.ts` uses `runGit` (which returns a `GitResult`). Add a thin internal helper that returns stdout text directly (place just above `hasHead`):

```ts
async function runGitTimed(
  args: string[],
  cwd: string,
  timeoutMs: number = GIT_TIMEOUT_MS,
): Promise<string> {
  const result = await runGit(args, cwd, timeoutMs);
  // runGit returns spawn-error / timeout as `kind`; treat both as empty string
  return result.kind === "ok" ? result.output : "";
}
```

(We reuse `runGit` so we inherit its timeout/kill behavior instead of duplicating the spawn logic from `turn-diff.ts`.)

3b. Add the route to the `gitRoutes` Elysia chain. Append after the existing `.get("/api/git/log", ...)` block (around line 134, just before the final `);`):

```ts
  .get(
    "/api/git/turn-diff",
    async ({ query, store }) => {
      const ctx = getCtx(store);
      const project = await ctx.repos.projects.findById(query.projectId);
      if (!project) {
        return new Response("Not found", { status: 404 });
      }

      const cwd = project.cwd;
      const hasHeadCommit = await hasHead(cwd);
      if (!hasHeadCommit) {
        return Response.json({ files: [], diff: "", cwd });
      }

      const diffArgs: string[] = ["diff", "HEAD"];
      const numstatArgs: string[] = ["diff", "HEAD", "--numstat"];
      if (query.files && query.files.length > 0) {
        diffArgs.push("--", ...query.files);
        numstatArgs.push("--", ...query.files);
      }

      const [diff, numstat] = await Promise.all([
        runGitTimed(diffArgs, cwd),
        runGitTimed(numstatArgs, cwd),
      ]);

      const files = parseNumstat(numstat);

      return Response.json({ files, diff, cwd });
    },
    {
      query: t.Object({
        projectId: t.String(),
        files: t.Optional(t.Array(t.String())),
      }),
    }
  )
```

**Step 4: Run the new tests — verify they PASS (GREEN)**

Run: `cd apps/server && bun run test src/__tests__/git.test.ts 2>&1 | tail -10`
Expected: all git tests pass, including the 4 new turn-diff tests.

**Step 5: Delete the old turn-diff route and test**

```bash
rm apps/server/src/routes/turn-diff.ts
rm apps/server/src/__tests__/turn-diff.test.ts
rm -rf openspec/specs/turn-diff/
```

**Step 6: Remove the import and registration from `index.ts`**

In `apps/server/src/index.ts`:

- Delete line 25: `import { turnDiffRoutes } from "./routes/turn-diff.ts";`
- Delete line 43: `  turnDiffRoutes,` from the `defaultRoutes` array.

(`gitRoutes` is already imported and registered.)

**Step 7: Full verification**

Run:

```bash
cd apps/server && bun run test 2>&1 | tail -5
bun typecheck && bun x ultracite check 2>&1 | tail -3
```

Expected: total server test count increases by 4 (new git tests) and decreases by 5 (turn-diff had 5 `it` blocks: 3 + 2). Net: -1 from the previous task's count. 0 type errors. 0 lint errors.

**Step 8: Commit**

```bash
git add -A && git commit -m "refactor(server): merge turn-diff into git.ts as /api/git/turn-diff"
```

---

## Task 5: Delete REST `session-controls` (WS handler already implements steer/followUp)

**Why:** `apps/server/src/agent/ws-handler.ts:14-26` defines `SteerMessage` and `FollowUpMessage` inbound frame types. Lines 88-101 of `handleMessage` already route them to the active harness via `getActiveHarness()` and push an `error` frame if no run is active. The REST routes at `/api/sessions/:id/steer` and `/api/sessions/:id/follow-up` are a redundant second control plane. The spec at `openspec/specs/session-controls/spec.md:47-56` already documents the WS path; only the REST fallback section (lines 58-67) needs removal.

**Files:**

- Delete: `apps/server/src/routes/session-controls.ts`
- Delete: `apps/server/src/__tests__/session-controls.test.ts`
- Modify: `apps/server/src/index.ts:19, 55`
- Modify: `openspec/specs/session-controls/spec.md:3, 58-67`

**Step 1: Confirm the WS path has test coverage**

Run: `rg -n "steer|followUp" apps/server/src/__tests__/ apps/server/src/agent/`
Expected: matches in `ws-handler.ts` (the implementation). If no WS test exists for steer/followUp, that's a pre-existing gap — note it but DO NOT block this task on writing new WS tests. (Coverage of the WS handler is the WS welcoming push spec's responsibility, not this cleanup's.)

**Step 2: Delete the REST route, test, and remove registration**

```bash
rm apps/server/src/routes/session-controls.ts
rm apps/server/src/__tests__/session-controls.test.ts
```

In `apps/server/src/index.ts`:

- Delete line 19: `import { sessionControlRoutes } from "./routes/session-controls.ts";`
- Delete line 55: `  sessionControlRoutes,` from the `defaultRoutes` array.

**Step 3: Update spec**

In `openspec/specs/session-controls/spec.md`:

3a. Replace the Purpose (line 3):

```md
Session controls let a client interact with an active agent-loop run mid-flight: injecting a "steer" message to redirect the loop while it works (aborting an in-progress tool but never the LLM stream), or queueing "follow-up" messages to run as additional turns after the current one completes. Both are delivered over the existing WebSocket.
```

3b. Delete the entire "Steer/follow-up routes via REST (fallback)" requirement block (lines 58-67 inclusive):

```md
### Requirement: Steer/follow-up routes via REST (fallback)

...

#### Scenario: REST steer without active run

- **WHEN** `POST /api/sessions/:id/steer` is called for a session with no active run
- **THEN** the response status is 404
```

**Step 4: Verify**

Run:

```bash
cd apps/server && bun run test 2>&1 | tail -5
bun typecheck && bun x ultracite check 2>&1 | tail -3
```

Expected: test count drops by 3 (the 3 `it` blocks in `session-controls.test.ts`). 0 type errors. 0 lint errors.

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(server): drop REST steer/follow-up (WS handler is the single control plane)"
```

---

## Task 6: Update `AGENTS.md` route table and final verification

**Why:** `AGENTS.md`'s route-modules table is the canonical map of what the server exposes. It needs to reflect the post-cleanup reality.

**Files:**

- Modify: `AGENTS.md` (the route-modules table around lines 84-95)

**Step 1: Update the route table**

In `AGENTS.md`, replace the route-modules table:

- Delete the `costsRoutes` row (already gone — verify it's not there).
- Delete any `commandsRoutes` row (was at line 91 in the pre-cleanup version).
- Delete any `namingRoutes` row (if present).
- Delete the `sessionControlRoutes` row (was around line 95 — used to be `POST /api/sessions/:id/steer`, `/follow-up`).
- Update the `gitRoutes` row to include `/turn-diff`:

```md
| `gitRoutes` | `GET /api/git/:projectId/status, /branch, /diff, /log`, `GET /api/git/turn-diff` | Git operations (status, branch switch, diff, log) + structured turn-diff (numstat-parsed file changes since HEAD) |
```

- Update the `bashRoutes` row (if present) to drop the `injectToContext` mention. Final row:

```md
| `bashRoutes` | `POST /api/sessions/:id/bash`, `POST /api/sessions/:id/abort-bash` | Host-execution bash (UI only); not the agent's BashTool |
```

Run: `rg -n "commandsRoutes|namingRoutes|sessionControlRoutes|injectToContext|turn-diff" AGENTS.md`
Expected: zero matches (or only the `gitRoutes` row mentioning `turn-diff` if you kept it inline).

**Step 2: Full workspace verification**

Run all four checks:

```bash
bun typecheck && bun x ultracite check 2>&1 | tail -3
echo "---AGENT+TOOLS---"
bun vitest run packages/agent/ packages/tools/ 2>&1 | tail -5
echo "---DB---"
cd packages/db && bun test 2>&1 | tail -5
echo "---SERVER---"
cd ../../apps/server && bun run test 2>&1 | tail -5
```

Expected:

- `tsconfig.json`: 0 errors.
- Biome: 0 errors.
- Vitest (agent+tools): 148 tests pass.
- bun:test (db): 22 tests pass.
- bun:test (server): test count = `previous_count - 2 (commands) - 1 (bash inject) - 5 (turn-diff) + 4 (new git tests) - 3 (session-controls)` = `previous_count - 7`. If starting from 111, expect **104**.

If the count is off by one or two, look for an overlooked test that referenced the deleted routes and update it.

**Step 3: Commit**

```bash
git add AGENTS.md && git commit -m "docs: update AGENTS.md route table for post-cleanup server shape"
```

---

## Final verification checklist

After all six tasks:

- [ ] `rg -n "namingRoutes|commandsRoutes|sessionControlRoutes|turnDiffRoutes" apps/ openspec/ AGENTS.md` → zero matches.
- [ ] `rg -n "injectToContext" apps/ openspec/ AGENTS.md` → zero matches.
- [ ] `rg -n "/api/commands|/api/sessions/.*/name\b|/api/sessions/.*/(steer|follow-up)|/api/sessions/.*/turn-diff" apps/ openspec/ AGENTS.md` → zero matches.
- [ ] `bun typecheck` clean.
- [ ] `bun x ultracite check` clean.
- [ ] All three test suites green (vitest 148, db 22, server 104 if starting from 111).
- [ ] `git log --oneline -8` shows six new commits on `feat/port-pi-agent`.

## Skills referenced

- @superpowers:test-driven-development — for the modification tasks (3, 4)
- @superpowers:verification-before-completion — final verification checklist
- @superpowers:finishing-a-development-branch — next step after this plan completes
