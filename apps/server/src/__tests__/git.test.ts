import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { spawnPiped } from "../lib/spawn.ts";
import { gitRoutes, runGit } from "../routes/projects/git.ts";
import { makeApp } from "./helpers.ts";

function execGit(cwd: string, ...args: string[]): Promise<string> {
  const { done } = spawnPiped("git", args, {
    cwd,
    env: { ...process.env } as Record<string, string>,
  });
  return done.then((r) => r.stdout);
}

async function createTempGitRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "sakti-git-test-"));
  await execGit(dir, "init", "-b", "main");
  await execGit(dir, "config", "user.name", "Test");
  await execGit(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, "hello.txt"), "original\n");
  await execGit(dir, "add", "hello.txt");
  await execGit(dir, "commit", "-m", "initial");
  writeFileSync(join(dir, "hello.txt"), "modified\n");
  return dir;
}

describe("git routes", () => {
  let tempDir: string;
  let projectId: string;
  let app: Awaited<ReturnType<typeof makeApp>>["app"];

  beforeAll(async () => {
    tempDir = await createTempGitRepo();
    const built = await makeApp([gitRoutes]);
    app = built.app;
    projectId = (await built.ctx.repos.projects.create("git-test", tempDir)).id;
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("GET /api/projects/:id/git/status returns modified file name", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectId}/git/status`),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("hello.txt");
  });

  it("GET /api/projects/:id/git/branch returns current branch", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectId}/git/branch`),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.trim()).toBe("main");
  });

  it("GET /api/projects/:id/git/log returns commit message", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectId}/git/log?limit=5`),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("initial");
  });

  it("GET /api/projects/:id/git/status returns 404 for unknown project", async () => {
    const res = await app.request(
      new Request("http://localhost/api/projects/nonexistent/git/status"),
    );
    expect(res.status).toBe(404);
  });

  it("gitRoutes is composable via makeApp", async () => {
    const built = await makeApp([gitRoutes]);
    const res = await built.app.request(
      new Request("http://localhost/api/projects/nonexistent/git/status"),
    );
    expect(res.status).toBe(404);
  });

  it("diff with shell metacharacters in path is treated literally", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectId}/git/diff?path=foo%3Brm`),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("rm");
  });

  it("GET /api/projects/:id/git/diff with staged=true shows staged changes", async () => {
    await execGit(tempDir, "add", "hello.txt");
    try {
      const res = await app.request(
        new Request(`http://localhost/api/projects/${projectId}/git/diff?staged=true`),
      );
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("hello.txt");
      expect(body).toContain("+modified");
    } finally {
      await execGit(tempDir, "reset", "hello.txt");
    }
  });

  it("GET /api/projects/:id/git/diff on non-existent path returns 200 with git output", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectId}/git/diff?path=nope.txt`),
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/projects/:id/git/log rejects negative limit with 400", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectId}/git/log?limit=-5`),
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when git is not on PATH", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      const res = await app.request(
        new Request(`http://localhost/api/projects/${projectId}/git/status`),
      );
      expect(res.status).toBe(500);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("GET /api/projects/:id/git/turn-diff returns structured diff against HEAD", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectId}/git/turn-diff`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.files)).toBe(true);
    expect(body.files.length).toBeGreaterThan(0);
    const hello = body.files.find((f: { path: string }) => f.path === "hello.txt");
    expect(hello).toBeDefined();
    expect(hello.additions).toBeGreaterThanOrEqual(1);
    expect(typeof body.diff).toBe("string");
    expect(body.diff).toContain("hello.txt");
    expect(body.cwd).toBe(tempDir);
  });

  it("GET /api/projects/:id/git/turn-diff?files[]=hello.txt scopes the diff", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectId}/git/turn-diff?files[]=hello.txt`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].path).toBe("hello.txt");
  });

  it("GET /api/projects/:id/git/turn-diff returns 404 for unknown project", async () => {
    const res = await app.request(new Request("http://localhost/api/projects/nope/git/turn-diff"));
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/:id/git/turn-diff returns empty files for a repo with no commits", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "sakti-git-empty-"));
    try {
      await execGit(emptyDir, "init", "-b", "main");
      writeFileSync(join(emptyDir, "x.txt"), "x\n");
      const built = await makeApp([gitRoutes]);
      const p = await built.ctx.repos.projects.create("empty", emptyDir);
      const res = await built.app.request(
        new Request(`http://localhost/api/projects/${p.id}/git/turn-diff`),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.files).toEqual([]);
      expect(body.diff).toBe("");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("runGit timeout", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempGitRepo();
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("kills and reports timeout for a hanging git process", async () => {
    const result = await runGit(["hash-object", "--stdin"], tempDir, 200);
    expect(result.kind).toBe("timeout");
    expect(result.output).toBe("git timed out");
  });
});
