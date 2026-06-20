import { SqliteSessionStore } from "@sakti-code/db";
import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

export const forkingRoutes = new Elysia({ name: "routes.forking" })
  .post(
    "/api/sessions/:id/fork",
    async ({ params, body, store }) => {
      const ctx = getCtx(store);
      const session = ctx.repos.sessions.findById(params.id);
      if (!session) {
        return new Response("Not found", { status: 404 });
      }

      const sessionStore = new SqliteSessionStore(ctx.db);
      const result = await sessionStore.fork(params.id, body?.messageIndex);

      const newSession = ctx.repos.sessions.findById(result.sessionId);
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
  .get("/api/sessions/:id/fork-messages", ({ params, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const messages = ctx.repos.messages.loadBySession(params.id);
    const forkable = messages
      .map((m, idx) => ({ m, idx }))
      .filter(({ m }) => m.role === "user" || m.role === "assistant")
      .map(({ m, idx }) => ({
        messageIndex: idx,
        role: m.role,
        textPreview: m.content.slice(0, 200),
      }));

    return Response.json(forkable);
  });
