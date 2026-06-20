import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { turnDiffRoutes } from "../routes/turn-diff.ts";
import { makeApp } from "./helpers.ts";

function execGit(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: { ...process.env } });
  return proc.exited.then(() => new Response(proc.stdout).text());
}

async function createTempGitRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "sakti-diff-test-"));
  await execGit(dir, "init", "-b", "main");
  await execGit(dir, "config", "user.name", "Test");
  await execGit(dir, "config", "user.email", "test@example.com");
  writeFileSync(join(dir, "readme.md"), "# Hello\n");
  writeFileSync(join(dir, "index.ts"), 'console.log("hello");\n');
  await execGit(dir, "add", ".");
  await execGit(dir, "commit", "-m", "initial");
  // Modify one file with real newlines
  writeFileSync(join(dir, "readme.md"), "# Hello\n\nAdded content\n");
  // Add a new file that's not tracked
  writeFileSync(join(dir, "new.ts"), "const x = 1;\n");
  return dir;
}

describe("turn diff routes", () => {
  let tempDir: string;
  let sessionId: string;
  let app: Awaited<ReturnType<typeof makeApp>>["app"];

  beforeAll(async () => {
    tempDir = await createTempGitRepo();
    const built = await makeApp([turnDiffRoutes]);
    app = built.app;
    const project = await built.ctx.repos.projects.create("diff-test", tempDir);
    sessionId = (
      await built.ctx.repos.sessions.create(project.id, "test-model")
    ).id;
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("GET /api/sessions/:id/turn-diff returns diff for a session in a git repo", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${sessionId}/turn-diff`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("files");
    expect(body).toHaveProperty("diff");
    expect(body).toHaveProperty("cwd", tempDir);
    expect(Array.isArray(body.files)).toBe(true);
    // There should be at least the modified readme.md file
    const readmeEntry = body.files.find(
      (f: { path: string }) => f.path === "readme.md"
    );
    expect(readmeEntry).toBeDefined();
    expect(readmeEntry.additions).toBeGreaterThan(0);
  });

  it("GET /api/sessions/nope/turn-diff returns 404", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/turn-diff")
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/sessions/:id/turn-diff?files[]=readme.md returns only that file", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/sessions/${sessionId}/turn-diff?files[]=readme.md`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].path).toBe("readme.md");
  });
});

describe("turn diff - edge cases", () => {
  it("returns empty diff for a repo with no changes since HEAD", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sakti-diff-clean-"));
    try {
      // Init repo + commit without any uncommitted changes
      await execGit(tempDir, "init", "-b", "main");
      await execGit(tempDir, "config", "user.name", "Test");
      await execGit(tempDir, "config", "user.email", "test@example.com");
      writeFileSync(join(tempDir, "file.txt"), "content\n");
      await execGit(tempDir, "add", ".");
      await execGit(tempDir, "commit", "-m", "initial");

      const built = await makeApp([turnDiffRoutes]);
      const project = await built.ctx.repos.projects.create(
        "clean-test",
        tempDir
      );
      const session = await built.ctx.repos.sessions.create(
        project.id,
        "test-model"
      );

      const res = await built.app.handle(
        new Request(`http://localhost/api/sessions/${session.id}/turn-diff`)
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.files).toEqual([]);
      expect(body.diff).toBe("");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("handles a git repo with no HEAD (no commits yet)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "sakti-diff-nocommit-"));
    try {
      // Init repo but don't commit anything
      await execGit(tempDir, "init", "-b", "main");
      writeFileSync(join(tempDir, "file.txt"), "content\n");

      const built = await makeApp([turnDiffRoutes]);
      const project = await built.ctx.repos.projects.create(
        "nocommit-test",
        tempDir
      );
      const session = await built.ctx.repos.sessions.create(
        project.id,
        "test-model"
      );

      const res = await built.app.handle(
        new Request(`http://localhost/api/sessions/${session.id}/turn-diff`)
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.files).toEqual([]);
      expect(body.diff).toBe("");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
