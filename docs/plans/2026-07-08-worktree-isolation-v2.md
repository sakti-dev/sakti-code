# Worktree Isolation v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Relocate mission worktrees under `~/.sakti/projects/`, symlink `node_modules` so missions can run the project's scripts, and commit the SDD change content onto the mission branch (keeping the main repo clean) — gated by a "clean working tree" guardrail in the transition tool.

**Architecture:** Worktrees move from a sibling `<repo>-worktrees/<change>` dir to `~/.sakti/projects/<projectBasename>--<changeName>` (collision-safe). At plan→mission graduation the server creates the worktree, copies `.sakti/changes/<change>/` into it and commits it as the branch's first commit, removes the copy from main (main stays clean), and symlinks the main repo's `node_modules` into the worktree. The transition tool's pre-flight refuses graduation when the working tree is dirty outside `.sakti/changes/<activeChange>/`.

**Tech Stack:** TypeScript, node:sqlite + Drizzle, Hono, node:fs (`cpSync`/`symlinkSync`/`rmSync`), git via `execSync`, Vitest, `vp` toolchain.

**Design doc:** `docs/plans/2026-07-08-worktree-isolation-v2-design.md`

**Key commands:**

```bash
vp run '@sakti-code/server#test'            # server tests
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts   # one file
vp run desktop#test                         # desktop tests
vp run -r test                              # all tests (3 pre-existing sakti baseline failures expected)
vp check                                    # format + lint + typecheck
```

**Conventions:** TDD. `exactOptionalPropertyTypes: true` (conditional spread, never assign `undefined`). Tests in `__tests__/`, vitest (`vite-plus/test`). No `.only`/`.skip`. Arrow callbacks, `for...of`, `const`, `as const`. Git ops via `execSync` with `shell: "/bin/sh"` (TS 7.0). No comments unless asked.

**Context for the implementer:**

- `apps/server/src/lib/config-dirs.ts` — `getAgentDir()` → `~/.sakti/agent` (env-overridable via `SAKTI_AGENT_DIR`). `dirname(getAgentDir())` = `~/.sakti/` (the data root; logs and `sessions.db` are siblings). Add the worktree base here.
- `apps/server/src/lib/worktree.ts` — current ops: `detectDefaultBranch`, `preflightWorktree(cwd)`, `worktreePathFor(projectCwd, changeName)` (sibling dir), `createMissionWorktree(projectCwd, changeName)`, `removeMissionWorktree(projectCwd, changeName)`. This plan reworks location, preflight, and adds absorb/clean/symlink.
- `apps/server/src/routes/sessions/confirm.ts` — plan→mission block (inside the approve `try`) currently: resolve changeName → `createMissionWorktree` → stamp `worktreePath`+`changeName`. This plan inserts absorb → clean → symlink and passes `projectId`.
- `apps/server/src/agent/config/tool-registry.ts` — `wrapTransitionTool` calls `preflightWorktree(ctx.cwd)` when `to === "mission"`. This plan resolves the active change and passes it so preflight can check the working tree is clean.
- `apps/server/src/agent/config/resolve-change-name.ts` — `resolveActiveChangeName(projectCwd)` → most-recently-modified change slug in `.sakti/changes/`, or null.
- `apps/desktop/src/components/onboarding/plan-chat.tsx` — `handleConfirmSession` reads `changeName` from the plan session post-confirm and calls `createSession(projectId, title, changeName)` but **never passes `worktreePath`** (v1 bug). The mission is born with `worktreePath: null` and runs unisolated. This plan fixes it (Task 8) — a prerequisite for v2 doing anything.
- The DB column `sessions.worktreePath` already exists; the server `POST /api/sessions` already accepts `worktreePath`; the desktop `createSession` signature already has the 4th `worktreePath?` param. Only the call site is wrong.
- `git status --porcelain` output format: two status chars then a space then `path` (paths are relative to the repo root, quoted if special). For tracking we only care whether each path starts with `.sakti/changes/<change>/`.

---

## Task 1: Worktree base dir resolver

**Files:**

- Modify: `apps/server/src/lib/config-dirs.ts`
- Modify: `apps/server/src/lib/__tests__/config-dirs.test.ts`

### Step 1: Write the failing test

Add to `apps/server/src/lib/__tests__/config-dirs.test.ts`:

```ts
import { getWorktreeBaseDir } from "../config-dirs.ts";

it("getWorktreeBaseDir is a sibling of the agent dir (<parent>/projects)", () => {
  process.env.SAKTI_AGENT_DIR = "/tmp/sakti-test-agent";
  expect(getWorktreeBaseDir()).toBe("/tmp/sakti-test-agent/../projects");
  // Normalize: it lives under the same parent as the agent dir.
  const { dirname } = await import("node:path");
  expect(dirname(getWorktreeBaseDir())).toBe(dirname("/tmp/sakti-test-agent"));
  delete process.env.SAKTI_AGENT_DIR;
});
```

(If the existing test file already sets/clears `SAKTI_AGENT_DIR` in beforeEach, follow that pattern instead of inline.)

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/config-dirs.test.ts
```

Expected: FAIL (`getWorktreeBaseDir` is not exported).

### Step 3: Implement

In `apps/server/src/lib/config-dirs.ts`, add (next to `getLogDir`):

```ts
/**
 * Returns the worktree base directory: `<agentDirParent>/projects` (i.e.
 * `~/.sakti/projects` by default). Mission worktrees live here, under
 * `<projectBasename>--<changeName>`, so they don't clutter the user's project
 * tree. Honors `SAKTI_AGENT_DIR` (moves with the rest of sakti state).
 */
export function getWorktreeBaseDir(): string {
  return join(dirname(getAgentDir()), "projects");
}
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/config-dirs.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/server/src/lib/config-dirs.ts apps/server/src/lib/__tests__/config-dirs.test.ts
git commit -m "feat(server): worktree base dir resolver (~/.sakti/projects)"
```

---

## Task 2: New worktree location + collision suffix

**Files:**

- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`

### Step 1: Write failing tests

Add to `apps/server/src/lib/__tests__/worktree.test.ts` (inside the top `describe`):

```ts
import { worktreePathFor } from "../worktree.ts";

describe("worktreePathFor", () => {
  it("returns <base>/<projectBasename>--<changeName>", () => {
    expect(worktreePathFor("/tmp/base", "/home/u/code/myapp", "pid1", "add-thing")).toBe(
      "/tmp/base/myapp--add-thing",
    );
  });

  it("appends --<projectId[:8]> when the primary path already exists", () => {
    const base = mkdtempSync(join(tmpdir(), "sakti-wp-"));
    const projectCwd = "/home/u/code/myapp";
    // Pre-create the primary path so it collides.
    mkdirSync(join(base, "myapp--dupe"), { recursive: true });
    const p = worktreePathFor(base, projectCwd, "abcdefgh12345678", "dupe");
    expect(p).toBe(join(base, "myapp--dupe--abcdefgh"));
    rmSync(base, { recursive: true, force: true });
  });

  it("does not append a suffix when there is no collision", () => {
    const base = mkdtempSync(join(tmpdir(), "sakti-wp2-"));
    const p = worktreePathFor(base, "/home/u/code/myapp", "pid1", "clean");
    expect(p).toBe(join(base, "myapp--clean"));
    rmSync(base, { recursive: true, force: true });
  });
});
```

Add the imports `mkdirSync` to the existing `node:fs` import at the top of the test file.

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL (current `worktreePathFor` takes 2 args and returns the sibling dir).

### Step 3: Implement

In `apps/server/src/lib/worktree.ts`, replace `worktreePathFor`:

```ts
import { existsSync, mkdirSync } from "node:fs"; // add to existing imports as needed
import { getWorktreeBaseDir } from "./config-dirs.ts";

/**
 * Compute the worktree directory for a change under the sakti data dir:
 * `<base>/<projectBasename>--<changeName>`. If that exact path already exists
 * (a different project with the same basename + change), append
 * `--<projectId[:8]>` so two same-named projects don't collide. `base` is the
 * worktree base dir (pass explicitly for tests; production uses
 * {@link getWorktreeBaseDir}).
 */
export function worktreePathFor(
  base: string,
  projectCwd: string,
  projectId: string,
  changeName: string,
): string {
  const primary = join(base, `${basename(projectCwd)}--${changeName}`);
  if (existsSync(primary)) {
    return join(base, `${basename(projectCwd)}--${changeName}--${projectId.slice(0, 8)}`);
  }
  return primary;
}
```

Remove the old 2-arg `worktreePathFor`. Keep the `basename`/`join` imports; drop `dirname` if now unused.

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: PASS for the new `worktreePathFor` tests. (Existing create/remove tests will now FAIL — they're updated in Task 5. That's expected mid-plan.)

### Step 5: Commit

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts
git commit -m "feat(server): worktree location under ~/.sakti/projects with collision suffix"
```

---

## Task 3: absorbChangeContent helper

Copy `.sakti/changes/<change>/` from the main repo into the worktree and commit it as the branch's first commit.

**Files:**

- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`

### Step 1: Write failing test

Add to `apps/server/src/lib/__tests__/worktree.test.ts`:

```ts
import { absorbChangeContent } from "../worktree.ts";
import { writeFileSync } from "node:fs";

describe("absorbChangeContent", () => {
  it("copies .sakti/changes/<change>/ into the worktree and commits it on the branch", () => {
    initGitRepo(projectDir);
    // Main repo has an uncommitted change dir.
    mkdirSync(join(projectDir, ".sakti/changes/add-feature"), { recursive: true });
    writeFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "# proposal");
    // Create the worktree (base checkout, no change dir).
    const wt = createMissionWorktree(projectDir, "proj-aaaaaaaa", "add-feature");
    absorbChangeContent(projectDir, wt, "add-feature");
    // The change dir now exists in the worktree AND is committed on sakti/add-feature.
    expect(existsSync(join(wt, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
    const committed = execSync(`git -C "${wt}" show --stat --oneline HEAD`, {
      shell: "/bin/sh",
    }).toString();
    expect(committed).toContain(".sakti/changes/add-feature/proposal.md");
  });

  it("is a no-op when main has no change dir", () => {
    initGitRepo(projectDir);
    const wt = createMissionWorktree(projectDir, "proj-bbbbbbbb", "nochange");
    expect(() => absorbChangeContent(projectDir, wt, "nochange")).not.toThrow();
  });
});
```

Add `createMissionWorktree` to the existing import list (it already exports it). The `initGitRepo` helper already exists in the file.

> Note: this task's test calls `createMissionWorktree` with the NEW 3-arg signature `(projectCwd, projectId, changeName)`. That signature is implemented in Task 5. To keep tasks independently green, implement the `createMissionWorktree` signature change FIRST within this task's Step 3 (it's mechanical — see Task 5 Step 3). Alternatively, run this task's test expecting FAIL until Task 5. Simplest: do the signature bump here.

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL (`absorbChangeContent` not exported).

### Step 3: Implement

In `apps/server/src/lib/worktree.ts`, add (and bump `createMissionWorktree`/`removeMissionWorktree` signatures per Task 5 Step 3 now, so this compiles):

```ts
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";

/**
 * Copy the main repo's uncommitted `.sakti/changes/<change>/` into the
 * worktree and commit it on the mission branch as the first commit. The
 * specify agent then reads proposal.md from the worktree and writes
 * design.md/tasks.md as further commits. Idempotent-ish: a no-op (no throw)
 * when main has no change dir.
 */
export function absorbChangeContent(projectCwd: string, wtPath: string, changeName: string): void {
  const src = join(projectCwd, ".sakti", "changes", changeName);
  if (!existsSync(src)) return;
  const dest = join(wtPath, ".sakti", "changes", changeName);
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  git(wtPath, "add .sakti/changes");
  git(wtPath, `commit -m "sakti: begin change ${changeName}"`);
}
```

Also apply the `createMissionWorktree` / `removeMissionWorktree` signature changes from Task 5 now (so imports compile): `createMissionWorktree(projectCwd, projectId, changeName)` and `removeMissionWorktree(projectCwd, wtPath)`.

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts
git commit -m "feat(server): absorbChangeContent — commit change files onto the mission branch"
```

---

## Task 4: cleanMainChangeDir + symlinkNodeModules helpers

**Files:**

- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`

### Step 1: Write failing tests

Add to `apps/server/src/lib/__tests__/worktree.test.ts`:

```ts
import { cleanMainChangeDir, symlinkNodeModules } from "../worktree.ts";
import { readlinkSync } from "node:fs";

describe("cleanMainChangeDir", () => {
  it("removes the change dir from the main working tree", () => {
    initGitRepo(projectDir);
    const dir = join(projectDir, ".sakti/changes/killme");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "proposal.md"), "x");
    cleanMainChangeDir(projectDir, "killme");
    expect(existsSync(dir)).toBe(false);
  });

  it("is a no-op when the dir is absent", () => {
    initGitRepo(projectDir);
    expect(() => cleanMainChangeDir(projectDir, "absent")).not.toThrow();
  });
});

describe("symlinkNodeModules", () => {
  it("symlinks main's node_modules into the worktree when both exist", () => {
    initGitRepo(projectDir);
    mkdirSync(join(projectDir, "node_modules"), { recursive: true });
    const wt = createMissionWorktree(projectDir, "proj-cccccccc", "dep");
    symlinkNodeModules(projectCwd(projectDir), wt);
    const link = readlinkSync(join(wt, "node_modules"));
    expect(link).toBe(join(projectDir, "node_modules"));
  });

  it("is a no-op when main has no node_modules", () => {
    initGitRepo(projectDir);
    const wt = createMissionWorktree(projectDir, "proj-dddddddd", "nodep");
    expect(() => symlinkNodeModules(projectDir, wt)).not.toThrow();
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
  });
});
```

(`projectCwd` is just `projectDir` here — the helper isn't required; drop the wrapper and pass `projectDir` directly if cleaner.)

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL (exports missing).

### Step 3: Implement

In `apps/server/src/lib/worktree.ts`, add:

```ts
/**
 * Remove `.sakti/changes/<change>/` from the main working tree after its
 * content has been committed onto the mission branch. Keeps the main repo
 * clean (the content returns to main only via merge of `sakti/<change>`).
 * No-op when absent. Assumes the dir is untracked (enforced by the transition
 * guardrail); a tracked dir would need `git rm` — out of scope.
 */
export function cleanMainChangeDir(projectCwd: string, changeName: string): void {
  const dir = join(projectCwd, ".sakti", "changes", changeName);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Symlink the main repo's `node_modules` into the worktree so the mission can
 * run the project's scripts (tests) without reinstalling. Absolute target so it
 * resolves regardless of the worktree's location. No-op when main has no
 * node_modules or the worktree already has one.
 */
export function symlinkNodeModules(projectCwd: string, wtPath: string): void {
  const target = join(projectCwd, "node_modules");
  const link = join(wtPath, "node_modules");
  if (!existsSync(target) || existsSync(link)) return;
  symlinkSync(target, link, "dir");
}
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts
git commit -m "feat(server): cleanMainChangeDir + symlinkNodeModules helpers"
```

---

## Task 5: createMissionWorktree / removeMissionWorktree new signatures

`createMissionWorktree` needs `projectId` for the collision suffix; `removeMissionWorktree` takes the authoritative stored worktree path (not a recomputed one — collision suffixes make recomputation unreliable).

**Files:**

- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`

### Step 1: Update the existing create/remove tests to the new signatures

In `apps/server/src/lib/__tests__/worktree.test.ts`, the existing tests in `describe("createMissionWorktree + removeMissionWorktree", ...)` call `createMissionWorktree(projectDir, "add-feature")` and `removeMissionWorktree(projectDir, "add-feature")`. Update them:

```ts
// createMissionWorktree gains a projectId arg (3rd); removeMissionWorktree
// takes the stored worktree path (2nd) instead of changeName.
const wt = createMissionWorktree(projectDir, "proj-test001", "add-feature");
// ...
removeMissionWorktree(projectDir, wt);
```

Apply to every existing call in that describe block (the "creates a worktree…", "removes the dir but keeps the branch", and "reuses a surviving branch" tests). For the reuse test, both creations must use the same projectId so the collision logic produces the same path.

Set `SAKTI_AGENT_DIR` to a temp dir in `beforeEach` (so `getWorktreeBaseDir()` resolves to a writable tmp spot) and clean it in `afterEach`:

```ts
beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "sakti-wt-"));
  process.env.SAKTI_AGENT_DIR = join(projectDir, "agent");
});
afterEach(() => {
  // existing prune + rmSync(projectDir) ...
  delete process.env.SAKTI_AGENT_DIR;
});
```

### Step 2: Run tests to verify they fail

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL (signature mismatch) until Step 3.

### Step 3: Implement

In `apps/server/src/lib/worktree.ts`, replace `createMissionWorktree` and `removeMissionWorktree`:

```ts
export function createMissionWorktree(
  projectCwd: string,
  projectId: string,
  changeName: string,
): string {
  const base = getWorktreeBaseDir();
  mkdirSync(base, { recursive: true });
  // Prune stale worktree metadata so an existsSync-collision isn't a false
  // positive from a half-removed prior worktree.
  try {
    git(projectCwd, "worktree prune");
  } catch {
    // ignore
  }
  const wtPath = worktreePathFor(base, projectCwd, projectId, changeName);
  const branch = `sakti/${changeName}`;
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

/**
 * Remove a mission worktree by its stored path. Keeps the branch. Best-effort.
 */
export function removeMissionWorktree(projectCwd: string, wtPath: string): void {
  try {
    git(projectCwd, `worktree remove --force "${wtPath}"`);
  } catch {
    // Best-effort; the worktree may already be gone.
  }
}
```

(`getWorktreeBaseDir` is imported from `./config-dirs.ts` — add the import if Task 2/3 didn't already.)

### Step 4: Run tests to verify they pass

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: PASS (all worktree tests green).

### Step 5: Commit

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts
git commit -m "feat(server): create/removeMissionWorktree — projectId + stored-path signatures"
```

---

## Task 6: Transition-tool "clean working tree" guardrail

`preflightWorktree` gains the active change name and rejects graduation when the working tree is dirty outside `.sakti/changes/<change>/`. The wrapper resolves the active change and passes it.

**Files:**

- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/agent/config/tool-registry.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`
- Modify: `apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts`

### Step 1: Write failing tests

In `apps/server/src/lib/__tests__/worktree.test.ts`, add a `preflightWorktree` describe block:

```ts
import { preflightWorktree } from "../worktree.ts";

describe("preflightWorktree clean check", () => {
  it("passes when only .sakti/changes/<change>/ is dirty", () => {
    initGitRepo(projectDir);
    mkdirSync(join(projectDir, ".sakti/changes/add"), { recursive: true });
    writeFileSync(join(projectDir, ".sakti/changes/add/proposal.md"), "x");
    expect(preflightWorktree(projectDir, "add")).toBeNull();
  });

  it("returns an error when an unrelated file is dirty", () => {
    initGitRepo(projectDir);
    writeFileSync(join(projectDir, "src/dirty.ts"), "oops");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    const err = preflightWorktree(projectDir, "add");
    expect(err).not.toBeNull();
    expect(err).toContain("clean");
  });

  it("requires a fully clean tree when no active change is given", () => {
    initGitRepo(projectDir);
    writeFileSync(join(projectDir, "loose.txt"), "x");
    expect(preflightWorktree(projectDir, null)).not.toBeNull();
  });
});
```

In `apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts`, add:

```ts
it("returns an error (no terminate) when to=mission and the tree is dirty outside .sakti/changes", async () => {
  execSync("git init -b main", { cwd: dir, shell: "/bin/sh" });
  execSync("git config user.email t@t.com", { cwd: dir, shell: "/bin/sh" });
  execSync("git config user.name t", { cwd: dir, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd: dir, shell: "/bin/sh" });
  execSync(`mkdir -p ${dir}/src`, { shell: "/bin/sh" });
  execSync(`echo oops > ${dir}/src/dirty.ts`, { shell: "/bin/sh" });
  const tools = buildAgentTools(["transition"], makeCtx(dir));
  const result = await tools[0].execute("call-1", { to: "mission", body: "brief" } as never);
  expect(result.terminate).toBe(false);
  expect(
    result.content[0] && result.content[0].type === "text" && result.content[0].text.toLowerCase(),
  ).toContain("clean");
});
```

### Step 2: Run tests to verify they fail

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts src/agent/config/__tests__/transition-tool-wrapper.test.ts
```

Expected: FAIL (preflight still 1-arg; wrapper doesn't resolve change).

### Step 3: Implement

In `apps/server/src/lib/worktree.ts`, change `preflightWorktree` to accept the active change and check cleanliness:

```ts
export function preflightWorktree(cwd: string, activeChangeName: string | null): string | null {
  try {
    git(cwd, "rev-parse --is-inside-work-tree");
  } catch {
    return `"${cwd}" is not a git repository. Initialize git (git init) before this mission can be isolated in a worktree.`;
  }
  const base = detectDefaultBranch(cwd);
  if (!base) {
    return `Could not detect a default branch in "${cwd}". Ensure the repo has at least one commit on a branch.`;
  }
  // Clean-graduation guardrail: the working tree may be dirty ONLY under the
  // active change dir (which graduation absorbs). Anything else means the user
  // has uncommitted work that shouldn't be swept into a mission.
  let porcelain: string;
  try {
    porcelain = git(cwd, "status --porcelain");
  } catch {
    porcelain = "";
  }
  const allowedPrefix = activeChangeName ? `.sakti/changes/${activeChangeName}/` : null;
  for (const line of porcelain.split("\n")) {
    if (line.trim() === "") continue;
    // Format: "XY path" (path may be quoted). Strip the 2-char status + space.
    const filePath = line.slice(3).replace(/^"|"$/g, "");
    // Rename arrow: "a -> b" — check the destination.
    const segs = filePath.split(" -> ");
    const checkPath = segs[segs.length - 1] ?? filePath;
    const allowed =
      allowedPrefix !== null
        ? checkPath.startsWith(allowedPrefix) || checkPath.startsWith(".sakti/")
        : false;
    if (!allowed) {
      return `Working tree isn't clean (unexpected change: "${checkPath}"). Commit or stash your changes first, then call transition({ to: "mission" }) again.`;
    }
  }
  return null;
}
```

In `apps/server/src/agent/config/tool-registry.ts`, resolve the active change and pass it:

```ts
import { resolveActiveChangeName } from "./resolve-change-name.ts";
// ...
function wrapTransitionTool(ctx: ToolContext): AgentTool {
  const base = createTransitionTool();
  return {
    ...base,
    async execute(...callArgs: Parameters<AgentTool["execute"]>) {
      const args = callArgs[1] as { to?: unknown };
      if (args.to === "mission") {
        const activeChange = resolveActiveChangeName(ctx.cwd);
        const err = preflightWorktree(ctx.cwd, activeChange);
        if (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Cannot transition to mission: ${err}`,
              },
            ],
            details: undefined,
            terminate: false,
          };
        }
      }
      return base.execute(...(callArgs as Parameters<typeof base.execute>));
    },
  };
}
```

Update the existing `transition-tool-wrapper.test.ts` tests that call `preflightWorktree` indirectly to still pass (the "not a git repo" test still works; the "clean repo" test must have a clean tree, which `git init + commit` gives).

### Step 4: Run tests to verify they pass

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts src/agent/config/__tests__/transition-tool-wrapper.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/agent/config/tool-registry.ts apps/server/src/lib/__tests__/worktree.test.ts apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts
git commit -m "feat(server): transition guardrail — require a clean tree (except the change dir) to graduate"
```

---

## Task 7: Confirm route graduation sequence (absorb → clean → symlink)

Wire the new helpers into the plan→mission approve path, passing `projectId`. Re-verify the clean invariant at confirm time (the guardrail ran pre-gate; this catches changes between gate-render and approve).

**Files:**

- Modify: `apps/server/src/routes/sessions/confirm.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts` (teardown test uses `removeMissionWorktree` via `worktreePath`)

### Step 1: Write failing tests

In `apps/server/src/routes/sessions/__tests__/confirm.test.ts`, extend the existing "plan→mission approve creates a worktree and stamps worktreePath" test with absorb/clean/symlink assertions:

```ts
it("plan→mission approve absorbs change content, cleans main, symlinks node_modules", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-v2-"));
  execSync("git init -b main", { cwd, shell: "/bin/sh" });
  execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
  execSync("git config user.name t", { cwd, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
  // Main has an uncommitted change dir + node_modules.
  execSync(`mkdir -p ${cwd}/.sakti/changes/add-feature`, { shell: "/bin/sh" });
  execSync(`echo "# proposal" > ${cwd}/.sakti/changes/add-feature/proposal.md`, {
    shell: "/bin/sh",
  });
  execSync(`mkdir -p ${cwd}/node_modules`, { shell: "/bin/sh" });
  process.env.SAKTI_AGENT_DIR = join(cwd, "agent");

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
    const wt = after!.worktreePath!;
    // Change content absorbed + committed in the worktree.
    expect(existsSync(join(wt, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
    const committed = execSync(`git -C "${wt}" show --stat --oneline HEAD`, {
      shell: "/bin/sh",
    }).toString();
    expect(committed).toContain(".sakti/changes/add-feature/proposal.md");
    // Main cleaned — change dir gone from main.
    expect(existsSync(join(cwd, ".sakti/changes/add-feature"))).toBe(false);
    // Deps symlinked.
    expect(readlinkSync(join(wt, "node_modules"))).toBe(join(cwd, "node_modules"));
    // Branch survives with the change content.
    expect(
      execSync(`git -C "${cwd}" branch --list sakti/add-feature`, { shell: "/bin/sh" }).toString(),
    ).toContain("sakti/add-feature");
  } finally {
    delete process.env.SAKTI_AGENT_DIR;
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

Add `readlinkSync` to the test's `node:fs` import.

Also update the existing archive→done teardown test: it currently pre-creates the worktree via raw `git worktree add` at the OLD sibling path. Update it to create the worktree anywhere (the path is stored on the session and passed to teardown), e.g. `${cwd}-wt/fix`, and assert removal — the location no longer matters to teardown since it uses the stored path.

### Step 2: Run tests to verify they fail

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: FAIL (absorb/clean/symlink not wired; assertions on committed content / readlink fail).

### Step 3: Implement

In `apps/server/src/routes/sessions/confirm.ts`, update the imports and the plan→mission block. New imports:

```ts
import {
  absorbChangeContent,
  cleanMainChangeDir,
  createMissionWorktree,
  removeMissionWorktree,
  symlinkNodeModules,
} from "../../lib/worktree.ts";
```

Replace the plan→mission block (currently: resolve changeName → createMissionWorktree → stamp) with:

```ts
if (edge.from === "plan" && edge.to === "mission") {
  const project = ctx.repos.projects.findById(existing.projectId);
  if (project) {
    const changeName = resolveActiveChangeName(project.cwd);
    if (changeName) {
      const wtPath = createMissionWorktree(project.cwd, existing.projectId, changeName);
      absorbChangeContent(project.cwd, wtPath, changeName);
      cleanMainChangeDir(project.cwd, changeName);
      symlinkNodeModules(project.cwd, wtPath);
      await ctx.repos.sessions.update(id, { changeName, worktreePath: wtPath });
    } else {
      ctx.log?.server.warn?.(
        "plan→mission: no change name resolved; mission will run without a worktree",
        { sessionId: id, projectCwd: project.cwd },
      );
    }
  }
}
```

Update `buildWorktreeTeardown` to use the stored `worktreePath` (not changeName) for removal:

```ts
function buildWorktreeTeardown(
  ctx: ReturnType<typeof getCtx>,
  session: {
    id: string;
    projectId: string;
    changeName: string | null;
    worktreePath: string | null;
  },
): (sessionId: string) => Promise<void> {
  return async (sessionId) => {
    const project = ctx.repos.projects.findById(session.projectId);
    if (project && session.worktreePath) {
      removeMissionWorktree(project.cwd, session.worktreePath);
    }
    await ctx.repos.sessions.update(sessionId, { worktreePath: null });
  };
}
```

### Step 4: Run tests to verify they pass

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: PASS. (If the existing "plan→mission approve returns 500 when worktree creation fails" test now also needs the change dir + clean setup, adjust its setup so the clean guardrail isn't what triggers — it should fail at worktree creation because the cwd isn't a git repo. Add a `.sakti/changes/broken/.sakti.yaml` so changeName resolves, but no `git init`, so `detectDefaultBranch` throws inside `createMissionWorktree`.)

### Step 5: Commit

```bash
git add apps/server/src/routes/sessions/confirm.ts apps/server/src/routes/sessions/__tests__/confirm.test.ts
git commit -m "feat(server): graduation absorbs change content, cleans main, symlinks node_modules"
```

---

## Task 8: Desktop worktreePath carry-through (v1 bug fix)

`plan-chat.tsx` never passes `worktreePath` to `createSession`, so missions are born with `worktreePath: null` and run unisolated. Fix the call site (the signature already accepts it). This is a prerequisite for v2 — without it the mission ignores the worktree the server just built.

**Files:**

- Modify: `apps/desktop/src/components/onboarding/plan-chat.tsx`
- Modify: `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`

### Step 1: Write failing test

In `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`, assert `createSession` is called with the `worktreePath` that the confirm route stamped. (If the existing test mocks `confirmTransition` to return a `worktreePath` on the updated session, assert `actions.createSession` receives it as the 4th arg. Follow the existing mock pattern in that file for `changeName` and mirror it for `worktreePath`.)

```ts
it("carries worktreePath from the confirmed plan session to the new mission", async () => {
  // ... existing setup that renders PlanChat with a pending transition ...
  // Mock confirmTransition so the plan session's meta gets worktreePath set:
  server.actions.updateSession(sid, { worktreePath: "/wt/path", changeName: "add" });
  // ... approve the gate ...
  await /* flush */;
  expect(actions.createSession).toHaveBeenCalledWith(
    expect.any(String),
    expect.anything(),
    "add",
    "/wt/path",
  );
});
```

(Adapt to the file's actual harness — the key assertion is the 4th positional arg `worktreePath`.)

### Step 2: Run test to verify it fails

```bash
vp run desktop#test -- src/components/onboarding/__tests__/plan-chat.test.tsx
```

Expected: FAIL (createSession called without the 4th arg).

### Step 3: Implement

In `apps/desktop/src/components/onboarding/plan-chat.tsx`, `handleConfirmSession`, read `worktreePath` alongside `changeName` and pass it:

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

### Step 4: Run test to verify it passes

```bash
vp run desktop#test -- src/components/onboarding/__tests__/plan-chat.test.tsx
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/desktop/src/components/onboarding/plan-chat.tsx apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx
git commit -m "fix(desktop): carry worktreePath from plan→mission confirm to the new mission session"
```

---

## Task 9: Final verification

### Step 1: Full test suite

```bash
vp run -r test
```

Expected: all pass except the 3 pre-existing `packages/sakti` baseline failures and the environment-dependent `ws.test.ts`.

### Step 2: Check

```bash
vp check --fix
```

Expected: 0 errors.

### Step 3: Sanity greps

```bash
# Old sibling-dir scheme fully gone:
rg "worktrees" apps/server/src --glob '*.ts'
# Expect: none.

# All worktree ops pass projectId / stored path:
rg "createMissionWorktree|removeMissionWorktree" apps/server/src --glob '*.ts'
```

### Step 4: Manual smoke check (optional)

```bash
vp run desktop#dev
```

- Plan a change that creates `.sakti/changes/<name>/`.
- Approve plan→mission. Verify:
  - Worktree created under `~/.sakti/projects/<projectBasename>--<name>/`.
  - `node_modules` in the worktree is a symlink to the main repo's.
  - Main repo's `.sakti/changes/<name>/` is gone (`git status` clean on main).
  - The mission's first `read` of `.sakti/changes/<name>/proposal.md` succeeds (absorbed).
  - Running the project's test command in the mission works (deps symlinked).
- Dirty the main repo (e.g. edit a source file), then have the plan call `transition({to:"mission"})` → agent should report the tree isn't clean.

### Step 5: Final commit (if any check fixes)

```bash
git add -A && git commit -m "chore: worktree isolation v2 verification fixes"
```
