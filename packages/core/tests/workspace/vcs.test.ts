/**
 * VCS functions tests
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clone,
  createWorktree,
  getWorkspacesDir,
  listLocalBranches,
  worktreeExists,
} from "../../src/workspace/vcs";

describe("listLocalBranches", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ekacode-vcs-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("lists local branches from a git repository", async () => {
    const result = await listLocalBranches("/home/eekrain/CODE/ekacode");
    expect(result).toContain("main");
  });

  it("returns empty array for non-git directory", async () => {
    await expect(listLocalBranches(tempDir)).rejects.toThrow("Not a git repository");
  });

  it("throws error for non-existent directory", async () => {
    await expect(listLocalBranches("/non/existent/path")).rejects.toThrow();
  });
});

describe("clone", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ekacode-clone-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("clones a repository to target directory", async () => {
    const clonePath = await clone({
      url: "https://github.com/octocat/Hello-World",
      targetDir: tempDir,
      branch: "master",
    });

    expect(clonePath).toBe(path.join(tempDir, "Hello-World"));

    const gitDir = path.join(clonePath, ".git");
    const stat = await fs.stat(gitDir);
    expect(stat.isDirectory() || stat.isFile()).toBe(true);
  });

  it("throws error for disallowed host", async () => {
    await expect(
      clone({
        url: "https://evil.com/repo",
        targetDir: tempDir,
        branch: "main",
      })
    ).rejects.toThrow("not allowed");
  });

  it("throws error for invalid URL", async () => {
    await expect(
      clone({
        url: "not-a-valid-url",
        targetDir: tempDir,
        branch: "main",
      })
    ).rejects.toThrow();
  });
});

describe("createWorktree", () => {
  let tempDir: string;
  let repoDir: string;
  let workspacesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ekacode-worktree-"));
    repoDir = path.join(tempDir, "repo");
    workspacesDir = path.join(tempDir, "workspaces");

    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(workspacesDir, { recursive: true });

    const { default: simpleGit } = await import("simple-git");
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.email", "test@test.com");
    await git.addConfig("user.name", "Test");
    await fs.writeFile(path.join(repoDir, "README.md"), "# Test");
    await git.add(".");
    await git.commit("Initial commit");
    // Create additional branches for testing (but stay on default branch)
    await git.branch(["test-branch"]);
    await git.branch(["dev-branch"]);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("creates a worktree from repo", async () => {
    const worktreePath = await createWorktree({
      repoPath: repoDir,
      worktreeName: "test-workspace",
      branch: "test-branch",
      worktreesDir: workspacesDir,
    });

    expect(worktreePath).toBe(path.join(workspacesDir, "test-workspace"));

    const stat = await fs.stat(worktreePath);
    expect(stat.isDirectory()).toBe(true);
  });

  it("creates a worktree with new branch when createBranch is true", async () => {
    const worktreePath = await createWorktree({
      repoPath: repoDir,
      worktreeName: "feature-branch",
      branch: "feature/feature-branch",
      worktreesDir: workspacesDir,
      createBranch: true,
    });

    expect(worktreePath).toBe(path.join(workspacesDir, "feature-branch"));

    const stat = await fs.stat(worktreePath);
    expect(stat.isDirectory()).toBe(true);

    const { default: simpleGit } = await import("simple-git");
    const worktreeGit = simpleGit(worktreePath);
    const branchSummary = await worktreeGit.branchLocal();
    expect(branchSummary.current).toBe("feature/feature-branch");
  });

  it("throws error if worktree name already exists", async () => {
    await createWorktree({
      repoPath: repoDir,
      worktreeName: "existing-workspace",
      branch: "test-branch",
      worktreesDir: workspacesDir,
    });

    // Try to create another worktree with same name but different branch
    // Should fail because worktree path already exists
    await expect(
      createWorktree({
        repoPath: repoDir,
        worktreeName: "existing-workspace",
        branch: "dev/another-branch",
        worktreesDir: workspacesDir,
        createBranch: true,
      })
    ).rejects.toThrow("already exists");
  });

  it("throws error for non-git repository", async () => {
    const nonGitDir = path.join(tempDir, "non-git");
    await fs.mkdir(nonGitDir, { recursive: true });

    await expect(
      createWorktree({
        repoPath: nonGitDir,
        worktreeName: "test-workspace",
        branch: "test-branch",
        worktreesDir: workspacesDir,
      })
    ).rejects.toThrow("Not a git repository");
  });
});

describe("worktreeExists", () => {
  let tempDir: string;
  let workspacesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ekacode-exists-"));
    workspacesDir = path.join(tempDir, "workspaces");
    await fs.mkdir(workspacesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns true if worktree directory exists", async () => {
    await fs.mkdir(path.join(workspacesDir, "existing-name"), { recursive: true });

    const exists = await worktreeExists("existing-name", workspacesDir);
    expect(exists).toBe(true);
  });

  it("returns false if worktree directory does not exist", async () => {
    const exists = await worktreeExists("non-existent-name", workspacesDir);
    expect(exists).toBe(false);
  });
});

describe("getWorkspacesDir", () => {
  it("returns the workspaces directory path", () => {
    const dir = getWorkspacesDir();
    expect(dir).toMatch(/\.sakti[\/\\]workspaces$/);
  });

  it("returns an absolute path", () => {
    const dir = getWorkspacesDir();
    expect(path.isAbsolute(dir)).toBe(true);
  });
});
