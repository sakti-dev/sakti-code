import { describe, expect, it } from "vitest";
import { projectsRoutes } from "../routes/projects/projects.ts";
import { sessionsRoutes } from "../routes/sessions/sessions.ts";
import { makeApp } from "./helpers.ts";

describe("sessions routes", () => {
  it("creates a session under a project and lists it", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, sessionsRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");

    const created = await app.request(
      new Request("http://localhost:3001/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      })
    );
    expect(created.status).toBe(200);
    const session = await created.json();
    expect(session.projectId).toBe(project.id);
    expect(session.profileId).toBeNull();

    const list = await (
      await app.request(
        new Request(
          `http://localhost:3001/api/sessions?projectId=${project.id}`
        )
      )
    ).json();
    expect(list).toHaveLength(1);
  });

  it("PATCH /api/sessions/:id updates profileId", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, sessionsRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo-patch");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost:3001/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: "fast" }),
      })
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.profileId).toBe("fast");
  });

  it("GET /api/sessions/:id/messages returns history (empty initially)", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, sessionsRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost:3001/api/sessions/${session.id}/messages`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
