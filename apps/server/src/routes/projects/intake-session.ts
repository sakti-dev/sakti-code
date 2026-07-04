import { Hono } from "hono";
import { getCtx } from "../../context.ts";

export const intakeSessionRoutes = new Hono()
  .basePath("/projects")
  // Create a new child intake session (always creates; never upserts).
  .post("/:id/intake-session", async (c) => {
    const ctx = getCtx(c);
    const projectId = c.req.param("id");

    const project = ctx.repos.projects.findById(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const created = await ctx.repos.sessions.create(projectId, {
      kind: "intake",
      title: "Intake",
    });
    return c.json(created, 201);
  })
  // List all child intake sessions for a project, newest first.
  .get("/:id/intake-sessions", (c) => {
    const ctx = getCtx(c);
    const projectId = c.req.param("id");

    const project = ctx.repos.projects.findById(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json(ctx.repos.sessions.listChildIntakesByProject(projectId));
  });
