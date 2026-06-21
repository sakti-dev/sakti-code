import { afterAll, beforeAll, describe, expect, it, type mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteSessionStorage } from "@sakti-code/db";

const { getEnvApiKey, completeSimple } = await import("@earendil-works/pi-ai");
const { compactionRoutes } = await import("../routes/sessions/compaction.ts");
const { makeApp } = await import("./helpers.ts");

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sakti-compaction-test-"));
});

afterAll(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

async function seedEntries(
  db: unknown,
  sessionId: string,
  count: number
): Promise<void> {
  const storage = new SqliteSessionStorage(db as any, sessionId, {
    id: sessionId,
    createdAt: new Date().toISOString(),
  });
  let parentId: string | null = null;
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    await storage.appendEntry({
      id,
      parentId,
      timestamp: new Date().toISOString(),
      type: "message",
      message: {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}: ${"x".repeat(500)}`,
        timestamp: Date.now(),
      } as any,
    });
    parentId = id;
  }
}

describe("compaction route", () => {
  it("POST /api/sessions/:id/compact summarizes and persists", async () => {
    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p", tempDir);
    ctx.repos.models.set({
      projectId: project.id,
      provider: "openai",
      modelId: "test-model",
    });
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    await seedEntries(ctx.db, session.id, 200);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokensBefore).toBeGreaterThan(0);
    expect(typeof body.summary).toBe("string");
    expect(body.summary.length).toBeGreaterThan(0);
  });

  it("POST /api/sessions/nope/compact returns 404", async () => {
    const { app } = await makeApp([compactionRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/compact", {
        method: "POST",
      })
    );
    expect(res.status).toBe(404);
  });

  it("returns 500 when no model configured", async () => {
    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p2", tempDir);
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("model");
  });

  it("returns 500 on summarization error", async () => {
    const mocked = completeSimple as ReturnType<typeof mock>;
    mocked.mockImplementationOnce(async () => ({
      stopReason: "error",
      content: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    }));

    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p3", tempDir);
    ctx.repos.models.set({
      projectId: project.id,
      provider: "openai",
      modelId: "test-model",
    });
    const session = await ctx.repos.sessions.create(project.id, "test-model");
    await seedEntries(ctx.db, session.id, 200);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when no API key configured", async () => {
    const mockedKey = getEnvApiKey as ReturnType<typeof mock>;
    mockedKey.mockImplementationOnce(() => undefined);

    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p4", tempDir);
    ctx.repos.models.set({
      projectId: project.id,
      provider: "openai",
      modelId: "test-model",
    });
    const session = await ctx.repos.sessions.create(project.id, "test-model");
    await seedEntries(ctx.db, session.id, 50);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body.toLowerCase()).toContain("api key");
  });

  it("compactionRoutes is composable via makeApp", async () => {
    const built = await makeApp([compactionRoutes]);
    const res = await built.app.handle(
      new Request("http://localhost/api/sessions/nope/compact", {
        method: "POST",
      })
    );
    expect(res.status).toBe(404);
  });
});
