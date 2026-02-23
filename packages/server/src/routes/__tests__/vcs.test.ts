/**
 * Tests for VCS routes
 *
 * Tests the VCS API endpoints
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const hasGit = (() => {
  let tempDir: string | undefined;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakti-code-git-check-"));
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@test.com"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Test"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(tempDir, "README.md"), "# Test");
    execFileSync("git", ["add", "."], { cwd: tempDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "Initial commit"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
})();

const describeGit = hasGit ? describe : describe.skip;
let gitUnavailable = !hasGit;

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
  } catch (error) {
    gitUnavailable = true;
    throw error;
  }
}

async function createTempRepo(
  prefix: string
): Promise<{ tempDir: string; repoDir: string } | null> {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), prefix));
  const repoDir = path.join(tempDir, "repo");
  await fsPromises.mkdir(repoDir, { recursive: true });

  try {
    git(repoDir, ["init"]);
    git(repoDir, ["config", "user.email", "test@test.com"]);
    git(repoDir, ["config", "user.name", "Test"]);
    await fsPromises.writeFile(path.join(repoDir, "README.md"), "# Test");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "Initial commit"]);
  } catch {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
    return null;
  }

  return { tempDir, repoDir };
}

describeGit("GET /api/vcs", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(async () => {
    const repo = await createTempRepo("sakti-code-vcs-info-");
    if (!repo) {
      tempDir = "";
      repoDir = "";
      return;
    }
    tempDir = repo.tempDir;
    repoDir = repo.repoDir;
  });

  afterEach(async () => {
    if (tempDir) {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns VCS info for a git repository", async () => {
    if (!repoDir || gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

    const response = await vcsRouter.request(`http://localhost/api/vcs?directory=${repoDir}`, {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.directory).toBe(repoDir);
    expect(body).toHaveProperty("type");
  });

  it("returns type 'none' for non-git directory", async () => {
    const vcsRouter = (await import("../vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs?directory=/tmp", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe("none");
    expect(body.status).toBe("uninitialized");
  });

  it("returns 400 for empty directory", async () => {
    const vcsRouter = (await import("../vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs?directory=", {
      method: "GET",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  it("includes branch and commit for git repo", async () => {
    if (!repoDir || gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

    const response = await vcsRouter.request(`http://localhost/api/vcs?directory=${repoDir}`, {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    if (body.type === "git") {
      expect(body).toHaveProperty("branch");
      expect(body).toHaveProperty("commit");
    }
  });
});

describeGit("POST /api/vcs/branches", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(async () => {
    const repo = await createTempRepo("sakti-code-vcs-branches-");
    if (!repo) {
      tempDir = "";
      repoDir = "";
      return;
    }
    tempDir = repo.tempDir;
    repoDir = repo.repoDir;
    git(repoDir, ["branch", "feature/test"]);
  });

  afterEach(async () => {
    if (tempDir) {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("lists local branches from a repo path", async () => {
    if (!repoDir || gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoDir }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.branches).toContain("feature/test");
  });

  it("returns 400 for missing path", async () => {
    const vcsRouter = (await import("../vcs")).default;

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
    if (gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

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

describeGit("POST /api/vcs/clone", () => {
  let tempDir: string;
  let sourceRepoDir: string;
  let sourceDefaultBranch: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sakti-code-clone-test-"));
    sourceRepoDir = path.join(tempDir, "source-repo");
    await fsPromises.mkdir(sourceRepoDir, { recursive: true });
    try {
      git(sourceRepoDir, ["init"]);
      git(sourceRepoDir, ["config", "user.email", "test@test.com"]);
      git(sourceRepoDir, ["config", "user.name", "Test"]);
      await fsPromises.writeFile(path.join(sourceRepoDir, "README.md"), "# Local Source");
      git(sourceRepoDir, ["add", "."]);
      git(sourceRepoDir, ["commit", "-m", "Initial commit"]);
      sourceDefaultBranch = git(sourceRepoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    } catch {
      gitUnavailable = true;
    }
  });

  afterEach(async () => {
    if (tempDir) {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("clones repository to target directory", async () => {
    if (gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `file://${sourceRepoDir}`,
        targetDir: tempDir,
        branch: sourceDefaultBranch,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toBe(path.join(tempDir, "source-repo"));
    const readme = await fsPromises.readFile(path.join(body.path, "README.md"), "utf-8");
    expect(readme).toContain("Local Source");
  });

  it("returns 400 for disallowed host", async () => {
    if (gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

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
    if (gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

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

describeGit("POST /api/vcs/worktree", () => {
  let tempDir: string;
  let repoDir: string;
  let workspacesDir: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sakti-code-worktree-test-"));
    repoDir = path.join(tempDir, "repo");
    workspacesDir = path.join(tempDir, "workspaces");

    await fsPromises.mkdir(repoDir, { recursive: true });
    await fsPromises.mkdir(workspacesDir, { recursive: true });

    try {
      git(repoDir, ["init"]);
      git(repoDir, ["config", "user.email", "test@test.com"]);
      git(repoDir, ["config", "user.name", "Test"]);
      await fsPromises.writeFile(path.join(repoDir, "README.md"), "# Test");
      git(repoDir, ["add", "."]);
      git(repoDir, ["commit", "-m", "Initial commit"]);
      // Create additional branches for testing
      git(repoDir, ["branch", "test-branch"]);
      git(repoDir, ["branch", "dev-branch"]);
    } catch {
      gitUnavailable = true;
    }
  });

  afterEach(async () => {
    if (tempDir) {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("creates worktree from repo", async () => {
    if (gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

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
    if (gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

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
    const branchOutput = git(path.join(workspacesDir, "feature-workspace"), ["branch"]);
    expect(branchOutput).toContain("feature/new-branch");
  });

  it("returns 400 for missing fields", async () => {
    if (gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

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
    if (gitUnavailable) return;
    const vcsRouter = (await import("../vcs")).default;

    const nonGitDir = path.join(tempDir, "non-git");
    await fsPromises.mkdir(nonGitDir, { recursive: true });

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
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "sakti-code-exists-test-"));
    workspacesDir = path.join(tempDir, "workspaces");
    await fsPromises.mkdir(workspacesDir, { recursive: true });
  });

  afterEach(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  it("returns exists=true if worktree name is taken", async () => {
    const vcsRouter = (await import("../vcs")).default;

    await fsPromises.mkdir(path.join(workspacesDir, "existing-name"), { recursive: true });

    const response = await vcsRouter.request(
      `http://localhost/api/vcs/worktree/exists?name=existing-name&worktreesDir=${encodeURIComponent(workspacesDir)}`,
      { method: "GET" }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.exists).toBe(true);
  });

  it("returns exists=false if worktree name is available", async () => {
    const vcsRouter = (await import("../vcs")).default;

    const response = await vcsRouter.request(
      `http://localhost/api/vcs/worktree/exists?name=non-existent&worktreesDir=${encodeURIComponent(workspacesDir)}`,
      { method: "GET" }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.exists).toBe(false);
  });

  it("returns 400 for missing name parameter", async () => {
    const vcsRouter = (await import("../vcs")).default;

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
    const vcsRouter = (await import("../vcs")).default;

    const response = await vcsRouter.request("http://localhost/api/vcs/workspaces-dir", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const expectedRoot =
      process.env.SAKTI_CODE_HOME && path.isAbsolute(process.env.SAKTI_CODE_HOME)
        ? process.env.SAKTI_CODE_HOME
        : path.join(os.homedir(), ".sakti");
    expect(body.path).toBe(path.join(expectedRoot, "workspaces"));
  });
});
