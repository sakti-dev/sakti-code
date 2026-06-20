import { describe, expect, it } from "bun:test";
import { statsRoutes } from "../routes/stats.ts";
import { makeApp } from "./helpers.ts";

describe("stats routes", () => {
  it("GET /api/sessions/:id/stats returns counts, costs, duration", async () => {
    const { app, ctx } = await makeApp([statsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp");
    const session = await ctx.repos.sessions.create(project.id, "test-model");
    ctx.repos.messages.append(session.id, {
      role: "user",
      content: "hello",
    });
    await ctx.repos.messages.append(session.id, {
      role: "assistant",
      content: "hi there",
    });

    const res = await app.handle(
      new Request(`http://localhost/api/sessions/${session.id}/stats`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messageCount).toBe(2);
    expect(body.createdAt).toBe(session.createdAt);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.totalInputTokens).toBe(0);
    expect(body.totalOutputTokens).toBe(0);
    expect(body.totalCostUsd).toBe(0);
  });

  it("GET /api/sessions/nope/stats returns 404", async () => {
    const { app } = await makeApp([statsRoutes]);
    const res = await app.handle(
      new Request("http://localhost/api/sessions/nope/stats")
    );
    expect(res.status).toBe(404);
  });

  it("statsRoutes is composable via makeApp", async () => {
    const built = await makeApp([statsRoutes]);
    const res = await built.app.handle(
      new Request("http://localhost/api/sessions/nope/stats")
    );
    expect(res.status).toBe(404);
  });
});
