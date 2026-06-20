import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

export const statsRoutes = new Elysia({ name: "routes.stats" }).get(
  "/api/sessions/:id/stats",
  ({ params, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }
    const messageCount = ctx.repos.messages.countBySession(params.id);
    const costs = ctx.repos.costs.aggregateBySession(params.id);
    return {
      messageCount,
      totalInputTokens: costs?.totalInputTokens ?? 0,
      totalOutputTokens: costs?.totalOutputTokens ?? 0,
      totalCostUsd: costs?.totalCostUsd ?? 0,
      createdAt: session.createdAt,
      durationMs: Date.now() - session.createdAt,
    };
  },
  {
    response: t.Object({
      messageCount: t.Number(),
      totalInputTokens: t.Number(),
      totalOutputTokens: t.Number(),
      totalCostUsd: t.Number(),
      createdAt: t.Number(),
      durationMs: t.Number(),
    }),
  }
);
