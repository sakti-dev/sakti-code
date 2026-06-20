import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// pi-ai is globally mocked via apps/server/test-setup.ts.
const { compactionRoutes } = await import("../routes/compaction.ts");
const { statsRoutes } = await import("../routes/stats.ts");
const { makeApp } = await import("./helpers.ts");

let tempDir: string;

describe("route composition", () => {
  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sakti-composition-test-"));
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("compaction and stats routes work together via makeApp", async () => {
    const { app, ctx } = await makeApp([compactionRoutes, statsRoutes]);

    const project = await ctx.repos.projects.create("p", tempDir);
    ctx.repos.models.set({
      projectId: project.id,
      provider: "openai",
      modelId: "test-model",
    });
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    // Stats endpoint works
    const statsRes = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/stats`)
    );
    expect(statsRes.status).toBe(200);

    // Compaction endpoint works when model is configured
    const compactRes = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(compactRes.status).toBe(200);
  });

  it("compaction and stats routes both return 404 for unknown sessions", async () => {
    const { app } = await makeApp([compactionRoutes, statsRoutes]);

    const statsRes = await app.handle(
      new Request("http://localhost/api/sessions/nope/stats")
    );
    expect(statsRes.status).toBe(404);

    const compactRes = await app.handle(
      new Request("http://localhost/api/sessions/nope/compact", {
        method: "POST",
      })
    );
    expect(compactRes.status).toBe(404);
  });
});
