import { Hono } from "hono";
import { getCtx } from "../../context.ts";
import { resolveModelRef } from "../../lib/profile-resolver.ts";

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

    const profiles = ctx.profiles.read();
    let modelId: string;
    let thinkingLevel: string;
    try {
      const ref = resolveModelRef(profiles, project.profileId, "default");
      modelId = ref.model;
      thinkingLevel = ref.thinkingLevel;
    } catch (e) {
      return c.json(
        {
          error:
            e instanceof Error
              ? e.message
              : "No model configured for this project's profile",
        },
        400
      );
    }

    const created = await ctx.repos.sessions.create(projectId, modelId, {
      kind: "intake",
      title: "Intake",
      thinkingLevel,
    });
    return c.json(created, 201);
  });
