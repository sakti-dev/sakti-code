import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { setEditModeForSession } from "../../agent/runner.ts";
import { getCtx } from "../../context.ts";

const body = Type.Object({
  mode: Type.Union([Type.Literal("hashline"), Type.Literal("replace")]),
});

export const editModeRoutes = new Hono()
  .basePath("/sessions")
  .get("/:id/edit-mode", (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const row = ctx.repos.settings.get(`session:${id}:edit_mode`);
    return c.json({ mode: row ?? "hashline" });
  })
  .put("/:id/edit-mode", tbValidator("json", body), async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const { mode } = c.req.valid("json");
    const session = await ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }
    const ok = await setEditModeForSession(ctx, id, mode);
    return ok ? c.json({ mode }) : c.json({ error: "Not found" }, 404);
  });
