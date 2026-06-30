import { describe, expect, it } from "vite-plus/test";
import { makeApp } from "../../../__tests__/helpers.ts";
import { projectsRoutes } from "../../projects/projects.ts";
import { editModeRoutes } from "../edit-mode.ts";
import { sessionsRoutes } from "../sessions.ts";

describe("edit-mode routes", () => {
  it("GET returns default hashline when not set", async () => {
    const { app, ctx } = await makeApp([
      projectsRoutes,
      sessionsRoutes,
      editModeRoutes,
    ]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost:3001/api/sessions/${session.id}/edit-mode`)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("hashline");
  });

  it("PUT persists mode and returns 200", async () => {
    const { app, ctx } = await makeApp([
      projectsRoutes,
      sessionsRoutes,
      editModeRoutes,
    ]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(
        `http://localhost:3001/api/sessions/${session.id}/edit-mode`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "replace" }),
        }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("replace");

    // Verify persisted
    const stored = ctx.repos.settings.get(`session:${session.id}:edit_mode`);
    expect(stored).toBe("replace");
  });

  it("GET returns stored mode after PUT", async () => {
    const { app, ctx } = await makeApp([
      projectsRoutes,
      sessionsRoutes,
      editModeRoutes,
    ]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id);

    await app.request(
      new Request(
        `http://localhost:3001/api/sessions/${session.id}/edit-mode`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "replace" }),
        }
      )
    );

    const res = await app.request(
      new Request(`http://localhost:3001/api/sessions/${session.id}/edit-mode`)
    );
    const body = await res.json();
    expect(body.mode).toBe("replace");
  });

  it("PUT returns 404 for unknown session", async () => {
    const { app } = await makeApp([editModeRoutes]);

    const res = await app.request(
      new Request("http://localhost:3001/api/sessions/nonexistent/edit-mode", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "replace" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("PUT rejects invalid mode", async () => {
    const { app, ctx } = await makeApp([
      projectsRoutes,
      sessionsRoutes,
      editModeRoutes,
    ]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(
        `http://localhost:3001/api/sessions/${session.id}/edit-mode`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "invalid" }),
        }
      )
    );
    expect(res.status).toBe(400);
  });
});
