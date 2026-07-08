# Worktree Isolation v2.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Worktree Isolation v2 correctness gaps and add explicit opt-in stashing for unrelated dirty work before plan->mission graduation.

**Architecture:** Keep v2's core model: mission worktrees live in `~/.sakti/projects`, the mission branch owns SDD change content, and main is never committed/reverted by Sakti. v2.1 tightens the transition boundary by fixing desktop confirm handoff, making dependency symlink settings safe, allowing tracked change dirs without manual cleanup, rolling back pre-existing branches on failed graduation, and offering `preserveUnrelated: "stash"` as an explicit transition-tool opt-in for unrelated dirty paths.

**Tech Stack:** TypeScript, Hono, SolidJS, Drizzle/node:sqlite, git via `execSync` with `shell: "/bin/sh"`, Vitest via Vite+, `vp` toolchain.

**Base docs:** `docs/plans/2026-07-08-worktree-isolation-v2-design.md`, `docs/plans/2026-07-08-worktree-isolation-v2.md`

## Global Constraints

- TDD for every behavior change: write the failing test first, run it red, implement, run it green.
- Never silently stash, commit, revert, or delete unrelated user work.
- Stash unrelated dirty paths only when the agent explicitly calls `transition({ to: "mission", body, preserveUnrelated: "stash" })`.
- Do not pop stashes automatically; the user controls when unrelated work returns.
- Never commit to `main` during plan->mission graduation.
- Never auto-revert or delete tracked files under `.sakti/changes/<change>` in main.
- Clean only untracked absorbed change dirs from main after the mission branch has the content.
- `settings.json` override entries for `worktree.dependencySymlinkDirs` must be safe relative paths that stay inside the worktree.
- Use conditional spreads for optional fields because `exactOptionalPropertyTypes: true`.
- Use `shell: "/bin/sh"` on `execSync` calls.
- SolidJS renderer code uses `class` and `for`, not React conventions.
- Commands in zsh must quote Vite+ package targets, for example `vp run '@sakti-code/server#test'`.

## Files And Responsibilities

- `apps/desktop/src/stores/server/actions.ts` - desktop RPC actions; must mirror `worktreePath` from confirm responses and surface confirm failures without mutating local state.
- `apps/desktop/src/stores/server/__tests__/actions.test.ts` - tests for confirm response mirroring and failure handling.
- `apps/desktop/src/components/onboarding/plan-chat.tsx` - plan gate approval UI; must stop if server confirm fails before creating a mission.
- `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx` - tests for mission creation carry-through and failed-confirm no-op.
- `apps/server/src/lib/worktree-settings.ts` - curated dependency symlink resolver and global override validation.
- `apps/server/src/lib/__tests__/worktree-settings.test.ts` - settings resolver tests, including unsafe override rejection.
- `apps/server/src/lib/worktree.ts` - git/worktree primitives: preflight analysis, safe path quoting, stash helper, tracked-dir cleanup semantics, branch rollback helpers.
- `apps/server/src/lib/__tests__/worktree.test.ts` - unit tests for worktree primitives.
- `apps/server/src/agent/config/tool-registry.ts` - transition tool wrapper; detects unrelated dirty paths and either returns actionable guidance or stashes explicitly.
- `apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts` - wrapper tests for dirty-tree guidance and explicit stash.
- `packages/tools/src/transition/index.ts` - pure transition tool schema; accepts optional `preserveUnrelated: "stash"`.
- `packages/tools/src/transition/__tests__/transition.test.ts` - schema/behavior coverage for the new optional argument.
- `apps/server/src/routes/sessions/confirm.ts` - plan->mission graduation sequence and rollback on failure.
- `apps/server/src/routes/sessions/__tests__/confirm.test.ts` - integration tests for tracked change dirs and rollback.

---

## Task 1: Desktop Confirm Handoff Fixes

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts`
- Modify: `apps/desktop/src/stores/server/__tests__/actions.test.ts`
- Modify: `apps/desktop/src/components/onboarding/plan-chat.tsx`
- Modify: `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`

**Interfaces:**

- Consumes: `confirmTransition(sessionId, to, body, action): Promise<{ ok: boolean; instruction: string | null }>`
- Produces: confirmed plan session metadata in `server.store.sessions[sid]` includes `changeName` and `worktreePath` before `PlanChat` calls `createSession(projectId, title, changeName, worktreePath)`.

- [ ] **Step 1: Add failing actions test for `worktreePath` mirroring**

In `apps/desktop/src/stores/server/__tests__/actions.test.ts`, update the existing `"mirrors changeName from the confirm response"` test to include `worktreePath`:

```ts
it("mirrors changeName and worktreePath from the confirm response", async () => {
  const deps = makeDeps();
  deps.serverStore.actions.addSession({
    id: "s1",
    projectId: "p1",
    title: null,
    modelId: null,
    profileId: null,
    thinkingLevel: "off",
    kind: "plan",
    pendingTransitionBody: "brief",
    parentSessionId: null,
    changeName: null,
    worktreePath: null,
    pendingTransitionTo: "mission",
    status: "specify",
    createdAt: 1,
    updatedAt: 1,
  });
  const mockApi = {
    api: {
      sessions: {
        ":id": {
          confirm: {
            $post: vi.fn(() =>
              okRes({
                id: "s1",
                projectId: "p1",
                title: null,
                modelId: null,
                profileId: null,
                thinkingLevel: "off",
                kind: "plan",
                pendingTransitionBody: null,
                parentSessionId: null,
                changeName: "add-feature-x",
                worktreePath: "/tmp/sakti/projects/app--add-feature-x",
                pendingTransitionTo: null,
                status: "specify",
                createdAt: 1,
                updatedAt: 2,
              }),
            ),
          },
        },
      },
    },
  };
  const actions = createActions(mockApi as never, makeMockWs(), deps);

  await actions.confirmTransition("s1", "mission", "brief", "approve");

  expect(deps.serverStore.store.sessions.s1?.changeName).toBe("add-feature-x");
  expect(deps.serverStore.store.sessions.s1?.worktreePath).toBe(
    "/tmp/sakti/projects/app--add-feature-x",
  );
});
```

- [ ] **Step 2: Run actions test to verify it fails**

Run:

```bash
vp run 'desktop#test' -- src/stores/server/__tests__/actions.test.ts
```

Expected: FAIL because `confirmTransition` does not mirror `updated.worktreePath`.

- [ ] **Step 3: Implement `worktreePath` mirroring**

In `apps/desktop/src/stores/server/actions.ts`, change the `server.actions.updateSession` payload inside `confirmTransition` to:

```ts
server.actions.updateSession(sessionId, {
  status: updated.status,
  ...(updated.changeName !== undefined ? { changeName: updated.changeName } : {}),
  ...(updated.worktreePath !== undefined ? { worktreePath: updated.worktreePath } : {}),
  pendingTransitionTo: null,
  pendingTransitionBody: null,
});
```

- [ ] **Step 4: Run actions test to verify it passes**

Run:

```bash
vp run 'desktop#test' -- src/stores/server/__tests__/actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add failing PlanChat test for confirm failure**

In `apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx`, add:

```tsx
it("does not create a mission when confirmTransition fails", async () => {
  mocks.pendingTransition = { to: "mission", body: "Build the thing" };
  mocks.confirmTransition.mockResolvedValueOnce({ ok: false, instruction: null });
  render(() => <PlanChat projectId="p1" sessionId="s1" />);

  fireEvent.click(screen.getByRole("button", { name: /create mission/i }));

  await waitFor(() => {
    expect(mocks.confirmTransition).toHaveBeenCalledWith(
      "s1",
      "mission",
      "Build the thing",
      "approve",
    );
  });
  expect(mocks.createSession).not.toHaveBeenCalled();
  expect(mocks.clearPendingTransition).not.toHaveBeenCalled();
  expect(mocks.openSessionTab).not.toHaveBeenCalled();
  expect(mocks.sendPrompt).not.toHaveBeenCalled();
});
```

If the button text differs, use the exact text from the rendered `TransitionCard` in this test file.

- [ ] **Step 6: Run PlanChat test to verify it fails**

Run:

```bash
vp run 'desktop#test' -- src/components/onboarding/__tests__/plan-chat.test.tsx
```

Expected: FAIL because `handleConfirmSession` ignores `{ ok: false }` and still creates a mission.

- [ ] **Step 7: Implement confirm failure stop**

In `apps/desktop/src/components/onboarding/plan-chat.tsx`, replace:

```ts
await actions.confirmTransition(sid, ask.to, ask.body, "approve");
```

with:

```ts
const result = await actions.confirmTransition(sid, ask.to, ask.body, "approve");
if (!result.ok) {
  return;
}
```

- [ ] **Step 8: Run desktop tests for this task**

Run:

```bash
vp run 'desktop#test' -- src/stores/server/__tests__/actions.test.ts src/components/onboarding/__tests__/plan-chat.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add apps/desktop/src/stores/server/actions.ts apps/desktop/src/stores/server/__tests__/actions.test.ts apps/desktop/src/components/onboarding/plan-chat.tsx apps/desktop/src/components/onboarding/__tests__/plan-chat.test.tsx
git commit -m "fix(desktop): preserve worktree handoff on plan confirm"
```

---

## Task 2: Safe Dependency Symlink Settings

**Files:**

- Modify: `apps/server/src/lib/worktree-settings.ts`
- Modify: `apps/server/src/lib/__tests__/worktree-settings.test.ts`

**Interfaces:**

- Produces: `resolveDependencySymlinkDirs(settings): { dirs: string[]; warning?: string }`
- Contract: a non-empty string array override replaces defaults only if every normalized entry is a safe relative path inside the worktree.

- [ ] **Step 1: Add failing tests for unsafe and nested safe paths**

Add to `apps/server/src/lib/__tests__/worktree-settings.test.ts`:

```ts
it("allows nested safe relative dependency dirs", () => {
  const resolved = resolveDependencySymlinkDirs({
    worktree: { dependencySymlinkDirs: ["vendor/bundle", "tools/cache"] },
  });

  expect(resolved.dirs).toEqual(["vendor/bundle", "tools/cache"]);
  expect(resolved.warning).toBeUndefined();
});

it("falls back to defaults when override contains path traversal", () => {
  const resolved = resolveDependencySymlinkDirs({
    worktree: { dependencySymlinkDirs: ["node_modules", "../outside"] },
  });

  expect(resolved.dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
  expect(resolved.warning).toContain("unsafe");
});

it("falls back to defaults when override contains an absolute path", () => {
  const resolved = resolveDependencySymlinkDirs({
    worktree: { dependencySymlinkDirs: ["/tmp/cache"] },
  });

  expect(resolved.dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
  expect(resolved.warning).toContain("unsafe");
});

it("falls back to defaults when override normalizes outside the worktree", () => {
  const resolved = resolveDependencySymlinkDirs({
    worktree: { dependencySymlinkDirs: ["nested/../../outside"] },
  });

  expect(resolved.dirs).toEqual(DEFAULT_DEPENDENCY_SYMLINK_DIRS);
  expect(resolved.warning).toContain("unsafe");
});
```

- [ ] **Step 2: Run settings test to verify it fails**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree-settings.test.ts
```

Expected: FAIL because unsafe override entries are currently accepted after trim/dedupe.

- [ ] **Step 3: Implement safe relative validation**

In `apps/server/src/lib/worktree-settings.ts`, import path helpers:

```ts
import { isAbsolute, normalize } from "node:path";
```

Replace `normalizeDirs` with:

```ts
function normalizeDirs(values: readonly string[]): string[] | null {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "") {
      continue;
    }
    const normalized = normalize(trimmed).replaceAll("\\", "/");
    const parts = normalized.split("/");
    const unsafe =
      isAbsolute(trimmed) ||
      normalized === "." ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      parts.some((part) => part === "" || part === "..");
    if (unsafe) {
      return null;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
```

Then update the resolver block:

```ts
const dirs = normalizeDirs(raw);
if (dirs === null) {
  return {
    dirs: fallback,
    warning:
      "Ignoring unsafe settings.worktree.dependencySymlinkDirs; entries must be relative paths inside the worktree.",
  };
}
if (dirs.length === 0) {
  return { dirs: fallback };
}
return { dirs };
```

- [ ] **Step 4: Run settings test to verify it passes**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree-settings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/server/src/lib/worktree-settings.ts apps/server/src/lib/__tests__/worktree-settings.test.ts
git commit -m "fix(server): validate worktree dependency symlink settings"
```

---

## Task 3: Tracked Change Dir Cleanup Semantics

**Files:**

- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`

**Interfaces:**

- Produces:
  - `export type CleanMainChangeDirResult = "absent" | "removed-untracked" | "skipped-tracked";`
  - `cleanMainChangeDir(projectCwd: string, changeName: string): CleanMainChangeDirResult`
- Contract: remove only untracked change dirs; skip tracked change dirs without throwing.

- [ ] **Step 1: Add failing unit tests for cleanup return values**

In `apps/server/src/lib/__tests__/worktree.test.ts`, add tests near the existing `cleanMainChangeDir` coverage:

```ts
it("cleanMainChangeDir removes an untracked change dir", () => {
  initGitRepo(projectDir);
  mkdirSync(join(projectDir, ".sakti/changes/add-feature"), { recursive: true });
  writeFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "# proposal\n");

  const result = cleanMainChangeDir(projectDir, "add-feature");

  expect(result).toBe("removed-untracked");
  expect(existsSync(join(projectDir, ".sakti/changes/add-feature"))).toBe(false);
});

it("cleanMainChangeDir skips a tracked clean change dir", () => {
  initGitRepo(projectDir);
  mkdirSync(join(projectDir, ".sakti/changes/add-feature"), { recursive: true });
  writeFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "# proposal\n");
  execSync("git add .sakti/changes/add-feature && git commit -m change", {
    cwd: projectDir,
    shell: "/bin/sh",
  });

  const result = cleanMainChangeDir(projectDir, "add-feature");

  expect(result).toBe("skipped-tracked");
  expect(existsSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
  expect(
    execSync("git status --porcelain --untracked-files=all", {
      cwd: projectDir,
      shell: "/bin/sh",
    }).toString(),
  ).toBe("");
});

it("cleanMainChangeDir skips a tracked modified change dir without reverting it", () => {
  initGitRepo(projectDir);
  mkdirSync(join(projectDir, ".sakti/changes/add-feature"), { recursive: true });
  writeFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "v1\n");
  execSync("git add .sakti/changes/add-feature && git commit -m change", {
    cwd: projectDir,
    shell: "/bin/sh",
  });
  writeFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "v2\n");

  const result = cleanMainChangeDir(projectDir, "add-feature");

  expect(result).toBe("skipped-tracked");
  expect(readFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "utf-8")).toBe(
    "v2\n",
  );
});
```

Add `readFileSync` to the existing `node:fs` import if needed.

- [ ] **Step 2: Run worktree test to verify it fails**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL because tracked change dirs currently throw.

- [ ] **Step 3: Implement cleanup semantics**

In `apps/server/src/lib/worktree.ts`, add the exported type near the helper exports:

```ts
export type CleanMainChangeDirResult = "absent" | "removed-untracked" | "skipped-tracked";
```

Replace `cleanMainChangeDir` with:

```ts
export function cleanMainChangeDir(
  projectCwd: string,
  changeName: string,
): CleanMainChangeDirResult {
  const dir = join(projectCwd, ".sakti", "changes", changeName);
  if (!existsSync(dir)) {
    return "absent";
  }
  const rel = `.sakti/changes/${changeName}`;
  const tracked = git(projectCwd, `ls-files ${shellQuote(rel)}`);
  if (tracked !== "") {
    return "skipped-tracked";
  }
  rmSync(dir, { recursive: true, force: true });
  return "removed-untracked";
}
```

If `shellQuote` does not exist yet, add this helper in `worktree.ts`:

```ts
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
```

- [ ] **Step 4: Run worktree test to verify it passes**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add confirm integration test for tracked clean change dir**

In `apps/server/src/routes/sessions/__tests__/confirm.test.ts`, add:

```ts
it("plan->mission approve allows tracked clean change dirs and leaves main clean", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-tracked-"));
  execSync("git init -b main", { cwd, shell: "/bin/sh" });
  execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
  execSync("git config user.name t", { cwd, shell: "/bin/sh" });
  execSync("mkdir -p .sakti/changes/add-feature", { cwd, shell: "/bin/sh" });
  execSync("printf 'name: add-feature\n' > .sakti/changes/add-feature/.sakti.yaml", {
    cwd,
    shell: "/bin/sh",
  });
  execSync("printf '# proposal\n' > .sakti/changes/add-feature/proposal.md", {
    cwd,
    shell: "/bin/sh",
  });
  execSync("git add . && git commit -m init", { cwd, shell: "/bin/sh" });
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
    expect(after?.worktreePath).not.toBeNull();
    expect(existsSync(join(cwd, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
    expect(
      execSync("git status --porcelain --untracked-files=all", {
        cwd,
        shell: "/bin/sh",
      }).toString(),
    ).toBe("");
  } finally {
    delete process.env.SAKTI_AGENT_DIR;
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run confirm test**

Run:

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: PASS after Step 3.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts apps/server/src/routes/sessions/__tests__/confirm.test.ts
git commit -m "fix(server): skip tracked change dirs during main cleanup"
```

---

## Task 4: Branch Rollback For Failed Graduation

**Files:**

- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`
- Modify: `apps/server/src/routes/sessions/confirm.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`

**Interfaces:**

- Produces:
  - `missionBranchHead(projectCwd: string, changeName: string): string | null`
  - `resetMissionBranch(projectCwd: string, changeName: string, head: string): void`
- Contract: confirm rollback restores a pre-existing `sakti/<change>` branch to its original HEAD if any post-create/post-absorb step fails.

- [ ] **Step 1: Add failing unit tests for branch head/reset helpers**

In `apps/server/src/lib/__tests__/worktree.test.ts`, add:

```ts
it("missionBranchHead returns null when the mission branch is absent", () => {
  initGitRepo(projectDir);
  expect(missionBranchHead(projectDir, "add-feature")).toBeNull();
});

it("resetMissionBranch restores a pre-existing mission branch head", () => {
  initGitRepo(projectDir);
  execSync("git checkout -b sakti/add-feature", { cwd: projectDir, shell: "/bin/sh" });
  writeFileSync(join(projectDir, "branch.txt"), "one\n");
  execSync("git add branch.txt && git commit -m one", { cwd: projectDir, shell: "/bin/sh" });
  const original = missionBranchHead(projectDir, "add-feature");
  expect(original).not.toBeNull();
  writeFileSync(join(projectDir, "branch.txt"), "two\n");
  execSync("git add branch.txt && git commit -m two", { cwd: projectDir, shell: "/bin/sh" });
  execSync("git checkout main", { cwd: projectDir, shell: "/bin/sh" });

  resetMissionBranch(projectDir, "add-feature", original!);

  expect(missionBranchHead(projectDir, "add-feature")).toBe(original);
});
```

Add imports for `missionBranchHead` and `resetMissionBranch`.

- [ ] **Step 2: Run worktree test to verify it fails**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement branch helpers**

In `apps/server/src/lib/worktree.ts`, add:

```ts
export function missionBranchHead(projectCwd: string, changeName: string): string | null {
  try {
    return git(projectCwd, `rev-parse refs/heads/sakti/${changeName}`);
  } catch {
    return null;
  }
}

export function resetMissionBranch(projectCwd: string, changeName: string, head: string): void {
  git(projectCwd, `branch -f sakti/${changeName} ${shellQuote(head)}`);
}
```

- [ ] **Step 4: Run worktree test to verify it passes**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire rollback into confirm route**

In `apps/server/src/routes/sessions/confirm.ts`, replace the `branchPreexisted` tracking with a captured head:

```ts
const branchHeadBefore = missionBranchHead(project.cwd, changeName);
let wtPath: string | null = null;
try {
  wtPath = createMissionWorktree(project.cwd, existing.projectId, changeName);
  absorbChangeContent(project.cwd, wtPath, changeName);
  const depDirs = resolveDependencySymlinkDirs(ctx.settingsFile.read());
  if (depDirs.warning) {
    ctx.log?.server.warn?.(depDirs.warning, {
      sessionId: id,
      projectCwd: project.cwd,
    });
  }
  linkDependencyDirs(project.cwd, wtPath, depDirs.dirs);
  cleanMainChangeDir(project.cwd, changeName);
  await ctx.repos.sessions.update(id, { changeName, worktreePath: wtPath });
} catch (err) {
  if (wtPath) {
    removeMissionWorktree(project.cwd, wtPath);
  }
  if (branchHeadBefore) {
    resetMissionBranch(project.cwd, changeName, branchHeadBefore);
  } else {
    deleteMissionBranch(project.cwd, changeName);
  }
  throw err;
}
```

Update the import list to use `missionBranchHead` and `resetMissionBranch`, and remove `missionBranchExists` if it is no longer used in `confirm.ts`.

- [ ] **Step 6: Add confirm integration test for pre-existing branch rollback**

In `apps/server/src/routes/sessions/__tests__/confirm.test.ts`, add a test that fails after worktree creation by configuring a dependency link whose parent path is a tracked file in the worktree:

```ts
it("rolls back a pre-existing mission branch when graduation fails after absorb", async () => {
  const { app, ctx } = await makeApp([confirmRoutes]);
  const cwd = mkdtempSync(join(tmpdir(), "sakti-confirm-rollback-"));
  execSync("git init -b main", { cwd, shell: "/bin/sh" });
  execSync("git config user.email t@t.com", { cwd, shell: "/bin/sh" });
  execSync("git config user.name t", { cwd, shell: "/bin/sh" });
  execSync("git commit --allow-empty -m init", { cwd, shell: "/bin/sh" });
  execSync("git checkout -b sakti/add-feature", { cwd, shell: "/bin/sh" });
  execSync("printf 'tracked-file\n' > cache-parent", { cwd, shell: "/bin/sh" });
  execSync("printf 'branch-original\n' > branch.txt", { cwd, shell: "/bin/sh" });
  execSync("git add cache-parent branch.txt && git commit -m branch-original", {
    cwd,
    shell: "/bin/sh",
  });
  const originalHead = execSync("git rev-parse HEAD", { cwd, shell: "/bin/sh" }).toString().trim();
  execSync("git checkout main", { cwd, shell: "/bin/sh" });
  execSync("mkdir -p .sakti/changes/add-feature cache-parent/child", { cwd, shell: "/bin/sh" });
  execSync("printf 'name: add-feature\n' > .sakti/changes/add-feature/.sakti.yaml", {
    cwd,
    shell: "/bin/sh",
  });
  execSync("printf '# proposal\n' > .sakti/changes/add-feature/proposal.md", {
    cwd,
    shell: "/bin/sh",
  });
  ctx.settingsFile.update({ worktree: { dependencySymlinkDirs: ["cache-parent/child"] } });
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
    expect(
      execSync("git rev-parse refs/heads/sakti/add-feature", {
        cwd,
        shell: "/bin/sh",
      })
        .toString()
        .trim(),
    ).toBe(originalHead);
    const after = ctx.repos.sessions.findById(session.id);
    expect(after?.pendingTransitionTo).toBe("mission");
    expect(after?.worktreePath).toBeNull();
  } finally {
    delete process.env.SAKTI_AGENT_DIR;
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

This setup is intentional: `main` has an untracked `cache-parent/child` dependency target, while the pre-existing `sakti/add-feature` branch has a tracked `cache-parent` file. `linkDependencyDirs` will see the main target but fail creating the worktree link parent because that parent is a file in the worktree.

- [ ] **Step 7: Run confirm test**

Run:

```bash
vp run '@sakti-code/server#test' -- src/routes/sessions/__tests__/confirm.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts apps/server/src/routes/sessions/confirm.ts apps/server/src/routes/sessions/__tests__/confirm.test.ts
git commit -m "fix(server): roll back mission branch on failed graduation"
```

---

## Task 5: Structured Preflight And Explicit Stash Opt-In

**Files:**

- Modify: `packages/tools/src/transition/index.ts`
- Modify: `packages/tools/src/transition/__tests__/transition.test.ts`
- Modify: `apps/server/src/lib/worktree.ts`
- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`
- Modify: `apps/server/src/agent/config/tool-registry.ts`
- Modify: `apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts`

**Interfaces:**

- Produces:
  - `TransitionToolInput` includes `preserveUnrelated?: "stash"`
  - `analyzeWorktreeForMission(cwd: string, activeChangeName: string | null): MissionWorktreePreflight`
  - `preflightWorktree(cwd: string, activeChangeName: string | null): string | null` remains for confirm compatibility.
  - `stashUnrelatedChanges(projectCwd: string, changeName: string, paths: readonly string[]): string | null`
- Contract: unrelated dirty paths block mission transition unless `preserveUnrelated: "stash"` is present; with the opt-in, only unrelated paths are stashed, active change paths remain for branch absorb.

- [ ] **Step 1: Add transition schema test**

In `packages/tools/src/transition/__tests__/transition.test.ts`, add or update a test to assert the tool accepts the optional stash intent:

```ts
it("accepts explicit preserveUnrelated stash intent", () => {
  const tool = createTransitionTool();
  expect(tool.parameters.properties.preserveUnrelated).toBeDefined();
});
```

- [ ] **Step 2: Run transition package test to verify it fails**

Run:

```bash
vp run '@sakti-code/tools#test' -- src/transition/__tests__/transition.test.ts
```

Expected: FAIL because `preserveUnrelated` is not in the schema.

- [ ] **Step 3: Add optional transition schema field**

In `packages/tools/src/transition/index.ts`, update `transitionSchema`:

```ts
const transitionSchema = Type.Object({
  to: Type.String({
    description: "Destination phase: specify, build, verify, archive, or mission.",
  }),
  body: Type.String({
    description: "Mission brief, fixing plan, or transition summary.",
  }),
  preserveUnrelated: Type.Optional(
    Type.Literal("stash", {
      description:
        "For to='mission' only: explicitly stash unrelated dirty paths before opening the mission gate.",
    }),
  ),
});
```

If the existing descriptions differ, preserve their wording and add only the new optional property.

- [ ] **Step 4: Run transition package test to verify it passes**

Run:

```bash
vp run '@sakti-code/tools#test' -- src/transition/__tests__/transition.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add failing worktree tests for structured analysis and stash helper**

In `apps/server/src/lib/__tests__/worktree.test.ts`, add:

```ts
it("analyzeWorktreeForMission reports unrelated dirty paths separately from active change paths", () => {
  initGitRepo(projectDir);
  mkdirSync(join(projectDir, ".sakti/changes/add-feature"), { recursive: true });
  writeFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "# proposal\n");
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "src/dirty.ts"), "dirty\n");

  const result = analyzeWorktreeForMission(projectDir, "add-feature");

  expect(result.ok).toBe(false);
  expect(result.code).toBe("dirty-unrelated");
  expect(result.unrelatedPaths).toContain("src/dirty.ts");
  expect(result.allowedChangePaths).toContain(".sakti/changes/add-feature/proposal.md");
});

it("stashUnrelatedChanges stashes only unrelated paths and leaves active change content", () => {
  initGitRepo(projectDir);
  mkdirSync(join(projectDir, ".sakti/changes/add-feature"), { recursive: true });
  writeFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "# proposal\n");
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "src/dirty.ts"), "dirty\n");

  const stashRef = stashUnrelatedChanges(projectDir, "add-feature", ["src/dirty.ts"]);

  expect(stashRef).not.toBeNull();
  expect(existsSync(join(projectDir, "src/dirty.ts"))).toBe(false);
  expect(existsSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
  expect(
    execSync("git stash list --format=%s -1", {
      cwd: projectDir,
      shell: "/bin/sh",
    }).toString(),
  ).toContain("sakti: preserve unrelated changes before mission add-feature");
});
```

Add imports for `analyzeWorktreeForMission` and `stashUnrelatedChanges`.

- [ ] **Step 6: Run worktree test to verify it fails**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: FAIL because the structured analysis and stash helper do not exist.

- [ ] **Step 7: Implement structured preflight helpers**

In `apps/server/src/lib/worktree.ts`, add:

```ts
export type MissionWorktreePreflight =
  | {
      ok: true;
      allowedChangePaths: string[];
      unrelatedPaths: string[];
    }
  | {
      ok: false;
      code: "not-git-repo" | "missing-default-branch" | "dirty-unrelated";
      message: string;
      allowedChangePaths: string[];
      unrelatedPaths: string[];
    };

function parsePorcelainPath(line: string): { checkPath: string; stashPaths: string[] } | null {
  if (line.trim() === "") {
    return null;
  }
  const filePath = line.slice(3).replace(/^"|"$/g, "");
  const segs = filePath.split(" -> ");
  if (segs.length > 1) {
    const source = segs[0] ?? "";
    const dest = segs[segs.length - 1] ?? "";
    return { checkPath: dest, stashPaths: [source, dest].filter((path) => path !== "") };
  }
  return { checkPath: filePath, stashPaths: [filePath] };
}

export function analyzeWorktreeForMission(
  cwd: string,
  activeChangeName: string | null,
): MissionWorktreePreflight {
  try {
    git(cwd, "rev-parse --is-inside-work-tree");
  } catch {
    return {
      ok: false,
      code: "not-git-repo",
      message: `"${cwd}" is not a git repository. Initialize git (git init) before this mission can be isolated in a worktree.`,
      allowedChangePaths: [],
      unrelatedPaths: [],
    };
  }
  const base = detectDefaultBranch(cwd);
  if (!base) {
    return {
      ok: false,
      code: "missing-default-branch",
      message: `Could not detect a default branch in "${cwd}". Ensure the repo has at least one commit on a branch.`,
      allowedChangePaths: [],
      unrelatedPaths: [],
    };
  }
  let porcelain = "";
  try {
    porcelain = execSync("git status --porcelain --untracked-files=all", {
      cwd,
      shell: "/bin/sh",
      encoding: "utf-8",
    });
  } catch {
    porcelain = "";
  }
  const allowedPrefix = activeChangeName ? `.sakti/changes/${activeChangeName}/` : null;
  const allowedChangePaths: string[] = [];
  const unrelatedPaths: string[] = [];
  for (const line of porcelain.split("\n")) {
    const parsed = parsePorcelainPath(line);
    if (!parsed) {
      continue;
    }
    const allowed = allowedPrefix !== null ? parsed.checkPath.startsWith(allowedPrefix) : false;
    if (allowed) {
      allowedChangePaths.push(parsed.checkPath);
    } else {
      unrelatedPaths.push(...parsed.stashPaths);
    }
  }
  if (unrelatedPaths.length > 0) {
    const first = unrelatedPaths[0] ?? "unknown";
    return {
      ok: false,
      code: "dirty-unrelated",
      message: `Working tree isn't clean (unexpected change: "${first}").`,
      allowedChangePaths,
      unrelatedPaths: [...new Set(unrelatedPaths)],
    };
  }
  return { ok: true, allowedChangePaths, unrelatedPaths: [] };
}
```

Then rewrite `preflightWorktree` as a compatibility wrapper:

```ts
export function preflightWorktree(cwd: string, activeChangeName: string | null): string | null {
  const result = analyzeWorktreeForMission(cwd, activeChangeName);
  if (result.ok) {
    return null;
  }
  if (result.code === "dirty-unrelated") {
    return `${result.message} Commit, stash, or call transition({ to: "mission", body: "...", preserveUnrelated: "stash" }) to let Sakti stash unrelated paths before retrying.`;
  }
  return result.message;
}
```

Add `stashUnrelatedChanges`:

```ts
export function stashUnrelatedChanges(
  projectCwd: string,
  changeName: string,
  paths: readonly string[],
): string | null {
  if (paths.length === 0) {
    return null;
  }
  const quotedPaths = paths.map((path) => shellQuote(path)).join(" ");
  git(
    projectCwd,
    `stash push --include-untracked -m ${shellQuote(
      `sakti: preserve unrelated changes before mission ${changeName}`,
    )} -- ${quotedPaths}`,
  );
  const ref = git(projectCwd, "stash list --format=%gd -1");
  return ref === "" ? null : ref;
}
```

- [ ] **Step 8: Run worktree test to verify it passes**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts
```

Expected: PASS.

- [ ] **Step 9: Add failing wrapper tests for guidance and explicit stash**

In `apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts`, add:

```ts
it("mission transition with unrelated dirty paths returns actionable stash opt-in guidance", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "sakti-transition-dirty-"));
  initGitRepo(cwd);
  mkdirSync(join(cwd, ".sakti/changes/add-feature"), { recursive: true });
  writeFileSync(join(cwd, ".sakti/changes/add-feature/.sakti.yaml"), "name: add-feature\n");
  writeFileSync(join(cwd, ".sakti/changes/add-feature/proposal.md"), "# proposal\n");
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src/dirty.ts"), "dirty\n");
  try {
    const [tool] = buildAgentTools(["transition"], { cwd } as never);

    const result = await tool.execute(
      {} as never,
      {
        to: "mission",
        body: "brief",
      } as never,
    );

    expect(result.terminate).toBe(false);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain('preserveUnrelated: "stash"');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

it("mission transition with preserveUnrelated stashes unrelated paths and proceeds", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "sakti-transition-stash-"));
  initGitRepo(cwd);
  mkdirSync(join(cwd, ".sakti/changes/add-feature"), { recursive: true });
  writeFileSync(join(cwd, ".sakti/changes/add-feature/.sakti.yaml"), "name: add-feature\n");
  writeFileSync(join(cwd, ".sakti/changes/add-feature/proposal.md"), "# proposal\n");
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src/dirty.ts"), "dirty\n");
  try {
    const [tool] = buildAgentTools(["transition"], { cwd } as never);

    const result = await tool.execute(
      {} as never,
      {
        to: "mission",
        body: "brief",
        preserveUnrelated: "stash",
      } as never,
    );

    expect(result.terminate).toBe(true);
    expect(existsSync(join(cwd, "src/dirty.ts"))).toBe(false);
    expect(existsSync(join(cwd, ".sakti/changes/add-feature/proposal.md"))).toBe(true);
    expect(
      execSync("git stash list --format=%s -1", {
        cwd,
        shell: "/bin/sh",
      }).toString(),
    ).toContain("sakti: preserve unrelated changes before mission add-feature");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
```

Use the existing test helper for `initGitRepo` if this file already defines one; otherwise define a local helper that runs `git init -b main`, configures user name/email, and creates an empty commit.

- [ ] **Step 10: Run wrapper test to verify it fails**

Run:

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-tool-wrapper.test.ts
```

Expected: FAIL because the wrapper does not inspect `preserveUnrelated` or stash paths.

- [ ] **Step 11: Implement wrapper behavior**

In `apps/server/src/agent/config/tool-registry.ts`, update imports from `worktree.ts`:

```ts
import {
  analyzeWorktreeForMission,
  preflightWorktree,
  stashUnrelatedChanges,
} from "../../lib/worktree.ts";
```

Then replace the mission preflight block inside `wrapTransitionTool` with:

```ts
const args = callArgs[1] as { to?: unknown; body?: unknown; preserveUnrelated?: unknown };
if (args.to === "mission") {
  const activeChange = resolveActiveChangeName(ctx.cwd);
  const analysis = analyzeWorktreeForMission(ctx.cwd, activeChange);
  if (!analysis.ok && analysis.code === "dirty-unrelated" && args.preserveUnrelated === "stash") {
    if (!activeChange) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Cannot transition to mission: no active change was found, so Sakti cannot safely preserve unrelated changes.",
          },
        ],
        details: undefined,
        terminate: false,
      };
    }
    const stashRef = stashUnrelatedChanges(ctx.cwd, activeChange, analysis.unrelatedPaths);
    const afterStashErr = preflightWorktree(ctx.cwd, activeChange);
    if (afterStashErr) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Cannot transition to mission after stashing unrelated changes${
              stashRef ? ` (${stashRef})` : ""
            }: ${afterStashErr}`,
          },
        ],
        details: undefined,
        terminate: false,
      };
    }
  } else if (!analysis.ok) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            analysis.code === "dirty-unrelated"
              ? `Cannot transition to mission: ${analysis.message} To let Sakti stash unrelated work and continue, call transition({ to: "mission", body: ${JSON.stringify(
                  typeof args.body === "string" ? args.body : "mission brief",
                )}, preserveUnrelated: "stash" }).`
              : `Cannot transition to mission: ${analysis.message} Fix this, then call transition({ to: "mission" }) again.`,
        },
      ],
      details: undefined,
      terminate: false,
    };
  }
}
```

This keeps stash explicit, avoids a DB migration, and means a rejected gate leaves unrelated changes stashed. That is acceptable because the stash only happens after the agent explicitly requested `preserveUnrelated: "stash"` and the tool response/gate makes the state visible.

- [ ] **Step 12: Run wrapper test to verify it passes**

Run:

```bash
vp run '@sakti-code/server#test' -- src/agent/config/__tests__/transition-tool-wrapper.test.ts
```

Expected: PASS.

- [ ] **Step 13: Run all task tests**

Run:

```bash
vp run '@sakti-code/tools#test' -- src/transition/__tests__/transition.test.ts
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts src/agent/config/__tests__/transition-tool-wrapper.test.ts
```

Expected: PASS.

- [ ] **Step 14: Commit**

Run:

```bash
git add packages/tools/src/transition/index.ts packages/tools/src/transition/__tests__/transition.test.ts apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts apps/server/src/agent/config/tool-registry.ts apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts
git commit -m "feat(server): allow explicit stash before mission transition"
```

---

## Task 6: Preflight Error Copy And Confirm Response Behavior

**Files:**

- Modify: `apps/server/src/lib/__tests__/worktree.test.ts`
- Modify: `apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts`
- Modify: `apps/server/src/routes/sessions/__tests__/confirm.test.ts`
- Modify as needed: `apps/server/src/lib/worktree.ts`
- Modify as needed: `apps/server/src/agent/config/tool-registry.ts`

**Interfaces:**

- Consumes: `preflightWorktree`, `analyzeWorktreeForMission`, wrapper output from Task 5.
- Produces: user-facing messages that name the unexpected path and the exact opt-in call when relevant.

- [ ] **Step 1: Add message assertions**

In `apps/server/src/lib/__tests__/worktree.test.ts`, add:

```ts
it("preflightWorktree names the unexpected path and explicit stash option", () => {
  initGitRepo(projectDir);
  mkdirSync(join(projectDir, ".sakti/changes/add-feature"), { recursive: true });
  writeFileSync(join(projectDir, ".sakti/changes/add-feature/proposal.md"), "# proposal\n");
  writeFileSync(join(projectDir, "dirty.txt"), "dirty\n");

  const err = preflightWorktree(projectDir, "add-feature");

  expect(err).toContain('unexpected change: "dirty.txt"');
  expect(err).toContain('preserveUnrelated: "stash"');
});
```

In `apps/server/src/routes/sessions/__tests__/confirm.test.ts`, update the existing dirty-main confirm test to assert the 500 body:

```ts
const json = (await res.json()) as { error: string };
expect(json.error).toContain('unexpected change: "src/dirty.ts"');
expect(json.error).toContain('preserveUnrelated: "stash"');
```

- [ ] **Step 2: Run tests to verify messages**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts src/routes/sessions/__tests__/confirm.test.ts src/agent/config/__tests__/transition-tool-wrapper.test.ts
```

Expected: PASS if Task 5 implemented the copy exactly; otherwise FAIL on message content.

- [ ] **Step 3: Adjust copy if needed**

If Step 2 fails, update copy in `preflightWorktree` and `tool-registry.ts` to include both:

```txt
unexpected change: "<path>"
```

and:

```txt
preserveUnrelated: "stash"
```

The confirm route should return the `preflightWorktree` message unchanged inside `{ error }`.

- [ ] **Step 4: Run tests again**

Run:

```bash
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree.test.ts src/routes/sessions/__tests__/confirm.test.ts src/agent/config/__tests__/transition-tool-wrapper.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/server/src/lib/worktree.ts apps/server/src/lib/__tests__/worktree.test.ts apps/server/src/agent/config/tool-registry.ts apps/server/src/agent/config/__tests__/transition-tool-wrapper.test.ts apps/server/src/routes/sessions/__tests__/confirm.test.ts
git commit -m "fix(server): clarify mission preflight errors"
```

---

## Task 7: Final Verification And Plan Update

**Files:**

- Modify: `docs/plans/2026-07-08-worktree-isolation-v2.1.md` if execution discovers necessary corrections.

**Interfaces:**

- Consumes: all previous tasks.
- Produces: verified final state.

- [ ] **Step 1: Run targeted package tests**

Run:

```bash
vp run '@sakti-code/tools#test' -- src/transition/__tests__/transition.test.ts
vp run '@sakti-code/server#test' -- src/lib/__tests__/worktree-settings.test.ts src/lib/__tests__/worktree.test.ts src/agent/config/__tests__/transition-tool-wrapper.test.ts src/routes/sessions/__tests__/confirm.test.ts
vp run 'desktop#test' -- src/stores/server/__tests__/actions.test.ts src/components/onboarding/__tests__/plan-chat.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full checks**

Run:

```bash
vp check
vp run -r test
```

Expected: `vp check` PASS. `vp run -r test` should PASS except for any already-known pre-existing failures in `packages/sakti/src/sdd/commands/__tests__`; if those still fail, record the exact failing test names in the execution handoff and confirm no v2.1 test failed.

- [ ] **Step 3: Re-index the codebase after implementation**

Run the MCP indexer:

```text
index_repository(repo_path="/home/eekrain/CODE/sakti-code", name="sakti-code", mode="full", persistence=true)
```

Expected: index completes with `status: "indexed"`.

- [ ] **Step 4: Sanity-search for old assumptions**

Use MCP `search_code` for:

```text
pattern="Commit or stash your changes first"
path_filter="apps/server/src/.*\\.(ts)$"
```

Expected: no stale production message that omits `preserveUnrelated: "stash"`.

Use MCP `search_code` for:

```text
pattern="worktreePath"
path_filter="apps/desktop/src/.*\\.(ts|tsx)$"
```

Expected: `confirmTransition` mirrors `worktreePath`, and `PlanChat` carries it into `createSession`.

- [ ] **Step 5: Commit verification-only doc corrections if any**

If the implementation required edits to this plan, commit them:

```bash
git add docs/plans/2026-07-08-worktree-isolation-v2.1.md
git commit -m "docs: update worktree isolation v2.1 plan"
```

If no plan edits were needed, do not create an empty commit.

## Self-Review

- Spec coverage: covered desktop handoff failure, failed confirm no-op, unsafe symlink override validation, tracked change-dir cleanup, pre-existing branch rollback, explicit stash opt-in, and preflight copy.
- Placeholder scan: no banned placeholder text remains.
- Type consistency: `preserveUnrelated` is `"stash"` in schema, wrapper, and tests; `CleanMainChangeDirResult` values match all tests; branch rollback helpers use `projectCwd`, `changeName`, and `head` consistently.
