import { Hono } from "hono";
import { getCtx } from "../../context.ts";

export const planSessionRoutes = new Hono()
  .basePath("/projects")
  // Create a new child plan session (always creates; never upserts).
  .post("/:id/plan-session", async (c) => {
    const ctx = getCtx(c);
    const projectId = c.req.param("id");

    const project = ctx.repos.projects.findById(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const created = await ctx.repos.sessions.create(projectId, {
      kind: "plan",
      title: "Plan",
    });
    return c.json(created, 201);
  })
  // List all child plan sessions for a project, newest first.
  .get("/:id/plan-sessions", (c) => {
    const ctx = getCtx(c);
    const projectId = c.req.param("id");

    const project = ctx.repos.projects.findById(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json(ctx.repos.sessions.listChildPlansByProject(projectId));
  });
