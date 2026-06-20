import { describe, expect, it } from "bun:test";
import { projectsRoutes } from "../routes/projects.ts";
import { sessionsRoutes } from "../routes/sessions.ts";
import { makeApp } from "./helpers.ts";

describe("sessions routes", () => {
  it("creates a session under a project and lists it", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, sessionsRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");

    const created = await app.handle(
      new Request("http://localhost:3001/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, modelId: "gpt-4o" }),
      })
    );
    expect(created.status).toBe(200);
    const session = await created.json();
    expect(session.projectId).toBe(project.id);
    expect(session.modelId).toBe("gpt-4o");

    const list = await (
      await app.handle(
        new Request(
          `http://localhost:3001/api/sessions?projectId=${project.id}`
        )
      )
    ).json();
    expect(list).toHaveLength(1);
  });

  it("GET /api/sessions/:id/messages returns history (empty initially)", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, sessionsRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id, "gpt-4o");

    const res = await app.handle(
      new Request(`http://localhost:3001/api/sessions/${session.id}/messages`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
