# SDD Phase Sync & Branch Naming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Sync the worktree's `.sakti.yaml` phase when transitions happen, and let the LLM choose conventional branch names (feat/, fix/, etc.) via the transition tool.

**Architecture:** Two independent changes to the transition pipeline. (1) Add a `syncSddPhase` side-effect to `applyTransition` that writes the new phase to the worktree's `.sakti/changes/<name>/.sakti.yaml` — never touches the main project. (2) Add a `branchName` parameter to the transition tool; `persistTransitionSideEffect` captures it, stores it in a new DB column, and `createMissionWorktree` uses it instead of the hardcoded `sakti/` prefix.

**Tech Stack:** TypeScript, Hono, node:sqlite + Drizzle ORM, vitest, `@sakti-code/sakti` (readChangeMetadata / writeChangeMetadata)

---

## Background

### The phase desync bug

`applyTransition` updates `sessions.status` in the DB but never writes `.sakti.yaml`. The agent runs `sakti state get phase` via bash inside the worktree and reads the stale `.sakti.yaml` (absorbed at mission start, never updated). This causes confusion: system reminders say `verify`, CLI says `build`.

```
Worktree: ~/.sakti/projects/<basename>--<changeName>/
  .sakti/changes/<changeName>/.sakti.yaml  ← stale phase (never synced)

Session DB:
  sessions.status                          ← correct, updated by applyTransition
```

### The branch naming issue

`createMissionWorktree` hardcodes the branch prefix `sakti/` across 5 functions in `worktree.ts`. The user wants conventional prefixes (`feat/`, `fix/`, `chore/`, etc.) chosen by the LLM via the transition tool.

### Key files

- `apps/server/src/agent/config/transition-apply.ts` — `applyTransition` + `TransitionApplyCtx`
- `apps/server/src/agent/ws-handler.ts` — `persistTransitionSideEffect`, `runAgentStream` (auto-chain caller)
- `apps/server/src/routes/sessions/confirm.ts` — gate approval route (calls `applyTransition`)
- `apps/server/src/lib/worktree.ts` — `createMissionWorktree`, `missionBranchExists`, etc.
- `packages/tools/src/transition/index.ts` — transition tool schema + `createTransitionTool`
- `packages/db/src/schema.ts` — Drizzle sessions table
- `packages/db/src/repos/index.ts` — `SessionRepo.create` / `SessionRepo.update`
- `packages/sakti/src/sdd/utils/change-metadata.ts` — `readChangeMetadata` / `writeChangeMetadata`

### Conventions

- **`exactOptionalPropertyTypes: true`** — use conditional spread `...(x !== undefined ? { x } : {})`
- **Tests live in `__tests__/` colocated with source**, using vitest
- **Best-effort side-effects** log via `ctx.log?.agent?.warn?.()` and never throw
- Run tests via: `vp run '@sakti-code/server#test' -- --run <path>`
- Run checks via: `vp check --fix && vp check`

---

## Part A: `.sakti.yaml` Phase Sync

### Task A1: Add `syncSddPhase` to `TransitionApplyCtx`

**Files:**

- Modify: `apps/server/src/agent/config/transition-apply.ts`
- Test: `apps/server/src/agent/config/__tests__/transition-apply.test.ts`

**Step 1: Write the failing test**

Add to `apps/server/src/agent/config/__tests__/transition-apply.test.ts`:

```typescript
it("calls syncSddPhase after the status flip with the new phase", async () => {
  const syncCalls: string[] = [];
  const order: string[] = [];
  const ctx = {
    repos: {
      sessions: {
        update: vi.fn(async (_id: string, data: Record<string, unknown>) => {
          order.push(`status:${JSON.stringify(data)}`);
        }),
      },
    },
    syncSddPhase: vi.fn(async (phase: string) => {
      order.push(`sync:${phase}`);
    }),
    log: { agent: { warn: vi.fn(), info: vi.fn() } },
  } as unknown as Parameters<typeof applyTransition>[0];
  const edge = getEdge("build", "verify");
  await applyTransition(ctx, session({ status: "build" }), edge);
  expect(order).toEqual(['status:{"status":"verify"}', "sync:verify"]);
});

it("syncSddPhase failure is swallowed (status flip already landed)", async () => {
  const ctx = {
    repos: {
      sessions: {
        update: vi.fn(async () => ({})),
      },
    },
    syncSddPhase: vi.fn(async () => {
      throw new Error("yaml locked");
    }),
    log: { agent: { warn: vi.fn(), info: vi.fn() } },
  } as unknown as Parameters<typeof applyTransition>[0];
  const edge = getEdge("verify", "archive");
  await expect(applyTransition(ctx, session({ status: "verify" }), edge)).resolves.toBeUndefined();
  expect(ctx.log.agent.warn).toHaveBeenCalled();
});

it("syncSddPhase is not called when edge has no statusTarget", async () => {
  const syncSddPhase = vi.fn(async () => {});
  const ctx = {
    repos: { sessions: { update: async () => {} } },
    syncSddPhase,
  } as unknown as Parameters<typeof applyTransition>[0];
  const edge = getEdge("plan", "mission");
  await applyTransition(ctx, session({ kind: "plan" }), edge);
  expect(syncSddPhase).not.toHaveBeenCalled();
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/config/__tests__/transition-apply.test.ts`

Expected: FAIL — `syncSddPhase` is not a recognized property, order assertion fails.

**Step 3: Write minimal implementation**

In `apps/server/src/agent/config/transition-apply.ts`:

1. Add to `TransitionApplyCtx` interface:

```typescript
/** Bound .sakti.yaml phase sync (worktree only). Best-effort. */
syncSddPhase?: (phase: string) => Promise<void>;
```

2. After the status flip block in `applyTransition`, add:

```typescript
// Sync .sakti.yaml phase in the worktree (best-effort). Only for edges
// with a statusTarget (build/verify/archive — not done, which tears down
// the worktree). Runs AFTER the status flip so the DB is already correct.
if (edge.statusTarget && edge.statusTarget !== "done" && ctx.syncSddPhase) {
  try {
    await ctx.syncSddPhase(edge.statusTarget);
  } catch (err) {
    ctx.log?.agent?.warn?.("transition: sync .sakti.yaml phase failed (continuing)", {
      sessionId: session.id,
      phase: edge.statusTarget,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/config/__tests__/transition-apply.test.ts`

Expected: PASS — all tests green.

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/transition-apply.ts apps/server/src/agent/config/__tests__/transition-apply.test.ts
git commit -m "feat(transition): add syncSddPhase side-effect to applyTransition"
```

---

### Task A2: Create `buildSyncSddPhase` builder

**Files:**

- Create: `apps/server/src/agent/config/sync-sdd-phase.ts`
- Test: `apps/server/src/agent/config/__tests__/sync-sdd-phase.test.ts`

**Step 1: Write the failing test**

Create `apps/server/src/agent/config/__tests__/sync-sdd-phase.test.ts`:

```typescript
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { buildSyncSddPhase } from "../sync-sdd-phase.ts";

const VALID_YAML = `schema: spec-driven
created: 2026-07-01
workflow: full
phase: build
verify_result: pending
branch_status: pending
archived: false
`;

describe("buildSyncSddPhase", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = mkdtempSync(join(tmpdir(), "sakti-sync-"));
  });

  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
  });

  function setupChangeDir(changeName: string, yaml: string = VALID_YAML) {
    const changeDir = join(worktree, ".sakti", "changes", changeName);
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, ".sakti.yaml"), yaml, "utf-8");
    return changeDir;
  }

  it("returns undefined when worktreePath is null", () => {
    const fn = buildSyncSddPhase({ worktreePath: null, changeName: "foo" });
    expect(fn).toBeUndefined();
  });

  it("returns undefined when changeName is null", () => {
    const fn = buildSyncSddPhase({ worktreePath: "/tmp", changeName: null });
    expect(fn).toBeUndefined();
  });

  it("writes the new phase to .sakti.yaml", async () => {
    const changeDir = setupChangeDir("my-feature");
    const fn = buildSyncSddPhase({ worktreePath: worktree, changeName: "my-feature" });
    expect(fn).toBeDefined();
    await fn!("verify");
    const content = require("node:fs").readFileSync(join(changeDir, ".sakti.yaml"), "utf-8");
    expect(content).toContain("phase: verify");
  });

  it("preserves other fields when writing", async () => {
    const changeDir = setupChangeDir("my-feature");
    const fn = buildSyncSddPhase({ worktreePath: worktree, changeName: "my-feature" });
    await fn!("archive");
    const content = require("node:fs").readFileSync(join(changeDir, ".sakti.yaml"), "utf-8");
    expect(content).toContain("phase: archive");
    expect(content).toContain("workflow: full");
    expect(content).toContain("verify_result: pending");
  });

  it("is a no-op when phase already matches", async () => {
    setupChangeDir("my-feature");
    const fn = buildSyncSddPhase({ worktreePath: worktree, changeName: "my-feature" });
    await fn!("build"); // already build
    // Should not throw, not error — just a no-op
  });

  it("swallows errors gracefully (no throw)", async () => {
    // changeDir does not exist
    const log = { agent: { warn: vi.fn() } };
    const fn = buildSyncSddPhase({ worktreePath: worktree, changeName: "nonexistent" }, log);
    await expect(fn!("verify")).resolves.toBeUndefined();
    // No crash — readChangeMetadata returns null for missing .sakti.yaml
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/config/__tests__/sync-sdd-phase.test.ts`

Expected: FAIL — module `../sync-sdd-phase.ts` not found.

**Step 3: Write minimal implementation**

Create `apps/server/src/agent/config/sync-sdd-phase.ts`:

```typescript
import { join } from "node:path";
import { readChangeMetadata, writeChangeMetadata } from "@sakti-code/sakti";

interface SddPhaseLog {
  agent?: {
    warn?: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

/**
 * Build a `syncSddPhase` callback for `applyTransition`. Reads the existing
 * `.sakti.yaml` from the worktree's change dir, updates the `phase` field,
 * and writes it back. Best-effort — logs and returns on any error.
 *
 * Only touches the WORKTREE's `.sakti.yaml` (never the main project — the
 * main project's change dir is cleaned at graduation and only returns via
 * merge).
 *
 * Returns `undefined` when the session has no worktree or changeName (plan
 * sessions, pre-isolation missions) — the caller skips the sync.
 */
export function buildSyncSddPhase(
  session: { worktreePath: string | null; changeName: string | null },
  log?: SddPhaseLog,
): ((phase: string) => Promise<void>) | undefined {
  if (!session.worktreePath || !session.changeName) return undefined;
  const changeDir = join(session.worktreePath, ".sakti", "changes", session.changeName);

  return async (phase: string) => {
    try {
      const metadata = readChangeMetadata(changeDir);
      if (!metadata) return;
      if (metadata.phase === phase) return;
      writeChangeMetadata(changeDir, { ...metadata, phase });
    } catch (err) {
      log?.agent?.warn?.("transition: sync .sakti.yaml phase failed (continuing)", {
        changeDir,
        phase,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/config/__tests__/sync-sdd-phase.test.ts`

Expected: PASS — all tests green.

**Step 5: Commit**

```bash
git add apps/server/src/agent/config/sync-sdd-phase.ts apps/server/src/agent/config/__tests__/sync-sdd-phase.test.ts
git commit -m "feat(transition): add buildSyncSddPhase builder for worktree .sakti.yaml sync"
```

---

### Task A3: Wire `syncSddPhase` into the auto-chain caller (ws-handler)

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts` (the `runAgentStream` auto-chain path, around line 507-522)

**Step 1: Write the failing test**

This is covered by the existing `auto-chain.test.ts` indirectly, but we add a focused assertion. Add a test that verifies the `.sakti.yaml` is synced after an auto-chain transition. Since the auto-chain tests mock `runPrompt`, we can verify by spying on `buildSyncSddPhase` or by checking that `applyTransition` receives a `syncSddPhase` callback.

Add to `apps/server/src/agent/__tests__/auto-chain.test.ts`:

```typescript
it("syncs .sakti.yaml phase on auto-chain build→verify transition", async () => {
  // The auto-chain must pass syncSddPhase to applyTransition.
  // We spy on applyTransition to capture the ctx.
  const { applyTransition } = await import("../config/transition-apply.ts");
  const spy = vi.spyOn({ applyTransition }, "applyTransition");
  // ... (setup similar to existing auto-chain tests, verify spy was called
  //      with a ctx that has syncSddPhase defined)
  // NOTE: Adapt to existing test harness patterns in auto-chain.test.ts
});
```

**NOTE:** The existing auto-chain tests mock `runPrompt` and check call counts. The simplest approach is to verify in the existing "build→verify auto-chain" test that the `.sakti.yaml` in the worktree has the correct phase after the chain runs. If that's too heavy for the test harness, verify that `applyTransition` receives a non-undefined `syncSddPhase` by spying on it.

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/auto-chain.test.ts`

Expected: FAIL — syncSddPhase not wired.

**Step 3: Write minimal implementation**

In `apps/server/src/agent/ws-handler.ts`, in the auto-chain section (around line 507):

```typescript
import { buildSyncSddPhase } from "./config/sync-sdd-phase.ts";

// ... in the auto-chain block, after forceReset/graduate builders:

const syncSddPhase = buildSyncSddPhase(session, ctx.log);

// ... pass it to applyTransition:
await applyTransition(
  {
    repos: ctx.repos,
    ...(forceReset !== undefined ? { forceReset } : {}),
    ...(graduate !== undefined ? { graduate } : {}),
    ...(syncSddPhase !== undefined ? { syncSddPhase } : {}),
    ...(ctx.log !== undefined ? { log: ctx.log } : {}),
  },
  session,
  edge,
);
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/auto-chain.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/auto-chain.test.ts
git commit -m "feat(transition): wire syncSddPhase into auto-chain transition path"
```

---

### Task A4: Wire `syncSddPhase` into the confirm route (gate approval)

**Files:**

- Modify: `apps/server/src/routes/sessions/confirm.ts` (around line 113-133)

**Step 1: No new test needed — this path is covered by the existing `persist-transition.test.ts` and the `transition-apply.test.ts` tests.** The wiring is identical to the auto-chain path (Task A3).

**Step 2: Write minimal implementation**

In `apps/server/src/routes/sessions/confirm.ts`:

```typescript
import { buildSyncSddPhase } from "../../agent/config/sync-sdd-phase.ts";

// ... in the approve block, after forceReset/graduate/worktreeTeardown builders:

const syncSddPhase = buildSyncSddPhase(
  { worktreePath: existing.worktreePath, changeName: existing.changeName },
  ctx.log,
);

await applyTransition(
  {
    repos: ctx.repos,
    ...(forceReset !== undefined ? { forceReset } : {}),
    ...(graduate !== undefined ? { graduate } : {}),
    ...(worktreeTeardown !== undefined ? { worktreeTeardown } : {}),
    ...(syncSddPhase !== undefined ? { syncSddPhase } : {}),
    ...(ctx.log !== undefined ? { log: ctx.log } : {}),
  },
  existing,
  edge,
);
```

**Step 3: Run tests to verify nothing breaks**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/persist-transition.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
git add apps/server/src/routes/sessions/confirm.ts
git commit -m "feat(transition): wire syncSddPhase into confirm route"
```

---

## Part B: Branch Naming via Transition Tool

### Task B1: Add `branchName` to the transition tool schema

**Files:**

- Modify: `packages/tools/src/transition/index.ts`
- Test: `packages/tools/src/transition/__tests__/transition.test.ts` (create if not exists)

**Step 1: Write the failing test**

Create `packages/tools/src/transition/__tests__/transition.test.ts`:

```typescript
import { describe, expect, it } from "vite-plus/test";
import { createTransitionTool } from "../index.ts";

describe("transition tool", () => {
  it("accepts branchName parameter", () => {
    const tool = createTransitionTool();
    // The schema should have branchName as an optional property
    expect(tool.parameters.properties).toHaveProperty("branchName");
  });

  it("branchName is optional", () => {
    const tool = createTransitionTool();
    // Required array should not include branchName
    const required = tool.parameters.required ?? [];
    expect(required).not.toContain("branchName");
  });

  it("terminate is true (ends the turn)", async () => {
    const tool = createTransitionTool();
    const result = await tool.execute("call-1", { to: "mission", body: "brief" });
    expect(result.terminate).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/tools#test' -- --run packages/tools/src/transition/__tests__/transition.test.ts`

Expected: FAIL — `branchName` property does not exist on schema.

**Step 3: Write minimal implementation**

In `packages/tools/src/transition/index.ts`, add to the schema:

```typescript
const transitionSchema = Type.Object({
  to: Type.String({
    description:
      'The destination phase: "specify" | "build" | "verify" | "archive" | "mission". You decide based on your judgment (e.g. verify clean -> "archive"; verify found issues -> "build"). You do NOT decide gating — the server does.',
  }),
  body: Type.String({
    description:
      "Context that travels with the transition — a mission brief (to: mission), a spec summary (to: build), a completion summary (to: verify), a fixing plan (to: build from verify), or a verify summary (to: archive). Always end your turn after calling transition.",
  }),
  branchName: Type.Optional(
    Type.String({
      description:
        'For to="mission" only. A git branch name with a conventional prefix: feat/ (new capability), fix/ (bug fix), refactor/, docs/, chore/. Example: "feat/codegraph-integration". Omit to let the server default based on workflow classification.',
    }),
  ),
  preserveUnrelated: Type.Optional(
    Type.Literal("stash", {
      description:
        "For to='mission' only: explicitly stash unrelated dirty paths before opening the mission gate.",
    }),
  ),
});
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/tools#test' -- --run packages/tools/src/transition/__tests__/transition.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/tools/src/transition/index.ts packages/tools/src/transition/__tests__/transition.test.ts
git commit -m "feat(tools): add optional branchName to transition tool schema"
```

---

### Task B2: Add `pendingBranchName` column to the DB schema

**Files:**

- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repos/index.ts`
- Generate migration

**Step 1: Write the failing test**

Add to `packages/db/src/__tests__/session-repo.test.ts` (or create if not exists — check for existing repo tests first):

```typescript
it("update accepts pendingBranchName", async () => {
  const session = await repo.create("p1", { kind: "plan" });
  await repo.update(session.id, { pendingBranchName: "feat/my-feature" });
  const updated = repo.findById(session.id);
  expect(updated?.pendingBranchName).toBe("feat/my-feature");
});

it("update clears pendingBranchName with null", async () => {
  const session = await repo.create("p1", {
    kind: "plan",
    pendingBranchName: "feat/my-feature",
  });
  await repo.update(session.id, { pendingBranchName: null });
  const updated = repo.findById(session.id);
  expect(updated?.pendingBranchName).toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/db#test'`

Expected: FAIL — `pendingBranchName` not a recognized field.

**Step 3: Write minimal implementation**

1. In `packages/db/src/schema.ts`, add after `pendingTransitionBody`:

```typescript
pendingBranchName: text("pending_branch_name"),
```

2. In `packages/db/src/repos/index.ts`:

- Add to `create` options type: `pendingBranchName?: string | null;`
- Add to `create` values: `...(options?.pendingBranchName === undefined ? {} : { pendingBranchName: options.pendingBranchName }),`
- Add `"pendingBranchName"` to the `update` method's `Pick` union

3. Generate the migration:

```bash
cd packages/db && npx drizzle-kit generate
```

Or: `vp run '@sakti-code/db#db:generate'`

This creates a new SQL migration file under `packages/db/migrations/` that adds the column.

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/db#test'`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/repos/index.ts packages/db/migrations/ packages/db/src/__tests__/
git commit -m "feat(db): add pendingBranchName column to sessions table"
```

---

### Task B3: Capture `branchName` in `persistTransitionSideEffect`

**Files:**

- Modify: `apps/server/src/agent/ws-handler.ts` — `persistTransitionSideEffect` + `TransitionToolArgs`

**Step 1: Write the failing test**

Add to `apps/server/src/agent/__tests__/persist-transition.test.ts`:

```typescript
it("persists branchName from transition tool-call args", async () => {
  // Setup: call persistTransitionSideEffect with a tool_execution_start event
  // that carries { to: "mission", body: "brief", branchName: "feat/my-thing" }
  // Assert: sessions.update was called with pendingBranchName: "feat/my-thing"
});
```

Adapt to the existing test harness patterns in `persist-transition.test.ts`.

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/persist-transition.test.ts`

Expected: FAIL — `branchName` not captured.

**Step 3: Write minimal implementation**

In `apps/server/src/agent/ws-handler.ts`:

1. Update `TransitionToolArgs` interface:

```typescript
interface TransitionToolArgs {
  body: string;
  to: string;
  branchName?: string;
}
```

2. In `persistTransitionSideEffect`, capture `branchName`:

```typescript
if (event.type === "tool_execution_start") {
  const args = event.args as { to?: unknown; body?: unknown; branchName?: unknown };
  if (typeof args.to === "string" && typeof args.body === "string") {
    pendingTransitionToolCalls.set(event.toolCallId, {
      to: args.to,
      body: args.body,
      ...(typeof args.branchName === "string" ? { branchName: args.branchName } : {}),
    });
  }
  return;
}
```

3. In the persistence call, add `pendingBranchName`:

```typescript
await ctx.repos.sessions.update(sessionId, {
  pendingTransitionTo: args.to,
  pendingTransitionBody: args.body,
  ...(args.branchName !== undefined ? { pendingBranchName: args.branchName } : {}),
});
```

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/__tests__/persist-transition.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/agent/ws-handler.ts apps/server/src/agent/__tests__/persist-transition.test.ts
git commit -m "feat(transition): capture branchName in persistTransitionSideEffect"
```

---

### Task B4: Use `branchName` in `createMissionWorktree`

**Files:**

- Modify: `apps/server/src/lib/worktree.ts` — `createMissionWorktree`, `missionBranchExists`, `missionBranchHead`, `resetMissionBranch`, `deleteMissionBranch`

**Step 1: Write the failing test**

Add to `apps/server/src/lib/__tests__/worktree.test.ts`:

```typescript
describe("custom branch name", () => {
  it("createMissionWorktree uses custom branch when provided", () => {
    initGitRepo(projectDir);
    const wtPath = createMissionWorktree(projectDir, "p1", "my-feature", "feat/my-feature");
    // Branch feat/my-feature should exist
    const branches = execSync("git branch --list", {
      cwd: projectDir,
      shell: "/bin/sh",
      encoding: "utf-8",
    });
    expect(branches).toContain("feat/my-feature");
    expect(branches).not.toContain("sakti/my-feature");
  });

  it("createMissionWorktree falls back to sakti/ prefix when no branchName", () => {
    initGitRepo(projectDir);
    const wtPath = createMissionWorktree(projectDir, "p1", "my-feature");
    const branches = execSync("git branch --list", {
      cwd: projectDir,
      shell: "/bin/sh",
      encoding: "utf-8",
    });
    expect(branches).toContain("sakti/my-feature");
  });

  it("missionBranchExists checks custom branch", () => {
    initGitRepo(projectDir);
    createMissionWorktree(projectDir, "p1", "my-feature", "feat/my-feature");
    expect(missionBranchExists(projectDir, "my-feature", "feat/my-feature")).toBe(true);
    expect(missionBranchExists(projectDir, "my-feature")).toBe(false); // default sakti/ doesn't exist
  });
});
```

**Step 2: Run test to verify it fails**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/lib/__tests__/worktree.test.ts`

Expected: FAIL — `createMissionWorktree` doesn't accept a 4th argument.

**Step 3: Write minimal implementation**

In `apps/server/src/lib/worktree.ts`:

1. Add an optional `branchName` parameter to the 5 branch functions. Derive the branch as:

```typescript
function resolveBranchName(changeName: string, branchName?: string): string {
  return branchName ?? `sakti/${changeName}`;
}
```

2. Update `createMissionWorktree`:

```typescript
export function createMissionWorktree(
  projectCwd: string,
  projectId: string,
  changeName: string,
  branchName?: string,
): string {
  assertSafeChangeName(changeName);
  const base = getWorktreeBaseDir();
  mkdirSync(base, { recursive: true });
  try {
    git(projectCwd, "worktree prune");
  } catch {
    // ignore
  }
  const wtPath = worktreePathFor(base, projectCwd, projectId, changeName);
  const branch = resolveBranchName(changeName, branchName);
  if (branchExists(projectCwd, branch)) {
    git(projectCwd, `worktree add "${wtPath}" ${branch}`);
  } else {
    const detected = detectDefaultBranch(projectCwd);
    if (!detected) {
      throw new Error(`Cannot create worktree: no default branch detected in "${projectCwd}"`);
    }
    git(projectCwd, `worktree add -b ${branch} "${wtPath}" ${detected}`);
  }
  return wtPath;
}
```

3. Update `missionBranchExists`, `missionBranchHead`, `resetMissionBranch`, `deleteMissionBranch` to accept `branchName?` and use `resolveBranchName`.

**Step 4: Run test to verify it passes**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/lib/__tests__/worktree.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts
git commit -m "feat(worktree): support custom branch names in createMissionWorktree"
```

---

### Task B5: Pass `branchName` from confirm route to `createMissionWorktree`

**Files:**

- Modify: `apps/server/src/routes/sessions/confirm.ts`

**Step 1: No new test** — this is wiring only; existing integration tests cover the confirm flow.

**Step 2: Write minimal implementation**

In `apps/server/src/routes/sessions/confirm.ts`, in the plan→mission block, read the pending branch name from the session and pass it:

```typescript
// Inside the plan→mission block, after worktree preflight succeeds:
const wtPath = createMissionWorktree(
  project.cwd,
  existing.projectId,
  changeName,
  existing.pendingBranchName ?? undefined,
);
```

Also clear `pendingBranchName` alongside `pendingTransitionTo`/`pendingTransitionBody` when clearing pending state:

```typescript
await ctx.repos.sessions.update(id, {
  pendingTransitionTo: null,
  pendingTransitionBody: null,
  pendingBranchName: null,
});
```

And in `runAgentStream`'s pending-clear block:

```typescript
await ctx.repos.sessions.update(sessionId, {
  pendingTransitionTo: null,
  pendingTransitionBody: null,
  pendingBranchName: null,
});
```

**Step 3: Run all server tests**

Run: `vp run '@sakti-code/server#test'`

Expected: PASS (only pre-existing terminal test failures)

**Step 4: Commit**

```bash
git add apps/server/src/routes/sessions/confirm.ts apps/server/src/agent/ws-handler.ts
git commit -m "feat(transition): pass branchName from session to createMissionWorktree"
```

---

### Task B6: Update `wrapTransitionTool` to carry `branchName` through

**Files:**

- Modify: `apps/server/src/agent/config/tool-registry.ts` — `wrapTransitionTool`

**Step 1: Check if wrapTransitionTool needs changes.** The wrapper already passes args through to `base.execute`. The `persistTransitionSideEffect` captures args from the event stream, not from the wrapper. So the wrapper may not need changes — verify by checking if the tool args (including `branchName`) flow through the event stream correctly.

**Step 2: If no changes needed, skip this task.** If the wrapper filters args, add `branchName` to the pass-through.

**Step 3: Run tool-registry tests**

Run: `vp run '@sakti-code/server#test' -- --run apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts`

Expected: PASS

---

## Part C: Integration & Cleanup

### Task C1: Run full test suite

**Step 1:** Run all tests:

```bash
vp run -r test
```

Expected: All tests pass (except pre-existing terminal/CLI failures).

**Step 2:** Run checks:

```bash
vp check --fix && vp check
```

Expected: Clean — no warnings, no type errors.

### Task C2: Update PHASE-WORKFLOW.md

**Files:**

- Modify: `.sakti/PHASE-WORKFLOW.md`

Update the "Worktree isolation" section to mention:

1. `.sakti.yaml` phase is synced on each transition (worktree only)
2. Branch names can be customized via the transition tool's `branchName` parameter

### Task C3: Final commit

```bash
git add .sakti/PHASE-WORKFLOW.md
git commit -m "docs: update PHASE-WORKFLOW for phase sync and branch naming"
```

---

## Summary

| Task | What                                      | Files                               |
| ---- | ----------------------------------------- | ----------------------------------- |
| A1   | `syncSddPhase` in `TransitionApplyCtx`    | `transition-apply.ts`               |
| A2   | `buildSyncSddPhase` builder               | `sync-sdd-phase.ts` (new)           |
| A3   | Wire into auto-chain (ws-handler)         | `ws-handler.ts`                     |
| A4   | Wire into confirm route                   | `confirm.ts`                        |
| B1   | `branchName` on transition tool schema    | `tools/transition/index.ts`         |
| B2   | `pendingBranchName` DB column + migration | `db/schema.ts`, `db/repos/index.ts` |
| B3   | Capture `branchName` in persist           | `ws-handler.ts`                     |
| B4   | Custom branch in `createMissionWorktree`  | `worktree.ts`                       |
| B5   | Pass from confirm route to worktree       | `confirm.ts`, `ws-handler.ts`       |
| C1   | Full test suite                           | —                                   |
| C2   | Update docs                               | `PHASE-WORKFLOW.md`                 |
