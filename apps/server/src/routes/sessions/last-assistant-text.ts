import { type AgentMessage, buildSessionContextFromEntries } from "@sakti-code/agent";
import { Effect } from "effect";
import { Hono } from "hono";
import { createSessionStorage, getCtx } from "../../context.ts";

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

export const lastAssistantTextRoutes = new Hono()
  .basePath("/sessions")
  .get("/:id/last-assistant-text", async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    const storage = createSessionStorage(ctx, id);
    const leafId = await Effect.runPromise(storage.getLeafId());
    const entries = await Effect.runPromise(storage.getPathToRoot(leafId));
    const { messages } = buildSessionContextFromEntries(entries);

    return c.json({ text: extractAssistantText(messages) });
  });
