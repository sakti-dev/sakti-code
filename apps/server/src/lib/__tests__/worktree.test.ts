import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createMissionWorktree,
  detectDefaultBranch,
  preflightWorktree,
  removeMissionWorktree,
  worktreePathFor,
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
    process.env.SAKTI_AGENT_DIR = join(projectDir, "agent");
  });

  afterEach(() => {
    // Clean up worktrees + the project dir.
    try {
      execSync("git worktree prune", { cwd: projectDir, shell: "/bin/sh", stdio: "ignore" });
    } catch {
      // ignore
    }
    rmSync(projectDir, { recursive: true, force: true });
    delete process.env.SAKTI_AGENT_DIR;
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

  describe("createMissionWorktree + removeMissionWorktree", () => {
    it("creates a worktree under <base>/<projectBasename>--<changeName> and a sakti/<changeName> branch", () => {
      initGitRepo(projectDir);
      const wtPath = createMissionWorktree(projectDir, "proj-test001", "add-feature");
      expect(existsSync(wtPath)).toBe(true);
      expect(wtPath).toContain("add-feature");
      expect(wtPath).toContain("--add-feature");
      // The branch exists in the worktree.
      const branch = execSync("git branch --list sakti/add-feature", {
        cwd: projectDir,
        shell: "/bin/sh",
      }).toString();
      expect(branch).toContain("sakti/add-feature");
    });

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

    it("reuses a surviving sakti/<changeName> branch instead of failing", () => {
      // After an archive→done teardown the branch is kept; a later mission with
      // the same change name must not hard-fail on `worktree add -b` (duplicate
      // branch). It should re-checkout the existing branch.
      initGitRepo(projectDir);
      const wt = createMissionWorktree(projectDir, "proj-test001", "recycle");
      removeMissionWorktree(projectDir, wt);
      // Second creation with the surviving branch — must not throw.
      const wt2 = createMissionWorktree(projectDir, "proj-test001", "recycle");
      expect(existsSync(wt2)).toBe(true);
      expect(wt2).toBe(wt);
    });
  });
});
