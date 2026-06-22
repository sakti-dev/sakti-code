import { describe, expect, it } from "bun:test";
import { statsRoutes } from "../routes/sessions/stats.ts";
import { seedEntries } from "./entry-helpers.ts";
import { makeApp } from "./helpers.ts";

describe("stats routes", () => {
  it("GET /api/sessions/:id/stats derives activeMessageCount and costs from entries", async () => {
    const { app, ctx } = await makeApp([statsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: "hi there",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 10,
          cacheWrite: 5,
          totalTokens: 165,
          cost: {
            input: 0.001,
            output: 0.002,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.003,
          },
        },
      },
    ]);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/stats`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeMessageCount).toBe(2);
    expect(body.createdAt).toBe(session.createdAt);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.totalInputTokens).toBe(100);
    expect(body.totalOutputTokens).toBe(50);
    expect(body.totalCacheReadTokens).toBe(10);
    expect(body.totalCacheWriteTokens).toBe(5);
    expect(body.totalCostUsd).toBeCloseTo(0.003);
  });

  it("returns zeros for session with no entries", async () => {
    const { app, ctx } = await makeApp([statsRoutes]);
    const project = await ctx.repos.projects.create("empty", "/tmp/empty");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/stats`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeMessageCount).toBe(0);
    expect(body.totalInputTokens).toBe(0);
    expect(body.totalOutputTokens).toBe(0);
    expect(body.totalCacheReadTokens).toBe(0);
    expect(body.totalCacheWriteTokens).toBe(0);
    expect(body.totalCostUsd).toBe(0);
  });

  it("accumulates cache tokens across multiple assistant turns", async () => {
    const { app, ctx } = await makeApp([statsRoutes]);
    const project = await ctx.repos.projects.create("multi", "/tmp/multi");
    const session = await ctx.repos.sessions.create(project.id, "test-model");

    await seedEntries(ctx.db, session.id, [
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: "reply 1",
        usage: {
          input: 100,
          output: 50,
          cacheRead: 10,
          cacheWrite: 5,
          totalTokens: 165,
          cost: {
            input: 0.001,
            output: 0.002,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.003,
          },
        },
      },
      { role: "user", content: "second" },
      {
        role: "assistant",
        content: "reply 2",
        usage: {
          input: 200,
          output: 80,
          cacheRead: 30,
          cacheWrite: 10,
          totalTokens: 320,
          cost: {
            input: 0.002,
            output: 0.003,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.005,
          },
        },
      },
    ]);

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/stats`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeMessageCount).toBe(4);
    expect(body.totalInputTokens).toBe(300);
    expect(body.totalOutputTokens).toBe(130);
    expect(body.totalCacheReadTokens).toBe(40);
    expect(body.totalCacheWriteTokens).toBe(15);
    expect(body.totalCostUsd).toBeCloseTo(0.008);
  });

  it("GET /api/sessions/nope/stats returns 404", async () => {
    const { app } = await makeApp([statsRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/stats")
    );
    expect(res.status).toBe(404);
  });
});
