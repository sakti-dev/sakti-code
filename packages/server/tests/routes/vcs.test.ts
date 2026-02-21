/**
 * Tests for VCS routes
 *
 * Tests the VCS API endpoints
 */

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("GET /api/vcs", () => {
  it("returns VCS info for a git repository", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request(
      "http://localhost/api/vcs?directory=/home/eekrain/CODE/ekacode",
      { method: "GET" }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("directory");
    expect(body).toHaveProperty("type");
  });

  it("returns type 'none' for non-git directory", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs?directory=/tmp", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe("none");
    expect(body.status).toBe("uninitialized");
  });

  it("returns 400 for empty directory", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs?directory=", {
      method: "GET",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  it("includes branch and commit for git repo", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request(
      "http://localhost/api/vcs?directory=/home/eekrain/CODE/ekacode",
      { method: "GET" }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    if (body.type === "git") {
      expect(body).toHaveProperty("branch");
      expect(body).toHaveProperty("commit");
    }
  });
});

describe("POST /api/vcs/branches", () => {
  it("lists local branches from a repo path", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/home/eekrain/CODE/ekacode" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.branches).toContain("main");
  });

  it("returns 400 for missing path", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for non-git directory", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Not a git repository");
  });
});

describe("POST /api/vcs/clone", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ekacode-clone-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("clones repository to target directory", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://github.com/octocat/Hello-World",
        targetDir: tempDir,
        branch: "master",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toBe(path.join(tempDir, "Hello-World"));
  });

  it("returns 400 for disallowed host", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://evil.com/repo",
        targetDir: tempDir,
        branch: "main",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("not allowed");
  });

  it("returns 400 for missing fields", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/user/repo" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });
});

describe("POST /api/vcs/worktree", () => {
  let tempDir: string;
  let repoDir: string;
  let workspacesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ekacode-worktree-test-"));
    repoDir = path.join(tempDir, "repo");
    workspacesDir = path.join(tempDir, "workspaces");

    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(workspacesDir, { recursive: true });

    execSync("git init", { cwd: repoDir });
    execSync('git config user.email "test@test.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "README.md"), "# Test");
    execSync("git add .", { cwd: repoDir });
    execSync('git commit -m "Initial commit"', { cwd: repoDir });
    // Create additional branches for testing
    execSync("git branch test-branch", { cwd: repoDir });
    execSync("git branch dev-branch", { cwd: repoDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("creates worktree from repo", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/worktree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: repoDir,
        worktreeName: "test-workspace",
        branch: "test-branch",
        worktreesDir: workspacesDir,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.worktreePath).toBe(path.join(workspacesDir, "test-workspace"));
  });

  it("creates worktree with new branch when createBranch is true", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/worktree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: repoDir,
        worktreeName: "feature-workspace",
        branch: "feature/new-branch",
        worktreesDir: workspacesDir,
        createBranch: true,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.worktreePath).toBe(path.join(workspacesDir, "feature-workspace"));

    // Verify the branch was created
    const branchOutput = execSync("git branch", {
      cwd: path.join(workspacesDir, "feature-workspace"),
      encoding: "utf-8",
    });
    expect(branchOutput).toContain("feature/new-branch");
  });

  it("returns 400 for missing fields", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/worktree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoPath: repoDir }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for non-git repository", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const nonGitDir = path.join(tempDir, "non-git");
    await fs.mkdir(nonGitDir, { recursive: true });

    const response = await vcsRouter.request("http://localhost/api/vcs/worktree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: nonGitDir,
        worktreeName: "test-workspace",
        branch: "test-branch",
        worktreesDir: workspacesDir,
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Not a git repository");
  });
});

describe("GET /api/vcs/worktree/exists", () => {
  let tempDir: string;
  let workspacesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ekacode-exists-test-"));
    workspacesDir = path.join(tempDir, "workspaces");
    await fs.mkdir(workspacesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns exists=true if worktree name is taken", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    await fs.mkdir(path.join(workspacesDir, "existing-name"), { recursive: true });

    const response = await vcsRouter.request(
      `http://localhost/api/vcs/worktree/exists?name=existing-name&worktreesDir=${encodeURIComponent(workspacesDir)}`,
      { method: "GET" }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.exists).toBe(true);
  });

  it("returns exists=false if worktree name is available", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request(
      `http://localhost/api/vcs/worktree/exists?name=non-existent&worktreesDir=${encodeURIComponent(workspacesDir)}`,
      { method: "GET" }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.exists).toBe(false);
  });

  it("returns 400 for missing name parameter", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request(
      `http://localhost/api/vcs/worktree/exists?worktreesDir=${encodeURIComponent(workspacesDir)}`,
      { method: "GET" }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });
});

describe("GET /api/vcs/workspaces-dir", () => {
  it("returns the workspaces directory path", async () => {
    const vcsRouter = (await import("../../src/routes/vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/workspaces-dir", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toMatch(/\.sakti[\/\\]workspaces$/);
  });
});
