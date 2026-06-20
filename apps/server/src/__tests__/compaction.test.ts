import { afterAll, beforeAll, describe, expect, it, type mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// pi-ai is globally mocked via apps/server/test-setup.ts.
// The global mock provides default implementations; we import functions
// here so we can override them with mockImplementation/Once per test.
const { getEnvApiKey, completeSimple } = await import("@earendil-works/pi-ai");
const { compactionRoutes } = await import("../routes/compaction.ts");
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

function longConversation(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    role: "user" as const,
    content: `Message ${i}: ${"x".repeat(500)}`,
  }));
}

describe("compaction route", () => {
  it("POST /api/sessions/:id/compact reduces tokens and persists", async () => {
    const { app, ctx } = await makeApp([compactionRoutes]);
    const project = await ctx.repos.projects.create("p", tempDir);
    // Configure model so resolveModel succeeds
    ctx.repos.models.set({
      projectId: project.id,
      provider: "openai",
      modelId: "test-model",
    });
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    // Seed 200 long messages so there is real history to compact
    for (const msg of longConversation(200)) {
      await ctx.repos.messages.append(session.id, msg);
    }
    const beforeCount = ctx.repos.messages.countBySession(session.id);
    expect(beforeCount).toBe(200);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokensBefore).toBeGreaterThan(body.tokensAfter);
    expect(body.tokensAfter).toBeGreaterThan(0);

    // Persisted messages are fewer
    const afterCount = ctx.repos.messages.countBySession(session.id);
    expect(afterCount).toBeLessThan(200);
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
    // No global default, no project config
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

  it("graceful degradation: summary error preserves history", async () => {
    // Override completeSimple to return error stopReason
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
    for (const msg of longConversation(200)) {
      await ctx.repos.messages.append(session.id, msg);
    }
    const beforeCount = ctx.repos.messages.countBySession(session.id);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/compact`, {
        method: "POST",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokensBefore).toBe(body.tokensAfter);
    const afterCount = ctx.repos.messages.countBySession(session.id);
    expect(afterCount).toBe(beforeCount);
  });

  it("returns 500 when no API key configured", async () => {
    // Override getEnvApiKey to return undefined
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
    for (const msg of longConversation(50)) {
      await ctx.repos.messages.append(session.id, msg);
    }

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
