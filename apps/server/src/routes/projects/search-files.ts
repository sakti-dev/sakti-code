import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { getCtx } from "../../context.ts";
import { searchProjectFiles } from "../../lib/file-search.ts";

export const searchFilesRoutes = new Hono().basePath("/projects").get(
  "/:id/files",
  tbValidator(
    "query",
    Type.Object({
      query: Type.Optional(Type.String()),
      limit: Type.Optional(Type.String()),
    }),
  ),
  async (c) => {
    const ctx = getCtx(c);
    const project = ctx.repos.projects.findById(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Not found" }, 404);
    }

    const q = c.req.query("query") ?? null;
    const rawLimit = c.req.query("limit");
    const parsedLimit = rawLimit === undefined ? undefined : Number(rawLimit);
    const maxResults = Math.min(
      parsedLimit === undefined || !Number.isFinite(parsedLimit) ? 20 : parsedLimit,
      100,
    );

    const files = await searchProjectFiles(project.cwd, q, maxResults);

    return c.json({ files, cwd: project.cwd });
  },
);
