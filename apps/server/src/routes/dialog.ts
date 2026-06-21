import { Elysia } from "elysia";
import { getCtx } from "../context.ts";

export const dialogRoutes = new Elysia({
  name: "routes.dialog",
  prefix: "/dialog",
}).get("/folder", async ({ store }) => {
  const ctx = getCtx(store);
  if (!ctx.hooks.onOpenFolderDialog) {
    return new Response(
      JSON.stringify({ error: "Native folder dialog not available" }),
      { status: 501, headers: { "Content-Type": "application/json" } }
    );
  }
  const folderPath = await ctx.hooks.onOpenFolderDialog();
  return { folderPath };
});
