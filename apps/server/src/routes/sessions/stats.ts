import type { AgentMessage } from "@sakti-code/agent";
import { buildSessionContextFromEntries } from "@sakti-code/agent";
import { Hono } from "hono";
import { createSessionStorage, getCtx } from "../../context.ts";

function deriveStats(messages: AgentMessage[]): {
  activeMessageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCostUsd: number;
} {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalCostUsd = 0;

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.usage) {
      totalInputTokens += msg.usage.input;
      totalOutputTokens += msg.usage.output;
      totalCacheReadTokens += msg.usage.cacheRead;
      totalCacheWriteTokens += msg.usage.cacheWrite;
      totalCostUsd += msg.usage.cost.total;
    }
  }

  return {
    activeMessageCount: messages.length,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    totalCostUsd,
  };
}

export const statsRoutes = new Hono()
  .basePath("/sessions")
  .get("/:id/stats", async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    const storage = createSessionStorage(ctx, id);
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages } = buildSessionContextFromEntries(entries);
    const stats = deriveStats(messages);

    return c.json({
      ...stats,
      createdAt: session.createdAt,
      durationMs: Date.now() - session.createdAt,
    });
  });
