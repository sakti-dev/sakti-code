import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchFilesRoutes } from "../routes/search-files.ts";
import { makeApp } from "./helpers.ts";

describe("file search routes", () => {
  let tempDir: string;
  let projectId: string;
  let app: Awaited<ReturnType<typeof makeApp>>["app"];

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "sakti-search-test-"));
    // Create some test files
    writeFileSync(join(tempDir, "hello.ts"), 'console.log("hello");\n');
    writeFileSync(
      join(tempDir, "hello.test.ts"),
      'describe("hello", () => {});\n'
    );
    writeFileSync(join(tempDir, "world.ts"), 'console.log("world");\n');
    writeFileSync(join(tempDir, "helper.ts"), "export const helper = 42;\n");

    const built = await makeApp([searchFilesRoutes]);
    app = built.app;
    projectId = (await built.ctx.repos.projects.create("search-test", tempDir))
      .id;
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("W6: uses ?query= (per spec, not ?q=) and returns {files, cwd} only", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/projects/${projectId}/search-files?query=hello`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Response shape is exactly {files, cwd} — no undocumented projectId.
    expect(Object.keys(body).sort()).toEqual(["cwd", "files"]);
    expect(body.files.length).toBeGreaterThanOrEqual(1);
    expect(
      body.files.some((f: { path: string }) => f.path.includes("hello"))
    ).toBe(true);
  });

  it("unknown project returns 404", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/projects/nope/search-files?query=hello")
    );
    expect(res.status).toBe(404);
  });

  it("returns some files for empty query (general listing)", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/projects/${projectId}/search-files`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Empty query should return a general listing (not empty)
    expect(body.files.length).toBeGreaterThan(0);
  });

  it("respects limit parameter", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/projects/${projectId}/search-files?query=.ts&limit=2`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files.length).toBeLessThanOrEqual(2);
  });
});
