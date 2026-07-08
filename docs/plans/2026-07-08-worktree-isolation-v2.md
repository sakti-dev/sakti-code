# Worktree Isolation v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Relocate mission worktrees under `~/.sakti/projects/`, symlink configured dependency/cache dirs so missions can run the project's scripts across languages, and commit the SDD change content onto the mission branch (keeping the main repo clean) — gated by a "clean working tree" guardrail in the transition tool.

**Architecture:** Worktrees move from a sibling `<repo>-worktrees/<change>` dir to `~/.sakti/projects/<projectBasename>--<changeName>` (collision-safe). At plan→mission graduation the server creates the worktree, copies `.sakti/changes/<change>/` into it and commits it as the branch's first commit, symlinks configured dependency/cache dirs from main into the worktree, and removes the copy from main (main stays clean). The transition tool's pre-flight refuses graduation when the working tree is dirty outside `.sakti/changes/<activeChange>/`.

**Tech Stack:** TypeScript, node:sqlite + Drizzle, Hono, node:fs (`cpSync`/`symlinkSync`/`rmSync`), git via `execSync`, Vitest, `vp` toolchain.

**Design doc:** `docs/plans/2026-07-08-worktree-isolation-v2-design.md`

**Key commands:**

```bash
vp run '@sakti-code/server#test'            # server tests
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts   # one file
vp run 'desktop#test'                       # desktop tests
vp run -r test                              # all tests (3 pre-existing sakti baseline failures expected)
vp check                                    # format + lint + typecheck
```

**Conventions:** TDD. `exactOptionalPropertyTypes: true` (conditional spread, never assign `undefined`). Tests in `__tests__/`, vitest (`vite-plus/test`). No `.only`/`.skip`. Arrow callbacks, `for...of`, `const`, `as const`. Git ops via `execSync` with `shell: "/bin/sh"` (TS 7.0). No comments unless asked.

**Intermediate verification note:** Tasks 2–8 intentionally refactor shared worktree signatures before every production caller is updated. During those tasks, run only the task-specific targeted tests listed in each task. `vp check`, full server tests, and `confirm.test.ts` are expected to be red until Task 8 completes the confirm-route wiring. Task 10 is the first full-repo verification gate.

**Context for the implementer:**

- `apps/server/src/lib/config-dirs.ts` — `getAgentDir()` → `~/.sakti/agent` (env-overridable via `SAKTI_AGENT_DIR`). `dirname(getAgentDir())` = `~/.sakti/` (the data root; logs and `sessions.db` are siblings). Add the worktree base here.
- `apps/server/src/lib/worktree.ts` — current ops: `detectDefaultBranch`, `preflightWorktree(cwd)`, `worktreePathFor(projectCwd, changeName)` (sibling dir), `createMissionWorktree(projectCwd, changeName)`, `removeMissionWorktree(projectCwd, changeName)`. This plan reworks location, preflight, and adds absorb/clean/dependency-symlink helpers.
- `apps/server/src/lib/worktree-settings.ts` — new resolver for curated dependency symlink dirs plus global `settings.json` override.
- `apps/server/src/routes/sessions/confirm.ts` — plan→mission block (inside the approve `try`) currently: resolve changeName → `createMissionWorktree` → stamp `worktreePath`+`changeName`. This plan inserts absorb → dependency symlink → clean and passes `projectId`.
- `apps/server/src/lib/settings-file-store.ts` / `apps/server/src/routes/settings.ts` — global settings live in `~/.sakti/agent/settings.json` and are already read through `ctx.settingsFile.read()`. The override key is `worktree.dependencySymlinkDirs`.
- `apps/server/src/agent/config/tool-registry.ts` — `wrapTransitionTool` calls `preflightWorktree(ctx.cwd)` when `to === "mission"`. This plan resolves the active change and passes it so preflight can check the working tree is clean.
- `apps/server/src/agent/config/resolve-change-name.ts` — `resolveActiveChangeName(projectCwd)` → most-recently-modified change slug in `.sakti/changes/`, or null.
- `apps/desktop/src/components/onboarding/plan-chat.tsx` — `handleConfirmSession` reads `changeName` from the plan session post-confirm and calls `createSession(projectId, title, changeName)` but **never passes `worktreePath`** (v1 bug). The mission is born with `worktreePath: null` and runs unisolated. This plan fixes it (Task 9) — a prerequisite for v2 doing anything.
- `apps/desktop/src/stores/server/actions.ts` — desktop `createSession` currently accepts only `(projectId, title?, changeName?)` and posts only those fields. Task 9 adds the 4th `worktreePath?` parameter and sends it to the server.
- The DB column `sessions.worktreePath` already exists; the server `POST /api/sessions` already accepts `worktreePath`. The missing pieces are the desktop action signature/body and the plan-chat call site.
- `git status --porcelain` output format: two status chars then a space then `path` (paths are relative to the repo root, quoted if special). For tracking we only care whether each path starts with `.sakti/changes/<change>/`.

---

## Task 1: Worktree base dir resolver

**Files:**

- Modify: `apps/server/src/lib/config-dirs.ts`
- Modify: `apps/server/src/lib/__tests__/config-dirs.test.ts`

### Step 1: Write the failing test

Add to `apps/server/src/lib/__tests__/config-dirs.test.ts`:

```ts
import { dirname, join } from "node:path";
import { getWorktreeBaseDir } from "../config-dirs.ts";

it("getWorktreeBaseDir is a sibling of the agent dir (<parent>/projects)", () => {
  process.env.SAKTI_AGENT_DIR = "/tmp/sakti-test-agent";
  expect(getWorktreeBaseDir()).toBe(join(dirname("/tmp/sakti-test-agent"), "projects"));
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

## Task 2: New worktree location + create/remove signatures

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

Update the existing create/remove tests to the new signatures in the same file. For example, update the removal test to this shape:

```ts
it("removeMissionWorktree removes the dir but keeps the branch", () => {
  initGitRepo(projectDir);
  const wt = createMissionWorktree(projectDir, "proj-test001", "add-feature");
  removeMissionWorktree(projectDir, wt);
  expect(existsSync(wt)).toBe(false);
  const branch = execSync("git branch --list sakti/add-feature", {
    cwd: projectDir,
    shell: "/bin/sh",
  }).toString();
  expect(branch).toContain("sakti/add-feature");
});
```

Apply the same signature shape to every existing `createMissionWorktree` and `removeMissionWorktree` call in that describe block. For the reuse test, both creations must use the same projectId so the collision logic produces the same path.

Set `SAKTI_AGENT_DIR` to a temp dir in `beforeEach` so `getWorktreeBaseDir()` resolves to a writable temp spot, and clean it in `afterEach`:

```ts
beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "sakti-wt-"));
  process.env.SAKTI_AGENT_DIR = join(projectDir, "agent");
});

afterEach(() => {
  try {
    execSync("git worktree prune", { cwd: projectDir, shell: "/bin/sh", stdio: "ignore" });
  } catch {
    // ignore
  }
  rmSync(projectDir, { recursive: true, force: true });
  delete process.env.SAKTI_AGENT_DIR;
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL (current `worktreePathFor` takes 2 args, create/remove use the old signatures, and paths still use the sibling dir).

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

Replace `createMissionWorktree` and `removeMissionWorktree` so the file compiles and all worktree path tests can pass:

```ts
export function createMissionWorktree(
  projectCwd: string,
  projectId: string,
  changeName: string,
): string {
  const base = getWorktreeBaseDir();
  mkdirSync(base, { recursive: true });
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

export function removeMissionWorktree(projectCwd: string, wtPath: string): void {
  try {
    git(projectCwd, `worktree remove --force "${wtPath}"`);
  } catch {
    // Best-effort; the worktree may already be gone.
  }
}
```

Remove the old 2-arg `worktreePathFor`. Keep the `basename`/`join` imports; drop `dirname` if now unused.

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: PASS for all worktree location/create/remove tests.

### Step 5: Commit

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts
git commit -m "feat(server): worktree location under ~/.sakti/projects"
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

Add `createMissionWorktree` to the existing import list if it is not already present. The `initGitRepo` helper already exists in the file.

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL (`absorbChangeContent` not exported).

### Step 3: Implement

In `apps/server/src/lib/worktree.ts`, add:

```ts
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";

/**
 * Copy the main repo's uncommitted `.sakti/changes/<change>/` into the
 * worktree and commit it on the mission branch as the first commit. The
 * specify agent then reads proposal.md from the worktree and writes
 * design.md/tasks.md as further commits. Idempotent-ish: a no-op (no throw)
 * when main has no change dir or when the same content is already committed on
 * a reused mission branch.
 */
export function absorbChangeContent(projectCwd: string, wtPath: string, changeName: string): void {
  const src = join(projectCwd, ".sakti", "changes", changeName);
  if (!existsSync(src)) return;
  const dest = join(wtPath, ".sakti", "changes", changeName);
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  git(wtPath, "add .sakti/changes");
  const staged = git(wtPath, "diff --cached --name-only");
  if (staged === "") return;
  git(wtPath, `commit -m "sakti: begin change ${changeName}"`);
}
```

The `createMissionWorktree(projectCwd, projectId, changeName)` and `removeMissionWorktree(projectCwd, wtPath)` signatures were introduced in Task 2; keep using those signatures here.

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

## Task 4: Worktree dependency symlink settings resolver

Resolve the curated dependency/cache directory names from global settings. Workspace-specific overrides are out of scope.

**Files:**

- Create: `apps/server/src/lib/worktree-settings.ts`
- Create: `apps/server/src/lib/__tests__/worktree-settings.test.ts`

### Step 1: Write failing tests

Create `apps/server/src/lib/__tests__/worktree-settings.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_DEPENDENCY_SYMLINK_DIRS,
  resolveDependencySymlinkDirs,
} from "../worktree-settings.ts";

describe("resolveDependencySymlinkDirs", () => {
  it("uses curated defaults when settings are empty", () => {
    expect(resolveDependencySymlinkDirs({}).dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
  });

  it("uses global settings override when dependencySymlinkDirs is a non-empty string array", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: ["node_modules", ".venv", "target"] },
    });
    expect(resolved.dirs).toEqual(["node_modules", ".venv", "target"]);
    expect(resolved.warning).toBeUndefined();
  });

  it("deduplicates override entries and removes empty strings", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: ["node_modules", "", "node_modules", "target"] },
    });
    expect(resolved.dirs).toEqual(["node_modules", "target"]);
  });

  it("falls back to defaults and returns a warning for malformed override values", () => {
    const resolved = resolveDependencySymlinkDirs({
      worktree: { dependencySymlinkDirs: "node_modules" },
    });
    expect(resolved.dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
    expect(resolved.warning).toContain("worktree.dependencySymlinkDirs");
  });
});
```

### Step 2: Run test to verify it fails

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree-settings.test.ts
```

Expected: FAIL (module missing).

### Step 3: Implement

Create `apps/server/src/lib/worktree-settings.ts`:

```ts
export const DEFAULT_DEPENDENCY_SYMLINK_DIRS = [
  "node_modules",
  ".venv",
  "venv",
  "target",
  ".cargo",
  "vendor/bundle",
  ".bundle",
  ".gradle",
  ".m2",
  "vendor",
  "zig-cache",
  ".zig-cache",
] as const;

export interface DependencySymlinkDirsResult {
  dirs: string[];
  warning?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDirs(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "" || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function resolveDependencySymlinkDirs(
  settings: Record<string, unknown>,
): DependencySymlinkDirsResult {
  const fallback = [...DEFAULT_DEPENDENCY_SYMLINK_DIRS];
  const worktree = settings.worktree;
  if (!isRecord(worktree) || worktree.dependencySymlinkDirs === undefined) {
    return { dirs: fallback };
  }
  const raw = worktree.dependencySymlinkDirs;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    return {
      dirs: fallback,
      warning:
        "Ignoring malformed settings.worktree.dependencySymlinkDirs; expected a string array.",
    };
  }
  const dirs = normalizeDirs(raw);
  if (dirs.length === 0) {
    return { dirs: fallback };
  }
  return { dirs };
}
```

### Step 4: Run test to verify it passes

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree-settings.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/server/src/lib/worktree-settings.ts apps/server/src/lib/__tests__/worktree-settings.test.ts
git commit -m "feat(server): resolve worktree dependency symlink settings"
```

---

## Task 5: cleanMainChangeDir + linkDependencyDirs helpers

**Files:**

- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`

### Step 1: Write failing tests

Add to `apps/server/src/lib/__tests__/worktree.test.ts`:

```ts
import { cleanMainChangeDir, linkDependencyDirs } from "../worktree.ts";
import { lstatSync, readlinkSync } from "node:fs";

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

  it("throws instead of dirtying main when the change dir is tracked", () => {
    initGitRepo(projectDir);
    const dir = join(projectDir, ".sakti/changes/tracked");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "proposal.md"), "x");
    execSync("git add .sakti/changes/tracked/proposal.md", { cwd: projectDir, shell: "/bin/sh" });
    execSync("git commit -m tracked-change", { cwd: projectDir, shell: "/bin/sh" });
    expect(() => cleanMainChangeDir(projectDir, "tracked")).toThrow("tracked change dir");
    const status = execSync("git status --porcelain", {
      cwd: projectDir,
      shell: "/bin/sh",
    }).toString();
    expect(status).toBe("");
  });
});

describe("linkDependencyDirs", () => {
  it("symlinks each configured dependency dir that exists in main", () => {
    initGitRepo(projectDir);
    mkdirSync(join(projectDir, "node_modules"), { recursive: true });
    mkdirSync(join(projectDir, ".venv"), { recursive: true });
    const wt = createMissionWorktree(projectDir, "proj-cccccccc", "dep");
    linkDependencyDirs(projectDir, wt, ["node_modules", ".venv", "target"]);
    expect(readlinkSync(join(wt, "node_modules"))).toBe(join(projectDir, "node_modules"));
    expect(readlinkSync(join(wt, ".venv"))).toBe(join(projectDir, ".venv"));
    expect(existsSync(join(wt, "target"))).toBe(false);
  });

  it("is a no-op when main has none of the configured dependency dirs", () => {
    initGitRepo(projectDir);
    const wt = createMissionWorktree(projectDir, "proj-dddddddd", "nodep");
    expect(() => linkDependencyDirs(projectDir, wt, ["node_modules", ".venv"])).not.toThrow();
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
    expect(existsSync(join(wt, ".venv"))).toBe(false);
  });

  it("does not replace an existing worktree path", () => {
    initGitRepo(projectDir);
    mkdirSync(join(projectDir, "target"), { recursive: true });
    const wt = createMissionWorktree(projectDir, "proj-eeeeeeee", "existing");
    mkdirSync(join(wt, "target"), { recursive: true });
    linkDependencyDirs(projectDir, wt, ["target"]);
    expect(lstatSync(join(wt, "target")).isSymbolicLink()).toBe(false);
  });
});
```

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
 * No-op when absent. Refuses tracked change dirs because removing tracked files
 * would leave staged deletions on main; tracked change content must be handled
 * by the user before graduation so "main stays clean" remains true.
 */
export function cleanMainChangeDir(projectCwd: string, changeName: string): void {
  const dir = join(projectCwd, ".sakti", "changes", changeName);
  if (!existsSync(dir)) {
    return;
  }
  const rel = `.sakti/changes/${changeName}`;
  const tracked = git(projectCwd, `ls-files "${rel}"`);
  if (tracked !== "") {
    throw new Error(
      `Cannot clean tracked change dir "${rel}". Commit, revert, or move this change content before transitioning to mission.`,
    );
  }
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Symlink configured dependency/cache dirs into the worktree so the mission can
 * run project scripts without reinstalling. Absolute targets resolve regardless
 * of the worktree's location. Missing main dirs and existing worktree paths are
 * skipped.
 */
export function linkDependencyDirs(
  projectCwd: string,
  wtPath: string,
  dirs: readonly string[],
): string[] {
  const linked: string[] = [];
  for (const dir of dirs) {
    const target = join(projectCwd, dir);
    const link = join(wtPath, dir);
    if (!existsSync(target) || existsSync(link)) {
      continue;
    }
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, "dir");
    linked.push(dir);
  }
  return linked;
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
git commit -m "feat(server): clean main change dir and link dependency dirs"
```

---

## Task 6: Branch cleanup helpers

Confirm-time failure cleanup needs to know whether `sakti/<change>` existed before worktree creation, and to delete a newly-created branch when post-create work fails.

**Files:**

- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`

### Step 1: Write failing tests

Add cleanup-helper tests in `apps/server/src/lib/__tests__/worktree.test.ts`:

```ts
it("reports and deletes mission branches by change name", () => {
  initGitRepo(projectDir);
  expect(missionBranchExists(projectDir, "cleanup")).toBe(false);
  const wt = createMissionWorktree(projectDir, "proj-test001", "cleanup");
  expect(missionBranchExists(projectDir, "cleanup")).toBe(true);
  removeMissionWorktree(projectDir, wt);
  deleteMissionBranch(projectDir, "cleanup");
  expect(missionBranchExists(projectDir, "cleanup")).toBe(false);
});
```

### Step 2: Run tests to verify they fail

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL (`missionBranchExists` and `deleteMissionBranch` are not exported).

### Step 3: Implement

In `apps/server/src/lib/worktree.ts`, export branch helpers and update `createMissionWorktree` to use `missionBranchExists`:

```ts
export function missionBranchExists(projectCwd: string, changeName: string): boolean {
  return branchExists(projectCwd, `sakti/${changeName}`);
}

/**
 * Delete a mission branch created during a failed graduation. Never call this
 * for branches that existed before the current graduation attempt.
 */
export function deleteMissionBranch(projectCwd: string, changeName: string): void {
  try {
    git(projectCwd, `branch -D sakti/${changeName}`);
  } catch {
    // Best-effort; the branch may already be gone.
  }
}
```

In `createMissionWorktree`, replace `if (branchExists(projectCwd, branch))` with:

```ts
if (missionBranchExists(projectCwd, changeName)) {
  git(projectCwd, `worktree add "${wtPath}" ${branch}`);
} else {
  const detected = detectDefaultBranch(projectCwd);
  if (!detected) {
    throw new Error(`Cannot create worktree: no default branch detected in "${projectCwd}"`);
  }
  git(projectCwd, `worktree add -b ${branch} "${wtPath}" ${detected}`);
}
```

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

## Task 7: Transition-tool "clean working tree" guardrail

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

  it("passes when a tracked file under .sakti/changes/<change>/ is modified", () => {
    initGitRepo(projectDir);
    mkdirSync(join(projectDir, ".sakti/changes/add"), { recursive: true });
    writeFileSync(join(projectDir, ".sakti/changes/add/proposal.md"), "x");
    execSync("git add .sakti/changes/add/proposal.md", { cwd: projectDir, shell: "/bin/sh" });
    execSync("git commit -m add-change", { cwd: projectDir, shell: "/bin/sh" });
    writeFileSync(join(projectDir, ".sakti/changes/add/proposal.md"), "changed");
    expect(preflightWorktree(projectDir, "add")).toBeNull();
  });

  it("returns an error when an unrelated file is dirty", () => {
    initGitRepo(projectDir);
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src/dirty.ts"), "oops");
    const err = preflightWorktree(projectDir, "add");
    expect(err).not.toBeNull();
    expect(err).toContain("clean");
  });

  it("returns an error when another .sakti path is dirty", () => {
    initGitRepo(projectDir);
    mkdirSync(join(projectDir, ".sakti/changes/add"), { recursive: true });
    writeFileSync(join(projectDir, ".sakti/changes/add/proposal.md"), "x");
    mkdirSync(join(projectDir, ".sakti/changes/other"), { recursive: true });
    writeFileSync(join(projectDir, ".sakti/changes/other/proposal.md"), "y");
    const err = preflightWorktree(projectDir, "add");
    expect(err).not.toBeNull();
    expect(err).toContain("other");
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
function gitRaw(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, shell: "/bin/sh", encoding: "utf-8" });
}

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
    porcelain = gitRaw(cwd, "status --porcelain");
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
    const allowed = allowedPrefix !== null ? checkPath.startsWith(allowedPrefix) : false;
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

## Task 8: Confirm route graduation sequence (absorb → dependency symlink → clean)

Wire the new helpers into the plan→mission approve path, passing `projectId`. Re-verify the clean invariant at confirm time (the guardrail ran pre-gate; this catches changes between gate-render and approve). Keep main untouched until the final clean step: create worktree → absorb/commit branch content → resolve/link dependency dirs from settings → remove the untracked change dir from main → stamp the session.

**Files:**

- Modify: `apps/server/src/routes/sessions/confirm.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts` (teardown test uses `removeMissionWorktree` via `worktreePath`)

### Step 1: Write failing tests

In `apps/server/src/routes/sessions/__tests__/confirm.test.ts`, extend the existing "plan→mission approve creates a worktree and stamps worktreePath" test with absorb/clean/symlink assertions:

```ts
it("plan→mission approve absorbs change content, cleans main, symlinks dependency dirs", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-v2-"));
  execSync("git init -b main", { cwd, shell: "/bin/sh" });
  execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
  execSync("git config user.name t", { cwd, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
  // Main has an uncommitted change dir + dependency/cache dirs.
  execSync(`mkdir -p ${cwd}/.sakti/changes/add-feature`, { shell: "/bin/sh" });
  execSync(`echo "name: add-feature" > ${cwd}/.sakti/changes/add-feature/.sakti.yaml`, {
    shell: "/bin/sh",
  });
  execSync(`echo "# proposal" > ${cwd}/.sakti/changes/add-feature/proposal.md`, {
    shell: "/bin/sh",
  });
  execSync(`mkdir -p ${cwd}/node_modules`, { shell: "/bin/sh" });
  execSync(`mkdir -p ${cwd}/.venv`, { shell: "/bin/sh" });
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
    // Dependency/cache dirs symlinked from curated defaults.
    expect(readlinkSync(join(wt, "node_modules"))).toBe(join(cwd, "node_modules"));
    expect(readlinkSync(join(wt, ".venv"))).toBe(join(cwd, ".venv"));
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

Add one confirm-route test for the belt-and-suspenders clean check:

```ts
it("plan→mission approve returns 500 if main gets dirty before approval", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-dirty-"));
  execSync("git init -b main", { cwd, shell: "/bin/sh" });
  execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
  execSync("git config user.name t", { cwd, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
  execSync(`mkdir -p ${cwd}/.sakti/changes/add-feature ${cwd}/src`, { shell: "/bin/sh" });
  execSync(`echo "name: add-feature" > ${cwd}/.sakti/changes/add-feature/.sakti.yaml`, {
    shell: "/bin/sh",
  });
  execSync(`echo "# proposal" > ${cwd}/.sakti/changes/add-feature/proposal.md`, {
    shell: "/bin/sh",
  });
  execSync(`echo "dirty" > ${cwd}/src/dirty.ts`, { shell: "/bin/sh" });
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

    expect(res.status).toBe(500);
    const after = ctx.repos.sessions.findById(session.id);
    expect(after?.pendingTransitionTo).toBe("mission");
    expect(after?.worktreePath).toBeNull();
  } finally {
    delete process.env.SAKTI_AGENT_DIR;
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

Add one confirm-route test for the global settings override:

```ts
it("plan→mission approve uses global dependency symlink override from settings.json", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-deps-"));
  execSync("git init -b main", { cwd, shell: "/bin/sh" });
  execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
  execSync("git config user.name t", { cwd, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
  execSync(`mkdir -p ${cwd}/.sakti/changes/add-feature ${cwd}/custom-cache`, {
    shell: "/bin/sh",
  });
  execSync(`echo "name: add-feature" > ${cwd}/.sakti/changes/add-feature/.sakti.yaml`, {
    shell: "/bin/sh",
  });
  execSync(`echo "# proposal" > ${cwd}/.sakti/changes/add-feature/proposal.md`, {
    shell: "/bin/sh",
  });
  ctx.settingsFile.update({
    worktree: { dependencySymlinkDirs: ["custom-cache"] },
  });
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
    expect(readlinkSync(join(after!.worktreePath!, "custom-cache"))).toBe(
      join(cwd, "custom-cache"),
    );
  } finally {
    delete process.env.SAKTI_AGENT_DIR;
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

### Step 2: Run tests to verify they fail

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: FAIL (absorb/clean/dependency symlink not wired; assertions on committed content / readlink fail).

### Step 3: Implement

In `apps/server/src/routes/sessions/confirm.ts`, update the imports and the plan→mission block. New imports:

```ts
import {
  absorbChangeContent,
  cleanMainChangeDir,
  createMissionWorktree,
  deleteMissionBranch,
  linkDependencyDirs,
  missionBranchExists,
  preflightWorktree,
  removeMissionWorktree,
} from "../../lib/worktree.ts";
import { resolveDependencySymlinkDirs } from "../../lib/worktree-settings.ts";
```

Replace the plan→mission block (currently: resolve changeName → createMissionWorktree → stamp) with:

```ts
if (edge.from === "plan" && edge.to === "mission") {
  const project = ctx.repos.projects.findById(existing.projectId);
  if (project) {
    const changeName = resolveActiveChangeName(project.cwd);
    if (changeName) {
      const guardErr = preflightWorktree(project.cwd, changeName);
      if (guardErr) {
        throw new Error(guardErr);
      }
      const branchPreexisted = missionBranchExists(project.cwd, changeName);
      let wtPath: string | null = null;
      try {
        wtPath = createMissionWorktree(project.cwd, existing.projectId, changeName);
        absorbChangeContent(project.cwd, wtPath, changeName);
        const depDirs = resolveDependencySymlinkDirs(ctx.settingsFile.read());
        if (depDirs.warning) {
          ctx.log?.server.warn?.(depDirs.warning, { sessionId: id, projectCwd: project.cwd });
        }
        linkDependencyDirs(project.cwd, wtPath, depDirs.dirs);
        cleanMainChangeDir(project.cwd, changeName);
        await ctx.repos.sessions.update(id, { changeName, worktreePath: wtPath });
      } catch (err) {
        if (wtPath) {
          removeMissionWorktree(project.cwd, wtPath);
        }
        if (!branchPreexisted) {
          deleteMissionBranch(project.cwd, changeName);
        }
        throw err;
      }
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

Expected: PASS.

Before this step passes, update the existing "plan→mission approve returns 500 when worktree creation fails" test so it still fails at worktree creation rather than the clean guardrail. Its setup should include `.sakti/changes/broken/.sakti.yaml` and `proposal.md`, but must not run `git init`; `detectDefaultBranch` should be the failing operation.

### Step 5: Commit

```bash
git add apps/server/src/routes/sessions/confirm.ts apps/server/src/routes/sessions/__tests__/confirm.test.ts
git commit -m "feat(server): graduation links dependency dirs"
```

---

## Task 9: Desktop worktreePath carry-through (v1 bug fix)

`plan-chat.tsx` never passes `worktreePath` to `createSession`, and the desktop server action currently does not accept or post `worktreePath`. Missions are born with `worktreePath: null` and run unisolated. Fix both the action boundary and the call site. This is a prerequisite for v2 — without it the mission ignores the worktree the server just built.

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts`
- Modify: `apps/desktop/src/components/onboarding/plan-chat.tsx`
- Modify: `apps/desktop/src/stores/server/__tests__/actions.test.ts`
- Modify: `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`

### Step 1: Write failing tests

In `apps/desktop/src/stores/server/__tests__/actions.test.ts`, add or extend a `createSession` test to assert the POST body includes `worktreePath` when provided:

```ts
it("createSession posts worktreePath when provided", async () => {
  const deps = makeDeps();
  const mockApi = {
    api: {
      sessions: {
        $post: vi.fn(() =>
          okRes({
            id: "mission-1",
            projectId: "p1",
            title: "Mission",
            modelId: null,
            profileId: null,
            thinkingLevel: "off",
            kind: "mission",
            pendingTransitionBody: null,
            parentSessionId: null,
            changeName: "add-feature",
            worktreePath: "/tmp/sakti/projects/app--add-feature",
            pendingTransitionTo: null,
            status: "specify",
            createdAt: 1,
            updatedAt: 1,
          }),
        ),
      },
    },
  };
  const actions = createActions(mockApi as never, makeMockWs(), deps);

  await actions.createSession(
    "p1",
    "Mission",
    "add-feature",
    "/tmp/sakti/projects/app--add-feature",
  );

  expect(mockApi.api.sessions.$post).toHaveBeenCalledWith({
    json: {
      projectId: "p1",
      title: "Mission",
      changeName: "add-feature",
      worktreePath: "/tmp/sakti/projects/app--add-feature",
    },
  });
});
```

In `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`, update the testing-library import:

```ts
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
```

Update the hoisted mocks so tests can render a pending transition:

```ts
pendingTransition: null as null | { to: string; body: string },
sessionMeta: {} as Record<
  string,
  { profileId: string | null; changeName: string | null; worktreePath: string | null }
>,
```

Update the `useStore` mock to read those values:

```ts
sessions: {
  get: () => ({
    store: {
      streaming: { phase: "idle" },
      turns: [],
      pendingTransition: mocks.pendingTransition,
    },
    actions: { clearPendingTransition: mocks.clearPendingTransition },
  }),
},
server: {
  store: {
    sessions: mocks.sessionMeta,
  },
},
```

Reset them in `beforeEach`:

```ts
mocks.pendingTransition = null;
mocks.sessionMeta = {};
```

Add the failing test:

```ts
it("carries worktreePath from the confirmed plan session to the new mission", async () => {
  mocks.pendingTransition = { to: "mission", body: "Build the thing\n\nDetails" };
  mocks.sessionMeta.s1 = {
    profileId: null,
    changeName: "add-feature",
    worktreePath: "/tmp/sakti/projects/app--add-feature",
  };

  render(() => <PlanChat projectId="p1" sessionId="s1" />);

  const create = await screen.findByRole("button", { name: "Create" });
  fireEvent.click(create);

  await waitFor(() => {
    expect(mocks.confirmTransition).toHaveBeenCalledWith(
      "s1",
      "mission",
      "Build the thing\n\nDetails",
      "approve",
    );
    expect(mocks.createSession).toHaveBeenCalledWith(
      "p1",
      "Build the thing",
      "add-feature",
      "/tmp/sakti/projects/app--add-feature",
    );
  });
});
```

### Step 2: Run test to verify it fails

```bash
vp run 'desktop#test' -- src/components/onboarding/__tests__/plan-chat.test.tsx
```

Expected: FAIL (`createSession` does not accept/post the 4th arg, and `PlanChat` calls it without the 4th arg).

### Step 3: Implement

In `apps/desktop/src/stores/server/actions.ts`, update the `Actions` interface:

```ts
createSession: (projectId: string, title?: string, changeName?: string, worktreePath?: string) =>
  Promise<SessionMeta | undefined>;
```

Update the implementation:

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
    if (!res.ok) {
      return;
    }
    const session = (await res.json()) as SessionMeta;
    server.actions.addSession(session);
    return session;
  } catch (error) {
    setLastError(error instanceof Error ? error.message : "Failed to create session");
  }
}
```

In `apps/desktop/src/components/onboarding/plan-chat.tsx`, `handleConfirmSession`, read `worktreePath` alongside `changeName` and pass it:

```ts
const changeName = server.store.sessions[sid]?.changeName ?? undefined;
const worktreePath = server.store.sessions[sid]?.worktreePath ?? undefined;
const missionSession = await actions.createSession(
  props.projectId,
  title,
  changeName,
  worktreePath,
);
```

### Step 4: Run test to verify it passes

```bash
vp run 'desktop#test' -- src/stores/server/__tests__/actions.test.ts src/components/onboarding/__tests__/plan-chat.test.tsx
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/desktop/src/stores/server/actions.ts apps/desktop/src/stores/server/__tests__/actions.test.ts apps/desktop/src/components/onboarding/plan-chat.tsx apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx
git commit -m "fix(desktop): carry worktreePath from plan→mission confirm to the new mission session"
```

---

## Task 10: Final verification

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
vp run 'desktop#dev'
```

- Plan a change that creates `.sakti/changes/<name>/`.
- Approve plan→mission. Verify:
  - Worktree created under `~/.sakti/projects/<projectBasename>--<name>/`.
  - Existing dependency dirs from the curated/default settings list are symlinks to the main repo's, e.g. `node_modules`, `.venv`, or `target`.
  - Main repo's `.sakti/changes/<name>/` is gone (`git status` clean on main).
  - The mission's first `read` of `.sakti/changes/<name>/proposal.md` succeeds (absorbed).
  - Running the project's test command in the mission works (deps symlinked).
- Dirty the main repo (e.g. edit a source file), then have the plan call `transition({to:"mission"})` → agent should report the tree isn't clean.

### Step 5: Final commit (if any check fixes)

```bash
git add -A && git commit -m "chore: worktree isolation v2 verification fixes"
```
