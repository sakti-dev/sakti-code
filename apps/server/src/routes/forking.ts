import { buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

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

export const forkingRoutes = new Elysia({ name: "routes.forking" })
  .post(
    "/api/sessions/:id/fork",
    async ({ params, store }) => {
      const ctx = getCtx(store);
      const session = ctx.repos.sessions.findById(params.id);
      if (!session) {
        return new Response("Not found", { status: 404 });
      }

      const forkedTitle = session.title ? `Fork of ${session.title}` : "Fork";

      const newSession = await ctx.repos.sessions.create(
        session.projectId,
        session.modelId,
        {
          title: forkedTitle,
          thinkingLevel: session.thinkingLevel,
          parentSessionId: params.id,
        }
      );

      const forkedStorage = new SqliteSessionStorage(ctx.db, newSession.id, {
        id: newSession.id,
        createdAt: new Date(newSession.createdAt).toISOString(),
      });

      await forkedStorage.forkFrom(params.id);

      return Response.json(newSession);
    },
    {
      body: t.Optional(
        t.Object({
          messageIndex: t.Optional(t.Number()),
        })
      ),
    }
  )
  .get("/api/sessions/:id/fork-messages", async ({ params, store }) => {
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
