import { Hono } from "hono";
import { getCtx } from "../../context.ts";

export const turnsRoutes = new Hono().basePath("/sessions").get("/:id/turns", (c) => {
  const ctx = getCtx(c);
  const turns = ctx.repos.turns.listBySession(c.req.param("id"));
  return c.json(turns);
});
