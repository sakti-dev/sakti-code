import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { getCtx } from "../../context.ts";
import { extractPromptsFromEntries } from "../../lib/prompt-history.ts";

export const promptHistoryRoutes = new Hono()
  .basePath("/projects")
  .get(
    "/:id/prompt-history",
    tbValidator("query", Type.Object({ limit: Type.Optional(Type.String()) })),
    async (c) => {
      const ctx = getCtx(c);
      const project = ctx.repos.projects.findById(c.req.param("id"));
      if (!project) {
        return c.json({ error: "Not found" }, 404);
      }
      const rawLimit = c.req.query("limit");
      const parsed = rawLimit === undefined ? undefined : Number(rawLimit);
      const limit = Math.min(Math.max(Number.isFinite(parsed) ? parsed! : 50, 1), 100);
      const rows = ctx.repos.sessions.listProjectMessageContents(project.id, limit);
      const prompts = extractPromptsFromEntries(rows);
      return c.json({ prompts });
    },
  );

export type PromptHistoryRoutes = typeof promptHistoryRoutes;
