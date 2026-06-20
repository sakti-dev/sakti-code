import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

export const namingRoutes = new Elysia({ name: "routes.naming" }).patch(
  "/api/sessions/:id/name",
  async ({ params, body, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const title = body.title || null;
    const updated = await ctx.repos.sessions.update(params.id, { title });
    return Response.json(updated);
  },
  {
    body: t.Object({
      title: t.String(),
    }),
  }
);
