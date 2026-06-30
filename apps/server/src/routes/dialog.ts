import { Hono } from "hono";
import { getCtx } from "../context.ts";

export const dialogRoutes = new Hono().basePath("/dialog").get("/folder", async (c) => {
  const ctx = getCtx(c);
  if (!ctx.hooks.onOpenFolderDialog) {
    return c.json({ error: "Native folder dialog not available" }, 501);
  }
  const folderPath = await ctx.hooks.onOpenFolderDialog();
  return c.json({ folderPath });
});
