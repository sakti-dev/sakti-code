import { Hono } from "hono";
import { getCtx } from "../../context.ts";
import { loadAgentContext } from "../../lib/context-loader.ts";

/**
 * Project-scoped agent context (slash commands + `@`-mentionable agents) for the
 * autocomplete. Mirrors the `/projects/:id/files` shape. Skills are delivered
 * through the session/harness resources, not a separate route here.
 */
export const contextRoutes = new Hono()
  .basePath("/projects")
  .get("/:id/commands", async (c) => {
    const ctx = getCtx(c);
    const project = await ctx.repos.projects.findById(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Not found" }, 404);
    }
    const loaded = await loadAgentContext(project.cwd);
    return c.json({ commands: loaded.commands });
  })
  .get("/:id/agents", async (c) => {
    const ctx = getCtx(c);
    const project = await ctx.repos.projects.findById(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Not found" }, 404);
    }
    const loaded = await loadAgentContext(project.cwd);
    return c.json({ agents: loaded.agents });
  });

export type ContextRoutes = typeof contextRoutes;
