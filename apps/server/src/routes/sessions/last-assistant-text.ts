import { type AgentMessage, buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia } from "elysia";
import { getCtx } from "../../context.ts";

function extractAssistantText(messages: AgentMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") {
      continue;
    }
    const content = msg.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      return text.length > 0 ? text : null;
    }
    return null;
  }
  return null;
}

export const lastAssistantTextRoutes = new Elysia({
  name: "routes.lastAssistantText",
}).get("/sessions/:id/last-assistant-text", async ({ params, store }) => {
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

  return Response.json({ text: extractAssistantText(messages) });
});
