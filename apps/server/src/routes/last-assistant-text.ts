import { Elysia } from "elysia";
import { getCtx } from "../context.ts";

export const lastAssistantTextRoutes = new Elysia({
  name: "routes.lastAssistantText",
}).get("/api/sessions/:id/last-assistant-text", async ({ params, store }) => {
  const ctx = getCtx(store);
  const session = await ctx.repos.sessions.findById(params.id);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  const messages = ctx.repos.messages.loadBySession(params.id);
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();

  const text = lastAssistant?.content ?? null;
  return Response.json({ text });
});
