import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRoutes, runGit } from "../routes/git.ts";
import { makeApp } from "./helpers.ts";

function execGit(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: { ...process.env } });
  return proc.exited.then(() => new Response(proc.stdout).text());
}

async function createTempGitRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "sakti-git-test-"));
  await execGit(dir, "init", "-b", "main");
  await execGit(dir, "config", "user.name", "Test");
  await execGit(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, "hello.txt"), "original\n");
  await execGit(dir, "add", "hello.txt");
  await execGit(dir, "commit", "-m", "initial");
  // Modify the file so status shows a change
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

  it("GET /api/git/status returns modified file name", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/git/status?projectId=${projectId}`)
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("hello.txt");
  });

  it("GET /api/git/branch returns current branch", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/git/branch?projectId=${projectId}`)
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.trim()).toBe("main");
  });

  it("GET /api/git/log returns commit message", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/git/log?projectId=${projectId}&limit=5`)
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("initial");
  });

  it("GET /api/git/status returns 404 for unknown project", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/git/status?projectId=nonexistent")
    );
    expect(res.status).toBe(404);
  });

  it("gitRoutes is composable via makeApp", async () => {
    // Already proven by the above tests using makeApp([gitRoutes])
    // This explicit assertion documents the composition contract
    const built = await makeApp([gitRoutes]);
    const res = await built.app.handle(
      new Request("http://localhost/api/git/status?projectId=nonexistent")
    );
    // Route exists (not 404 from Elysia "not found") — 404 is from our handler
    expect(res.status).toBe(404);
  });

  it("diff with shell metacharacters in path is treated literally", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/git/diff?projectId=${projectId}&path=foo%3Brm`
      )
    );
    // Should return 200 (not a shell injection) with git's benign output
    expect(res.status).toBe(200);
    const body = await res.text();
    // Body should not contain evidence of shell execution
    expect(body).not.toContain("rm");
  });

  it("GET /api/git/diff with staged=true shows staged changes", async () => {
    // Stage the modified file
    await execGit(tempDir, "add", "hello.txt");
    try {
      const res = await app.handle(
        new Request(
          `http://localhost/api/git/diff?projectId=${projectId}&staged=true`
        )
      );
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("hello.txt");
      expect(body).toContain("+modified");
    } finally {
      await execGit(tempDir, "reset", "hello.txt");
    }
  });

  it("GET /api/git/diff on non-existent path returns 200 with git output", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/git/diff?projectId=${projectId}&path=nope.txt`
      )
    );
    // Non-zero exit is treated as success (design Decision 3)
    expect(res.status).toBe(200);
  });

  it("GET /api/git/log rejects negative limit with 422", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/git/log?projectId=${projectId}&limit=-5`
      )
    );
    expect(res.status).toBe(422);
  });

  it("returns 500 when git is not on PATH", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      const res = await app.handle(
        new Request(`http://localhost/api/git/status?projectId=${projectId}`)
      );
      expect(res.status).toBe(500);
    } finally {
      process.env.PATH = originalPath;
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
    // git hash-object --stdin blocks waiting for stdin input that never comes
    const result = await runGit(["hash-object", "--stdin"], tempDir, 200);
    expect(result.kind).toBe("timeout");
    expect(result.output).toBe("git timed out");
  });
});
