import type { AgentMessage } from "@sakti-code/agent";
import { buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia, t } from "elysia";
import { getCtx } from "../../context.ts";

function deriveStats(messages: AgentMessage[]): {
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
} {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.usage) {
      totalInputTokens += msg.usage.input;
      totalOutputTokens += msg.usage.output;
      totalCostUsd += msg.usage.cost.total;
    }
  }

  return {
    messageCount: messages.length,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
  };
}

export const statsRoutes = new Elysia({ name: "routes.stats" }).get(
  "/api/sessions/:id/stats",
  async ({ params, store }): Promise<Response> => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const storage = new SqliteSessionStorage(ctx.db, params.id, {
      id: params.id,
      createdAt: new Date(session.createdAt).toISOString(),
    });
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages } = buildSessionContext(entries);
    const stats = deriveStats(messages);

    return Response.json({
      ...stats,
      createdAt: session.createdAt,
      durationMs: Date.now() - session.createdAt,
    });
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
