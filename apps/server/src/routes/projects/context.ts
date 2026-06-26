import { Hono } from "hono";
import { getCtx } from "../../context.ts";
import { loadAgentContext } from "../../lib/context-loader.ts";

/**
 * Project-scoped agent context for the autocomplete: slash commands, skills,
 * and `@`-mentionable agents in a single fetch (one `loadAgentContext` call).
 * Files stay on `/projects/:id/files` (frecency search, query-essential).
 */
export const contextRoutes = new Hono()
  .basePath("/projects")
  .get("/:id/context", async (c) => {
    const ctx = getCtx(c);
    const project = await ctx.repos.projects.findById(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Not found" }, 404);
    }
    const loaded = await loadAgentContext(project.cwd);
    return c.json({
      commands: loaded.commands,
      skills: loaded.skills,
      agents: loaded.agents,
    });
  });

export type ContextRoutes = typeof contextRoutes;
