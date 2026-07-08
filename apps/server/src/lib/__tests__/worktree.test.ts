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

    it("reuses a surviving sakti/<changeName> branch instead of failing", () => {
      // After an archive→done teardown the branch is kept; a later mission with
      // the same change name must not hard-fail on `worktree add -b` (duplicate
      // branch). It should re-checkout the existing branch.
      initGitRepo(projectDir);
      const wtPath = createMissionWorktree(projectDir, "recycle");
      removeMissionWorktree(projectDir, "recycle");
      // Second creation with the surviving branch — must not throw.
      const wtPath2 = createMissionWorktree(projectDir, "recycle");
      expect(existsSync(wtPath2)).toBe(true);
      expect(wtPath2).toBe(wtPath);
    });
  });
});
