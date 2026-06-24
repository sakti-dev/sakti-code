import { Hono } from "hono";
import { getCtx } from "../../context.ts";

export const intakeSessionRoutes = new Hono()
  .basePath("/projects")
  .post("/:id/intake-session", async (c) => {
    const ctx = getCtx(c);
    const projectId = c.req.param("id");

    const project = ctx.repos.projects.findById(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const existing = ctx.repos.sessions.findIntakeByProject(projectId);
    if (existing) {
      return c.json(existing);
    }

    const created = await ctx.repos.sessions.create(projectId, {
      kind: "intake",
      title: "Intake",
    });
    return c.json(created, 201);
  });
