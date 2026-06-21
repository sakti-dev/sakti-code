import { buildSessionContext } from "@sakti-code/agent";
import { Elysia } from "elysia";
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

export const forkingRoutes = new Elysia({
  name: "routes.forking",
  prefix: "/sessions",
})
  .post("/:id/fork", async ({ params, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const baseTitle = session.title?.startsWith("Fork of ")
      ? session.title.slice("Fork of ".length)
      : session.title;
    const forkedTitle = baseTitle ? `Fork of ${baseTitle}` : "Fork";

    const newSession = await ctx.repos.sessions.create(
      session.projectId,
      session.modelId,
      {
        title: forkedTitle,
        thinkingLevel: session.thinkingLevel,
        parentSessionId: params.id,
      }
    );

    const forkedStorage = createSessionStorage(ctx, newSession.id);

    try {
      await forkedStorage.forkFrom(params.id);
    } catch (err) {
      await ctx.repos.sessions.delete(newSession.id);
      throw err;
    }

    return Response.json(newSession);
  })
  .get("/:id/fork-messages", async ({ params, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const storage = createSessionStorage(ctx, params.id);
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

    return Response.json(forkable);
  });
