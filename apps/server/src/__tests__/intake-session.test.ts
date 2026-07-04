import { describe, expect, it } from "vite-plus/test";
import { intakeSessionRoutes } from "../routes/projects/intake-session.ts";
import { projectsRoutes } from "../routes/projects/projects.ts";
import { makeApp, seedProfile } from "./helpers.ts";

describe("POST /api/projects/:id/intake-session", () => {
  it("creates a new child intake every call (always 201, distinct ids)", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, intakeSessionRoutes]);
    seedProfile(ctx, { provider: "anthropic", model: "claude-sonnet-4-5" });
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");

    const first = await app.request(
      new Request(`http://localhost:3001/api/projects/${project.id}/intake-session`, {
        method: "POST",
      }),
    );
    expect(first.status).toBe(201);
    const firstSession = await first.json();
    expect(firstSession.kind).toBe("intake");
    expect(firstSession.projectId).toBe(project.id);
    expect(firstSession.title).toBe("Intake");

    const second = await app.request(
      new Request(`http://localhost:3001/api/projects/${project.id}/intake-session`, {
        method: "POST",
      }),
    );
    expect(second.status).toBe(201);
    const secondSession = await second.json();
    expect(secondSession.id).not.toBe(firstSession.id);
  });

  it("returns 404 when project does not exist", async () => {
    const { app } = await makeApp([projectsRoutes, intakeSessionRoutes]);

    const res = await app.request(
      new Request("http://localhost:3001/api/projects/nonexistent/intake-session", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("creates session with null profileId when no profile is configured", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, intakeSessionRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");

    const res = await app.request(
      new Request(`http://localhost:3001/api/projects/${project.id}/intake-session`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(201);
    const session = await res.json();
    expect(session.kind).toBe("intake");
    expect(session.profileId).toBeNull();
  });
});

describe("GET /api/projects/:id/intake-sessions", () => {
  it("returns all child intakes for a project, newest first", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, intakeSessionRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    await ctx.repos.sessions.create(project.id, { kind: "intake" });
    await ctx.repos.sessions.create(project.id, { kind: "intake" });
    await ctx.repos.sessions.create(project.id, { kind: "mission" });

    const res = await app.request(
      new Request(`http://localhost:3001/api/projects/${project.id}/intake-sessions`, {
        method: "GET",
      }),
    );
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toHaveLength(2);
    expect(list.every((s: { kind: string }) => s.kind === "intake")).toBe(true);
  });

  it("returns 404 when project does not exist", async () => {
    const { app } = await makeApp([projectsRoutes, intakeSessionRoutes]);

    const res = await app.request(
      new Request("http://localhost:3001/api/projects/nonexistent/intake-sessions", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns empty list for a project with no intakes", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, intakeSessionRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");

    const res = await app.request(
      new Request(`http://localhost:3001/api/projects/${project.id}/intake-sessions`, {
        method: "GET",
      }),
    );
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toEqual([]);
  });
});
