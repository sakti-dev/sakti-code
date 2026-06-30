import { describe, expect, it } from "vite-plus/test";
import { loadDisabledSkills } from "../agent/runner.ts";
import { makeApp } from "./helpers.ts";

const { skillsRoutes } = await import("../routes/sessions/skills.ts");

describe("skills routes", () => {
  it("POST /skills/:name/disable writes DB entry (Layer 1)", async () => {
    const { app, ctx } = await makeApp([skillsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/test");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/skills/graphify/disable`, {
        method: "POST",
      }),
    );

    expect(res.status).toBe(204);
    const disabled = loadDisabledSkills(ctx, session.id);
    expect(disabled.has("graphify")).toBe(true);
  });

  it("POST /skills/:name/disable is idempotent", async () => {
    const { app, ctx } = await makeApp([skillsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/test");
    const session = await ctx.repos.sessions.create(project.id);

    // First disable
    await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/skills/foo/disable`, {
        method: "POST",
      }),
    );
    // Second disable — should not error
    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/skills/foo/disable`, {
        method: "POST",
      }),
    );

    expect(res.status).toBe(204);
    const disabled = loadDisabledSkills(ctx, session.id);
    expect(disabled.has("foo")).toBe(true);
  });

  it("DELETE /skills/:name/disable removes DB entry", async () => {
    const { app, ctx } = await makeApp([skillsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/test");
    const session = await ctx.repos.sessions.create(project.id);
    await ctx.repos.settings.set(`session:${session.id}:disabled_skill:graphify`, "1");

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/skills/graphify/disable`, {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(204);
    const disabled = loadDisabledSkills(ctx, session.id);
    expect(disabled.has("graphify")).toBe(false);
  });

  it("DELETE /skills/:name/disable is idempotent (no entry)", async () => {
    const { app, ctx } = await makeApp([skillsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/test");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/skills/never-disabled/disable`, {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(204);
  });

  it("POST /skills (announce) does not write DB — disk is source of truth", async () => {
    const { app, ctx } = await makeApp([skillsRoutes]);
    const project = await ctx.repos.projects.create("p", "/tmp/test");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost/api/sessions/${session.id}/skills`, {
        method: "POST",
        body: JSON.stringify({
          name: "brand-new",
          description: "just installed",
          filePath: "/skills/brand-new/SKILL.md",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(res.status).toBe(204);
    const disabled = loadDisabledSkills(ctx, session.id);
    expect(disabled.size).toBe(0);
  });

  it("POST /skills/:name/disable returns 404 for unknown session", async () => {
    const { app } = await makeApp([skillsRoutes]);

    const res = await app.request(
      new Request("http://localhost/api/sessions/nonexistent/skills/foo/disable", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(404);
  });
});
