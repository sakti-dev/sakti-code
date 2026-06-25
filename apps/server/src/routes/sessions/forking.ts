import { buildSessionContext } from "@sakti-code/agent";
import { Hono } from "hono";
import { createSessionStorage, getCtx } from "../../context.ts";

function flattenContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

export const forkingRoutes = new Hono()
  .basePath("/sessions")
  .post("/:id/fork", async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    const baseTitle = session.title?.startsWith("Fork of ")
      ? session.title.slice("Fork of ".length)
      : session.title;
    const forkedTitle = baseTitle ? `Fork of ${baseTitle}` : "Fork";

    const newSession = await ctx.repos.sessions.create(session.projectId, {
      title: forkedTitle,
      parentSessionId: id,
      ...(session.profileId === null ? {} : { profileId: session.profileId }),
      ...(session.modelId === null || session.modelId === undefined
        ? {}
        : { modelId: session.modelId }),
      thinkingLevel: session.thinkingLevel,
      kind: session.kind,
    });

    const forkedStorage = createSessionStorage(ctx, newSession.id);

    try {
      await forkedStorage.forkFrom(id);
      ctx.repos.turns.copyForFork(id, newSession.id);
    } catch (err) {
      await ctx.repos.sessions.delete(newSession.id);
      throw err;
    }

    return c.json(newSession);
  })
  .get("/:id/fork-messages", async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    const storage = createSessionStorage(ctx, id);
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages } = buildSessionContext(entries);

    const forkable = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role,
        textPreview: flattenContent((m as { content: unknown }).content).slice(
          0,
          200
        ),
      }));

    return c.json(forkable);
  });
