# Mission Worktree Isolation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Every plan→mission graduation creates a dedicated git worktree + branch for that mission; the mission agent runs isolated in that worktree; a terminal gate cleans up on archive completion.

**Architecture:** A nullable `sessions.worktreePath` column overrides `project.cwd` via a single `resolveSessionCwd` helper threaded through the runner. Worktree create/teardown are side-effect flags on gate edges (`requiresWorktreeCreate` on plan→mission, `requiresWorktreeTeardown` on the new archive→done edge), fired by the confirm route — parallel to graduation/forcedObserve. The transition tool stays pure in `packages/tools`; a server-side wrapper in `tool-registry.ts` runs a read-only git pre-flight so failures surface to the agent. Statuses are renamed 1:1 with phase names; a clean-slate migration regenerates the DB.

**Tech Stack:** TypeScript, Hono, node:sqlite + Drizzle ORM, SolidJS, Vitest, `vp` toolchain, git worktree (via `execSync`).

**Design doc:** `docs/plans/2026-07-08-mission-worktree-isolation-design.md`

**Key commands:**

```bash
vp run '@sakti-code/db#db:generate'        # regenerate Drizzle migrations from schema
vp run '@sakti-code/server#test'            # server tests
vp run desktop#test                         # desktop tests
vp run -r test                              # all tests (3 pre-existing baseline sakti failures expected)
vp check                                    # format + lint + typecheck
```

**Conventions:** TDD. `exactOptionalPropertyTypes: true` (use `delete` / conditional spread, never assign `undefined`). Tests in `__tests__/`. No `.only`/`.skip`. Arrow callbacks, `for...of`, `const` by default, `as const`. SolidJS uses `class`/`for`. Git ops via `execSync` with `shell: "/bin/sh"` (TS 7.0 requirement).

**Context for the implementer:**

- `projects.cwd` (unique per project) is the single cwd today; the runner reads it in ~6 spots (`runner.ts:276,331,344,364,416,539`).
- The transition tool (`packages/tools/src/transition/index.ts`) is a **pure, context-free signal** — `execute()` returns `"Phase transition recorded."` with `terminate: true`. It must stay pure.
- The server's `TOOL_FACTORIES.transition` (`tool-registry.ts:61`) currently ignores `ctx` — `() => createTransitionTool()`. This is where the pre-flight wrapper goes.
- `applyTransition` (`transition-apply.ts`) runs side-effects (forcedObserve, graduation) BEFORE the status flip. Worktree create/teardown slot in here.
- The confirm route (`routes/sessions/confirm.ts`) binds side-effect builders and calls `applyTransition` on approve. It already stamps `changeName` on the plan session for plan→mission.
- `phaseFromSession` (`transition-table.ts:122`) maps DB status → phase. After the rename, status === phase (identity).
- The DB is unused/local — clean-slate migrations are fine (delete all, regenerate).

**Status rename map (mechanical, applied across all tasks):**

```
specifying → specify
building   → build
review     → verify
merged     → archive
(new)      → done
```

---

## Task 1: Schema + clean-slate migrations

**Files:**

- Modify: `packages/db/src/schema.ts`
- Delete: `packages/db/migrations/*` (all folders)
- Modify: `packages/db/src/repos/index.ts` (update type if needed)

### Step 1: Update schema

In `packages/db/src/schema.ts`, update the `sessions` table:

```ts
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle self-referencing FK needs any return type
  parentSessionId: text("parent_session_id").references((): any => sessions.id),
  title: text("title"),
  modelId: text("model_id"),
  profileId: text("profile_id"),
  kind: text("kind").notNull().default("mission"),
  // SDD phase lifecycle: specify → build → verify → archive → done.
  // Plan sessions are unaffected; only mission sessions use this column.
  // Status values align 1:1 with phase names. `done` is terminal.
  status: text("status").notNull().default("specify"),
  // Links a mission session to its SDD change (set when the mission is created
  // from a plan graduation).
  changeName: text("change_name"),
  // Absolute path to the mission's isolated git worktree. Null = run on
  // project.cwd (plan sessions, pre-isolation missions). Set at plan→mission
  // graduation; cleared at archive→done teardown.
  worktreePath: text("worktree_path"),
  // Pending transition tool-call awaiting resolution.
  pendingTransitionTo: text("pending_transition_to"),
  pendingTransitionBody: text("pending_transition_body"),
  thinkingLevel: text("thinking_level").notNull().default("off"),
  leafId: text("leaf_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
```

### Step 2: Delete all existing migrations

```bash
rm -rf packages/db/migrations
```

### Step 3: Regenerate migrations from scratch

```bash
vp run '@sakti-code/db#db:generate'
```

Expected: a single new migration folder is created under `packages/db/migrations/` containing the full schema (including `worktree_path` column and the `specify` default).

### Step 4: Verify the DB initializes

```bash
vp run '@sakti-code/db#test'
```

Expected: PASS (init test creates the DB from the fresh migration). If any test references old status literals, note them for Task 3 — don't fix here.

### Step 5: Commit

```bash
git add -A && git commit -m "feat(db): add worktree_path column + rename status default to specify (clean-slate migrations)"
```

---

## Task 2: Server status rename — transition-table.ts (the core)

**Files:**

- Modify: `apps/server/src/agent/config/transition-table.ts`
- Modify: `apps/server/src/agent/config/__tests__/transition-table.test.ts`

### Step 1: Write failing tests for the new edge + identity mapping

In `apps/server/src/agent/config/__tests__/transition-table.test.ts`, add:

```ts
it("phaseFromSession is identity for mission statuses", () => {
  expect(phaseFromSession({ kind: "mission", status: "specify" })).toBe("specify");
  expect(phaseFromSession({ kind: "mission", status: "build" })).toBe("build");
  expect(phaseFromSession({ kind: "mission", status: "verify" })).toBe("verify");
  expect(phaseFromSession({ kind: "mission", status: "archive" })).toBe("archive");
  expect(phaseFromSession({ kind: "mission", status: "done" })).toBe("done");
});

it("has an archive->done gate edge with worktree teardown", () => {
  expect(hasEdge("archive", "done")).toBe(true);
  const edge = getEdge("archive", "done");
  expect(edge.mode).toBe("gate");
  expect(edge.statusTarget).toBe("done");
  expect(edge.requiresWorktreeTeardown).toBe(true);
});

it("plan->mission edge declares requiresWorktreeCreate", () => {
  const edge = getEdge("plan", "mission");
  expect(edge.requiresWorktreeCreate).toBe(true);
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-table.test.ts
```

Expected: FAIL (old status names, no `done` phase, no new flags).

### Step 3: Update transition-table.ts

Update the `Phase` type (line 19):

```ts
export type Phase = "plan" | "specify" | "build" | "verify" | "archive" | "done" | "mission";
```

Add two flags to `TransitionEdge` (after `requiresGraduation?`):

```ts
  /** Create a mission worktree at plan→mission graduation. plan→mission only. */
  requiresWorktreeCreate?: boolean;
  /** Remove the mission worktree at archive→done teardown. archive→done only. */
  requiresWorktreeTeardown?: boolean;
```

Update the TABLE — rename `statusTarget` values and add the `archive->done` edge:

```ts
const TABLE: Record<string, TransitionEdge> = {
  "plan->mission": {
    from: "plan",
    to: "mission",
    mode: "gate",
    requiresGraduation: true,
    requiresWorktreeCreate: true,
    instruction: instruction(
      'You are now in specify mode. Read proposal.md for this change and produce design.md + tasks.md (always), plus specs deltas when there is a behavior change. Follow the sakti-specify skill. When the spec is ready, call transition({to:"build"}).',
    ),
  },
  "specify->build": {
    from: "specify",
    to: "build",
    mode: "gate",
    statusTarget: "build",
    instruction: instruction(
      'You are now in build mode. Read design.md + tasks.md and implement the change with TDD (failing test first, then minimal implementation, then commit). Check off each task in tasks.md as it lands. When every task is checked AND the project\'s full test suite passes, call transition({to:"verify"}) with a completion summary. Follow the sakti-build skill.',
    ),
  },
  "build->verify": {
    from: "build",
    to: "verify",
    mode: "auto",
    requiresForcedObserve: true,
    statusTarget: "verify",
    instruction: instruction(
      'You are now in verify mode. Review the work for completeness, correctness, and coherence against design.md + specs + tasks.md. You are edit-denied — do not fix issues yourself; if you find any, write a fixing plan and call transition({to:"build"}) carrying it. Only call transition({to:"archive"}) if the work is genuinely clean. Follow the sakti-verify skill.',
    ),
  },
  "verify->build": {
    from: "verify",
    to: "build",
    mode: "auto",
    statusTarget: "build",
    instruction: instruction(
      'You are now back in build mode. Read the fixing plan from the transition call above and address every issue it lists. Then re-run the project\'s full test suite and call transition({to:"verify"}) again only when tests pass. Do not skip to a final review — the verify agent rejected the previous completion for concrete reasons. Follow the sakti-build skill.',
    ),
  },
  "verify->archive": {
    from: "verify",
    to: "archive",
    mode: "gate",
    statusTarget: "archive",
    instruction: instruction(
      'You are now in archive mode. Sync any delta specs into the main specs, then move this change into the archive. When done, call transition({to:"done"}) so the user can finish and clean up the worktree. Follow the sakti-archive skill.',
    ),
  },
  "archive->done": {
    from: "archive",
    to: "done",
    mode: "gate",
    requiresWorktreeTeardown: true,
    statusTarget: "done",
    // Terminal — no agent runs after done.
    instruction: instruction("Archive complete."),
  },
};
```

Update `phaseFromSession` (lines 122-138) to identity:

```ts
export function phaseFromSession(session: { kind: string; status: string }): Phase {
  if (session.kind === "plan") return "plan";
  switch (session.status) {
    case "specify":
      return "specify";
    case "build":
      return "build";
    case "verify":
      return "verify";
    case "archive":
      return "archive";
    case "done":
      return "done";
    default:
      throw new Error(
        `Unknown status "${session.status}" for session kind "${session.kind}" — cannot derive phase.`,
      );
  }
}
```

Update the JSDoc above `phaseFromSession` to reflect the identity mapping.

### Step 4: Update existing tests in the same file

Replace any `"specifying"`, `"building"`, `"review"`, `"merged"` literals in the test file with the new names. The existing "throws for an unknown status" test should now use a bogus value that isn't any of the new names.

### Step 5: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-table.test.ts
```

Expected: PASS.

### Step 6: Commit

```bash
git add -A && git commit -m "feat(server): rename statuses to phase names + add archive->done gate edge"
```

---

## Task 3: Server status rename — consumers

**Files:**

- Modify: `apps/server/src/agent/config/resolve-agent.ts:30,55`
- Modify: `apps/server/src/agent/reminder.ts:17,19`
- Modify: `apps/server/src/agent/config/resolve-observational-memory.ts:138-140`
- Modify: any `__tests__` referencing old status literals in these areas

### Step 1: resolve-agent.ts

Line 55: `status === "review"` → `status === "verify"`.

Update the JSDoc (line 29-30): change `review` → `verify`, `specifying, building, merged` → `specify, build, archive`.

### Step 2: reminder.ts

Lines 17-19 in `autonomousPhaseForSession`:

```ts
switch (session.status) {
  case "build":
    return "build";
  case "verify":
    return "verify";
  default:
    return null;
}
```

### Step 3: resolve-observational-memory.ts

Line ~140: `session.status === "merged"` → `session.status === "archive"`.

Update the comment (line 138) from "archive phase (status === \"merged\")" to "archive phase (status === \"archive\")".

### Step 4: Find + fix remaining server status literals

```bash
rg '"specifying"|"building"|"review"|"merged"' apps/server/src --glob '*.ts'
```

Update every match to the new name. Tests referencing old literals need updating too. (Note: `"review"` may appear in unrelated contexts like code review — only change status-comparison usages.)

### Step 5: Run server tests

```bash
vp run '@sakti-code/server#test'
```

Expected: PASS (except the pre-existing `ws.test.ts` live-API test, which is environment-dependent).

### Step 6: Commit

```bash
git add -A && git commit -m "refactor(server): rename status consumers to phase-aligned names"
```

---

## Task 4: Git ops module (worktree.ts) — TDD

**Files:**

- Create: `apps/server/src/lib/worktree.ts`
- Create: `apps/server/src/lib/__tests__/worktree.test.ts`

### Step 1: Write failing tests

Create `apps/server/src/lib/__tests__/worktree.test.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createMissionWorktree,
  detectDefaultBranch,
  preflightWorktree,
  removeMissionWorktree,
} from "../worktree.ts";

function initGitRepo(dir: string): void {
  execSync("git init -b main", { cwd: dir, shell: "/bin/sh" });
  execSync("git config user.email test@test.com", { cwd: dir, shell: "/bin/sh" });
  execSync("git config user.name test", { cwd: dir, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd: dir, shell: "/bin/sh" });
}

describe("worktree ops", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "sakti-wt-"));
  });

  afterEach(() => {
    // Clean up worktrees + the project dir.
    try {
      execSync("git worktree prune", { cwd: projectDir, shell: "/bin/sh", stdio: "ignore" });
    } catch {
      // ignore
    }
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("detectDefaultBranch", () => {
    it("returns 'main' for a repo initialized with main", () => {
      initGitRepo(projectDir);
      expect(detectDefaultBranch(projectDir)).toBe("main");
    });

    it("returns null for a non-git directory", () => {
      expect(detectDefaultBranch(projectDir)).toBeNull();
    });
  });

  describe("preflightWorktree", () => {
    it("passes for a clean git repo", () => {
      initGitRepo(projectDir);
      expect(preflightWorktree(projectDir)).toBeNull();
    });

    it("returns an error message for a non-git directory", () => {
      const err = preflightWorktree(projectDir);
      expect(err).not.toBeNull();
      expect(err).toContain("git");
    });
  });

  describe("createMissionWorktree + removeMissionWorktree", () => {
    it("creates a worktree at <projectDir>-worktrees/<changeName> and a sakti/<changeName> branch", () => {
      initGitRepo(projectDir);
      const wtPath = createMissionWorktree(projectDir, "add-feature");
      expect(existsSync(wtPath)).toBe(true);
      expect(wtPath).toContain("add-feature");
      expect(wtPath).toContain("-worktrees");
      // The branch exists in the worktree.
      const branch = execSync("git branch --list sakti/add-feature", {
        cwd: projectDir,
        shell: "/bin/sh",
      }).toString();
      expect(branch).toContain("sakti/add-feature");
    });

    it("removeMissionWorktree removes the dir but keeps the branch", () => {
      initGitRepo(projectDir);
      const wtPath = createMissionWorktree(projectDir, "add-feature");
      removeMissionWorktree(projectDir, "add-feature");
      expect(existsSync(wtPath)).toBe(false);
      const branch = execSync("git branch --list sakti/add-feature", {
        cwd: projectDir,
        shell: "/bin/sh",
      }).toString();
      expect(branch).toContain("sakti/add-feature");
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL (module not found).

### Step 3: Implement worktree.ts

Create `apps/server/src/lib/worktree.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, shell: "/bin/sh", encoding: "utf-8" }).trim();
}

/**
 * Detect the repo's default branch via symbolic-ref. Falls back to "main",
 * then "master". Returns null if cwd is not a git repo.
 */
export function detectDefaultBranch(cwd: string): string | null {
  try {
    // Try the local HEAD symbolic-ref first.
    const ref = git(cwd, "symbolic-ref --short HEAD");
    if (ref) return ref;
  } catch {
    // Not on a branch or not a repo — try fallbacks.
  }
  // Fallbacks: check if main/master exists as a branch.
  for (const candidate of ["main", "master"]) {
    try {
      const result = git(cwd, `branch --list ${candidate}`);
      if (result.includes(candidate)) return candidate;
    } catch {
      // not a repo
    }
  }
  // Final fallback: assume main if it's a repo at all.
  try {
    git(cwd, "rev-parse --is-inside-work-tree");
    return "main";
  } catch {
    return null;
  }
}

/**
 * Read-only pre-flight for worktree creation. Returns null if OK, or an
 * error message explaining what's wrong. Used by the transition tool wrapper
 * so failures surface to the agent (not swallowed).
 */
export function preflightWorktree(cwd: string): string | null {
  if (!existsSync(join(cwd, ".git")) && !existsSync(join(dirname(cwd), ".git"))) {
    return `"${cwd}" is not a git repository. Initialize git (git init) before this mission can be isolated in a worktree.`;
  }
  const base = detectDefaultBranch(cwd);
  if (!base) {
    return `Could not detect a default branch in "${cwd}". Ensure the repo has at least one commit on a branch.`;
  }
  return null;
}

/** Compute the sibling worktree directory for a change. */
export function worktreePathFor(projectCwd: string, changeName: string): string {
  return join(dirname(projectCwd), `${basename(projectCwd)}-worktrees`, changeName);
}

/**
 * Create a git worktree + branch for a mission. Returns the absolute worktree
 * path. Throws on failure (caller decides how to surface).
 */
export function createMissionWorktree(projectCwd: string, changeName: string): string {
  const base = detectDefaultBranch(projectCwd);
  if (!base) {
    throw new Error(`Cannot create worktree: no default branch detected in "${projectCwd}"`);
  }
  const wtPath = worktreePathFor(projectCwd, changeName);
  const branch = `sakti/${changeName}`;
  git(projectCwd, `worktree add -b ${branch} "${wtPath}" ${base}`);
  return wtPath;
}

/**
 * Remove a mission worktree. Keeps the branch (commits survive for merge).
 * Never throws — best-effort cleanup.
 */
export function removeMissionWorktree(projectCwd: string, changeName: string): void {
  const wtPath = worktreePathFor(projectCwd, changeName);
  try {
    git(projectCwd, `worktree remove --force "${wtPath}"`);
  } catch {
    // Best-effort; the worktree may already be gone.
  }
}
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add -A && git commit -m "feat(server): git worktree ops module (create, remove, preflight, detectDefaultBranch)"
```

---

## Task 5: applyTransition — worktree side-effects — TDD

**Files:**

- Modify: `apps/server/src/agent/config/transition-apply.ts`
- Modify: `apps/server/src/agent/config/__tests__/transition-apply.test.ts`

### Step 1: Write failing test

In `apps/server/src/agent/config/__tests__/transition-apply.test.ts`, add:

```ts
it("fires worktreeCreate on a requiresWorktreeCreate edge", async () => {
  const calls: string[] = [];
  const repos = { sessions: { update: async () => {} } };
  await applyTransition(
    {
      repos: repos as never,
      worktreeCreate: async () => {
        calls.push("create");
      },
    },
    { id: "s1" },
    { from: "plan", to: "mission", mode: "gate", instruction: "", requiresWorktreeCreate: true },
  );
  expect(calls).toEqual(["create"]);
});

it("fires worktreeTeardown on a requiresWorktreeTeardown edge", async () => {
  const calls: string[] = [];
  const repos = { sessions: { update: async () => {} } };
  await applyTransition(
    {
      repos: repos as never,
      worktreeTeardown: async () => {
        calls.push("teardown");
      },
    },
    { id: "s1" },
    {
      from: "archive",
      to: "done",
      mode: "gate",
      instruction: "",
      statusTarget: "done",
      requiresWorktreeTeardown: true,
    },
  );
  expect(calls).toEqual(["teardown"]);
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-apply.test.ts
```

Expected: FAIL (no `worktreeCreate`/`worktreeTeardown` in the ctx type).

### Step 3: Update transition-apply.ts

Add two optional callbacks to `TransitionApplyCtx`:

```ts
export interface TransitionApplyCtx {
  repos: { sessions: Pick<SessionRepo, "update"> };
  forceReset?: (sessionId: string) => Promise<void>;
  graduate?: (sessionId: string) => Promise<void>;
  /** Bound worktree creation (plan→mission). Best-effort. */
  worktreeCreate?: (sessionId: string) => Promise<void>;
  /** Bound worktree teardown (archive→done). Best-effort. */
  worktreeTeardown?: (sessionId: string) => Promise<void>;
  log?: {
    agent?: {
      warn?: (msg: string, ctx?: Record<string, unknown>) => void;
      info?: (msg: string, ctx?: Record<string, unknown>) => void;
    };
  };
}
```

In `applyTransition`, after the graduation block and before the status flip, add:

```ts
// Worktree creation (plan→mission). Best-effort.
if (edge.requiresWorktreeCreate && ctx.worktreeCreate) {
  try {
    await ctx.worktreeCreate(session.id);
  } catch (err) {
    ctx.log?.agent?.warn?.("transition: worktree creation failed (continuing)", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Worktree teardown (archive→done). Best-effort.
if (edge.requiresWorktreeTeardown && ctx.worktreeTeardown) {
  try {
    await ctx.worktreeTeardown(session.id);
  } catch (err) {
    ctx.log?.agent?.warn?.("transition: worktree teardown failed (continuing)", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-apply.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add -A && git commit -m "feat(server): worktree create/teardown side-effects in applyTransition"
```

---

## Task 6: resolveSessionCwd + runner threading — TDD

**Files:**

- Create: `apps/server/src/agent/config/resolve-session-cwd.ts`
- Create: `apps/server/src/agent/config/__tests__/resolve-session-cwd.test.ts`
- Modify: `apps/server/src/agent/runner.ts` (lines 276, 331, 344, 364, 416, 539)

### Step 1: Write failing test

Create `apps/server/src/agent/config/__tests__/resolve-session-cwd.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { resolveSessionCwd } from "../resolve-session-cwd.ts";

describe("resolveSessionCwd", () => {
  it("returns worktreePath when set", () => {
    expect(resolveSessionCwd({ worktreePath: "/repo-wt/change" }, { cwd: "/repo" })).toBe(
      "/repo-wt/change",
    );
  });

  it("falls back to project.cwd when worktreePath is null", () => {
    expect(resolveSessionCwd({ worktreePath: null }, { cwd: "/repo" })).toBe("/repo");
  });
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/resolve-session-cwd.test.ts
```

Expected: FAIL (module not found).

### Step 3: Implement resolve-session-cwd.ts

Create `apps/server/src/agent/config/resolve-session-cwd.ts`:

```ts
/**
 * Resolve the working directory for a session. Missions with a worktreePath
 * run in their isolated git worktree; everything else (plan sessions,
 * pre-isolation missions) runs on the project's cwd. Single source of truth
 * for cwd — the runner routes all cwd usage through this.
 */
export function resolveSessionCwd(
  session: { worktreePath: string | null },
  project: { cwd: string },
): string {
  return session.worktreePath ?? project.cwd;
}
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/resolve-session-cwd.test.ts
```

Expected: PASS.

### Step 5: Thread through runner.ts

In `apps/server/src/agent/runner.ts`, after the project is loaded (around line 308-315), compute the cwd once:

```ts
import { resolveSessionCwd } from "./config/resolve-session-cwd.ts";
// ...
const cwd = resolveSessionCwd(session, project);
ctx.log?.agent.debug("resolved cwd", {
  sessionId,
  projectId: project.id,
  cwd,
  worktreePath: session.worktreePath,
});
```

Then replace every `project.cwd` usage in the run path with `cwd`:

- Line 276 (edit-mode rebuild): `cwd: project.cwd` → `cwd: resolveSessionCwd(session, project)` (this is in a different function — recompute there, since `session` and `project` are in scope).
- Line 331: `new NodeExecutionEnv(project.cwd)` → `new NodeExecutionEnv(cwd)`
- Line 344: `loadAgentContext(project.cwd)` → `loadAgentContext(cwd)`
- Line 364: `toolCtx: { cwd: project.cwd, ... }` → `toolCtx: { cwd, ... }`
- Line 416: `gatherEnvironmentInfo(project.cwd, ...)` → `gatherEnvironmentInfo(cwd, ...)`
- Line 539: check context and update if it's a cwd reference.

For line 276 (the `setEditMode` function), the session + project are loaded inside an `if` — add the resolve call there:

```ts
    const project = ctx.repos.projects.findById(session.projectId);
    if (project) {
      const editCtx: ToolContext = {
        cwd: resolveSessionCwd(session, project),
        // ...
```

### Step 6: Run server tests

```bash
vp run '@sakti-code/server#test'
```

Expected: PASS (except pre-existing ws.test.ts).

### Step 7: Commit

```bash
git add -A && git commit -m "feat(server): resolveSessionCwd helper — runner routes cwd through worktreePath override"
```

---

## Task 7: Transition tool pre-flight wrapper — TDD

**Files:**

- Modify: `apps/server/src/agent/config/tool-registry.ts:61`
- Modify: `apps/server/src/agent/config/__tests__/tool-registry.test.ts` (or create if absent)

### Step 1: Write failing test

Create or add to `apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts`:

```ts
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildAgentTools, type ToolContext } from "../tool-registry.ts";

function makeCtx(cwd: string): ToolContext {
  return {
    cwd,
    editMode: "normal" as never,
    noopOwner: {},
    snapshotStore: {} as never,
  };
}

describe("transition tool wrapper", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sakti-tt-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an error (no terminate) when to=mission and cwd is not a git repo", async () => {
    const tools = buildAgentTools(["transition"], makeCtx(dir));
    const result = await tools[0].execute({ to: "mission", body: "brief" } as never);
    expect(result.terminate).toBe(false);
    const text = result.content[0];
    expect(text.type === "text" && text.text.toLowerCase()).toContain("git");
  });

  it("terminates normally when to=mission and cwd is a git repo", () => {
    execSync("git init -b main", { cwd: dir, shell: "/bin/sh" });
    execSync("git config user.email t@t.com", { cwd: dir, shell: "/bin/sh" });
    execSync("git config user.name t", { cwd: dir, shell: "/bin/sh" });
    execSync("git commit --allow-empty -m init", { cwd: dir, shell: "/bin/sh" });
    return Promise.resolve().then(async () => {
      const tools = buildAgentTools(["transition"], makeCtx(dir));
      const result = await tools[0].execute({ to: "mission", body: "brief" } as never);
      expect(result.terminate).toBe(true);
    });
  });

  it("always terminates normally for non-mission destinations (no pre-flight)", async () => {
    const tools = buildAgentTools(["transition"], makeCtx(dir));
    const result = await tools[0].execute({ to: "build", body: "spec" } as never);
    expect(result.terminate).toBe(true);
  });
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-tool-wrapper.test.ts
```

Expected: FAIL (the current transition factory ignores ctx and always terminates).

### Step 3: Implement the wrapper in tool-registry.ts

Update the `transition` factory (line 61) and add a wrapper function:

```ts
import { preflightWorktree } from "../../lib/worktree.ts";
// ...

/**
 * Wrap the pure transition tool with a read-only git pre-flight for plan→mission.
 * If the worktree can't be created (not a git repo, no default branch), return
 * an error result with terminate:false so the agent stays alive and can inform
 * the user. The pure tool in packages/tools stays context-free.
 */
function wrapTransitionTool(ctx: ToolContext): AgentTool {
  const base = createTransitionTool();
  return {
    ...base,
    async execute(args: { to?: unknown; body?: unknown }) {
      if (args.to === "mission") {
        const err = preflightWorktree(ctx.cwd);
        if (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Cannot transition to mission: ${err} Fix this, then call transition({ to: "mission" }) again.`,
              },
            ],
            details: undefined,
            terminate: false,
          };
        }
      }
      return base.execute(args as never);
    },
  };
}
```

Update the registry entry:

```ts
  transition: (ctx) => wrapTransitionTool(ctx),
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-tool-wrapper.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add -A && git commit -m "feat(server): transition tool pre-flight wrapper — surfaces worktree failures to agent"
```

---

## Task 8: Confirm route — worktree create + teardown — TDD

**Files:**

- Modify: `apps/server/src/routes/sessions/confirm.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`

### Step 1: Write failing tests

In `apps/server/src/routes/sessions/__tests__/confirm.test.ts`, add:

```ts
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("plan→mission approve creates a worktree and stamps worktreePath", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-"));
  execSync("git init -b main", { cwd, shell: "/bin/sh" });
  execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
  execSync("git config user.name t", { cwd, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
  execSync(`mkdir -p ${cwd}/.sakti/changes/add-feature`, { shell: "/bin/sh" });
  execSync(`echo "name: add-feature" > ${cwd}/.sakti/changes/add-feature/.sakti.yaml`, {
    shell: "/bin/sh",
  });

  try {
    const project = await ctx.repos.projects.create("p", cwd);
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "plan",
      status: "specify",
      pendingTransitionTo: "mission",
      pendingTransitionBody: "brief",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "mission", body: "brief" }),
    });

    expect(res.status).toBe(200);
    const after = ctx.repos.sessions.findById(session.id);
    expect(after?.changeName).toBe("add-feature");
    expect(after?.worktreePath).not.toBeNull();
    expect(existsSync(after!.worktreePath!)).toBe(true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

it("archive→done approve removes the worktree", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-2-"));
  execSync("git init -b main", { cwd, shell: "/bin/sh" });
  execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
  execSync("git config user.name t", { cwd, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
  execSync(`git worktree add -b sakti/fix "${cwd}-worktrees/fix" main`, { cwd, shell: "/bin/sh" });

  try {
    const project = await ctx.repos.projects.create("p", cwd);
    const session = await ctx.repos.sessions.create(project.id, {
      kind: "mission",
      status: "archive",
      changeName: "fix",
      worktreePath: `${cwd}-worktrees/fix`,
      pendingTransitionTo: "done",
      pendingTransitionBody: "archive complete",
    });

    const res = await app.request(`/api/sessions/${session.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", to: "done", body: "archive complete" }),
    });

    expect(res.status).toBe(200);
    const after = ctx.repos.sessions.findById(session.id);
    expect(after?.status).toBe("done");
    expect(existsSync(`${cwd}-worktrees/fix`)).toBe(false);
    // Branch survives.
    const branch = execSync("git branch --list sakti/fix", { cwd, shell: "/bin/sh" }).toString();
    expect(branch).toContain("sakti/fix");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: FAIL (confirm route doesn't bind worktreeCreate/worktreeTeardown; existing tests may also need status-literal updates from Task 2-3).

### Step 3: Update confirm route

In `apps/server/src/routes/sessions/confirm.ts`, import the worktree ops and bind the side-effects. Add imports:

```ts
import { createMissionWorktree, removeMissionWorktree } from "../../lib/worktree.ts";
```

In the `approve` block, build the worktree side-effect callbacks and pass them to `applyTransition`. After `graduate` is built (around line 49-52), add:

```ts
const worktreeCreate =
  edge.requiresWorktreeCreate && existing.kind === "plan"
    ? buildWorktreeCreate(ctx, existing)
    : undefined;
const worktreeTeardown = edge.requiresWorktreeTeardown
  ? buildWorktreeTeardown(ctx, existing)
  : undefined;
```

Pass them into `applyTransition`:

```ts
await applyTransition(
  {
    repos: ctx.repos,
    ...(forceReset !== undefined ? { forceReset } : {}),
    ...(graduate !== undefined ? { graduate } : {}),
    ...(worktreeCreate !== undefined ? { worktreeCreate } : {}),
    ...(worktreeTeardown !== undefined ? { worktreeTeardown } : {}),
    ...(ctx.log !== undefined ? { log: ctx.log } : {}),
  },
  existing,
  edge,
);
```

For plan→mission, after the existing `changeName` stamping block, also stamp `worktreePath`:

```ts
if (edge.from === "plan" && edge.to === "mission") {
  const project = ctx.repos.projects.findById(existing.projectId);
  if (project) {
    const changeName = resolveActiveChangeName(project.cwd);
    if (changeName) {
      const wtPath = createMissionWorktree(project.cwd, changeName);
      await ctx.repos.sessions.update(id, { changeName, worktreePath: wtPath });
    }
  }
}
```

Add the two builder functions at the bottom of the file (before the export or after):

```ts
function buildWorktreeCreate(
  ctx: ServerContext,
  session: { id: string; projectId: string },
): (sessionId: string) => Promise<void> {
  return async () => {
    // The actual creation + stamping happens in the plan→mission block above
    // (it needs changeName resolution). This callback is a no-op marker so
    // applyTransition's uniform side-effect pattern stays consistent. Kept for
    // symmetry with graduation/forcedObserve; the real work is inline.
  };
}

function buildWorktreeTeardown(
  ctx: ServerContext,
  session: {
    id: string;
    projectId: string;
    changeName: string | null;
    worktreePath: string | null;
  },
): (sessionId: string) => Promise<void> {
  return async () => {
    const project = ctx.repos.projects.findById(session.projectId);
    if (!project || !session.changeName) return;
    removeMissionWorktree(project.cwd, session.changeName);
  };
}
```

> **Note:** the worktree CREATE is done inline in the plan→mission block (because it needs `resolveActiveChangeName` + the path returned to stamp). The `buildWorktreeCreate` callback is a no-op for symmetry. The worktree TEARDOWN runs via the `applyTransition` side-effect callback (it only needs changeName, already on the session). If the asymmetry bothers you, you can move both inline — but the callback keeps `applyTransition`'s contract uniform.

### Step 4: Update the existing confirm tests' status literals

The existing tests (from the review-fixes work) use `"specifying"`, `"building"`, etc. Rename to the new values.

### Step 5: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: PASS.

### Step 6: Commit

```bash
git add -A && git commit -m "feat(server): confirm route creates worktree at plan→mission + teardown at archive→done"
```

---

## Task 9: Desktop status rename

**Files:**

- Modify: `apps/desktop/src/stores/server/server-store.ts:22`
- Modify: `apps/desktop/src/components/layout/sidebar/sidebar.tsx:45,48`
- Modify: `apps/desktop/src/components/layout/sidebar/mission-row.tsx:21-24`
- Modify: `apps/desktop/src/components/layout/sidebar/archived-accordion.tsx:45`
- Modify: any desktop `__tests__` referencing old status literals

### Step 1: server-store.ts

Line 22:

```ts
status: "specify" | "build" | "verify" | "archive" | "done";
```

### Step 2: sidebar.tsx

Line 45: active missions filter — `m.status !== "done"` (was `!== "merged"`):

```ts
const activeMissions = createMemo(() => missions().filter((m) => m.status !== "done"));
```

Line 48: archived filter — `m.status === "done"` (was `=== "merged"`):

```ts
      .filter((m) => m.status === "done")
```

### Step 3: mission-row.tsx

Lines 21-24:

```ts
const STATUS_LABELS: Record<string, string> = {
  specify: "specify",
  build: "build",
  verify: "verify",
  archive: "archive",
  done: "done",
};
```

### Step 4: archived-accordion.tsx

Line 45:

```ts
              status={"done" as MissionType}
```

### Step 5: Find + fix remaining desktop status literals

```bash
rg '"specifying"|"building"|"review"|"merged"' apps/desktop/src --glob '*.ts' --glob '*.tsx'
```

Update every match (including test files) to the new names.

### Step 6: Run desktop tests

```bash
vp run desktop#test
```

Expected: PASS.

### Step 7: Commit

```bash
git add -A && git commit -m "refactor(desktop): rename mission statuses to phase-aligned names + done terminal"
```

---

## Task 10: Desktop worktreePath carry-through — TDD

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts` (createSession + confirmTransition)
- Modify: `apps/desktop/src/components/onboarding/plan-chat.tsx`
- Modify: `apps/desktop/src/stores/server/__tests__/actions.test.ts`
- Modify: `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`

### Step 1: Update createSession interface + implementation

In `apps/desktop/src/stores/server/actions.ts`, update the `createSession` type (around line 34):

```ts
createSession: (projectId: string, title?: string, changeName?: string, worktreePath?: string) =>
  Promise<SessionMeta | undefined>;
```

Update the implementation (around line 95):

```ts
    async createSession(projectId, title, changeName, worktreePath) {
      try {
        const res = await api.api.sessions.$post({
          json: {
            projectId,
            ...(title === undefined ? {} : { title }),
            ...(changeName === undefined ? {} : { changeName }),
            ...(worktreePath === undefined ? {} : { worktreePath }),
          },
        });
        // ... rest unchanged
```

### Step 2: Update confirmTransition to mirror worktreePath

In the `confirmTransition` implementation, add `worktreePath` to the `updateSession` call (alongside the existing `changeName` mirror):

```ts
server.actions.updateSession(sessionId, {
  status: updated.status,
  ...(updated.changeName !== undefined ? { changeName: updated.changeName } : {}),
  ...(updated.worktreePath !== undefined ? { worktreePath: updated.worktreePath } : {}),
  pendingTransitionTo: null,
  pendingTransitionBody: null,
});
```

### Step 3: Update plan-chat.tsx handleConfirmSession

After `confirmTransition` and reading `changeName`, also read `worktreePath` and pass it to `createSession`:

```ts
const changeName = server.store.sessions[sid]?.changeName ?? undefined;
const worktreePath = server.store.sessions[sid]?.worktreePath ?? undefined;
// ...
const missionSession = await actions.createSession(
  props.projectId,
  title,
  changeName,
  worktreePath,
);
```

### Step 4: Update SessionMeta type

Ensure the `SessionMeta` type (in `server-store.ts` or wherever it's defined) includes `worktreePath: string | null`.

### Step 5: Update server createSession route

In `apps/server/src/routes/sessions/index.ts` (or wherever `POST /api/sessions` lives), accept and persist `worktreePath` in the request body (same pattern as `changeName`). Check the typebox validator schema there.

### Step 6: Update tests

In `apps/desktop/src/stores/server/__tests__/actions.test.ts`, update the `confirmTransition` test mock to include `worktreePath` in the response, and add an assertion that it's mirrored. In `plan-chat.test.tsx`, update mocks as needed.

### Step 7: Run tests

```bash
vp run desktop#test && vp run '@sakti-code/server#test' -- src/routes/sessions
```

Expected: PASS.

### Step 8: Commit

```bash
git add -A && git commit -m "feat: carry worktreePath from plan→mission confirm to the new mission session"
```

---

## Task 11: TransitionCard "done" destination — TDD

**Files:**

- Modify: `apps/desktop/src/components/chat-area/parts/transition-card.tsx`
- Modify: `apps/desktop/src/components/chat-area/parts/__tests__/transition-card.test.tsx`

### Step 1: Write failing test

In `transition-card.test.tsx`, add:

```ts
  it("renders the done-destination copy with Finish/Keep buttons", () => {
    render(() => <TransitionCard to="done" body="Archive complete." onApprove={() => {}} onReject={() => {}} />);
    expect(screen.getByText("Archive Complete")).toBeTruthy();
    expect(screen.getByText("Finish & Remove Worktree")).toBeTruthy();
    expect(screen.getByText("Keep")).toBeTruthy();
  });
```

### Step 2: Run test to verify it fails

```bash
vp run desktop#test -- src/components/chat-area/parts/__tests__/transition-card.test.tsx
```

Expected: FAIL (no "done" in TransitionGateTo / COPY).

### Step 3: Update transition-card.tsx

Add `"done"` to `TransitionGateTo` and `COPY`:

```ts
export type TransitionGateTo = "archive" | "build" | "done" | "mission";

const COPY: Record<
  TransitionGateTo,
  { title: string; approve: string; reject: string; icon: typeof FiClipboard }
> = {
  mission: { title: "Proposed Mission", approve: "Create", reject: "Revise", icon: FiClipboard },
  build: { title: "Proposed Spec", approve: "Approve", reject: "Revise", icon: FiFileText },
  archive: {
    title: "Ready to Archive",
    approve: "Archive",
    reject: "Request changes",
    icon: FiCheckCircle,
  },
  done: {
    title: "Archive Complete",
    approve: "Finish & Remove Worktree",
    reject: "Keep",
    icon: FiCheckCircle,
  },
};
```

### Step 4: Run test to verify it passes

```bash
vp run desktop#test -- src/components/chat-area/parts/__tests__/transition-card.test.tsx
```

Expected: PASS.

### Step 5: Commit

```bash
git add -A && git commit -m "feat(desktop): TransitionCard 'done' destination for archive-complete gate"
```

---

## Task 12: Final verification

### Step 1: Full test suite

```bash
vp run -r test
```

Expected: all pass except the 3 pre-existing baseline failures in `packages/sakti` and the `ws.test.ts` live-API test (environment-dependent).

### Step 2: Check

```bash
vp check --fix
```

Expected: 0 errors (the plan `.md` formatting warning is pre-existing and ignorable).

### Step 3: Sanity greps

```bash
# No old status literals remain in app code:
rg '"specifying"|"building"|"review"|"merged"' apps packages --glob '*.ts' --glob '*.tsx'
# Expect: none (review-related false positives excepted).

# worktreePath flows through:
rg "worktreePath" apps --glob '*.ts' --glob '*.tsx' | wc -l
# Expect: several matches (schema, runner, actions, plan-chat, confirm route).
```

### Step 4: Manual smoke check (optional)

If you can run the desktop app:

```bash
vp run desktop#dev
```

- Open a project, create a plan session, plan a change that produces a `.sakti/changes/<name>/` dir.
- Call transition to mission → card renders → approve.
- Verify the mission session runs in `<projectDir>-worktrees/<changeName>/` (check the agent's `read` tool shows worktree-relative paths).
- Run the phases through to archive → the terminal "Archive Complete" card renders → approve → worktree dir removed, branch `sakti/<changeName>` survives.

### Step 5: Final commit (if any check fixes)

```bash
git add -A && git commit -m "chore: final verification fixes for mission worktree isolation"
```
