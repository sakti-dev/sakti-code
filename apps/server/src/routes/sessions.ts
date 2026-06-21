import { buildSessionContext } from "@sakti-code/agent";
import { SqliteSessionStorage } from "@sakti-code/db";
import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

const sessionModel = t.Object({
  id: t.String(),
  projectId: t.String(),
  title: t.Union([t.String(), t.Null()]),
  modelId: t.String(),
  thinkingLevel: t.String(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
});

export const sessionsRoutes = new Elysia({ name: "routes.sessions" })
  .model({ session: sessionModel })
  .get(
    "/api/sessions",
    ({ query, store }) =>
      getCtx(store).repos.sessions.listByProject(query.projectId),
    {
      query: t.Object({ projectId: t.String() }),
      response: t.Array(t.Ref("session")),
    }
  )
  .get(
    "/api/sessions/:id",
    ({ params, store }) => {
      const s = getCtx(store).repos.sessions.findById(params.id);
      if (!s) {
        return new Response("Not found", { status: 404 });
      }
      return s;
    },
    { response: t.Ref("session") }
  )
  .post(
    "/api/sessions",
    ({ body, store }) =>
      getCtx(store).repos.sessions.create(body.projectId, body.modelId, {
        ...(body.title === undefined ? {} : { title: body.title }),
      }),
    {
      body: t.Object({
        projectId: t.String(),
        modelId: t.String(),
        title: t.Optional(t.String()),
      }),
      response: t.Ref("session"),
    }
  )
  .patch(
    "/api/sessions/:id",
    ({ params, body, store }) =>
      getCtx(store).repos.sessions.update(params.id, body),
    {
      body: t.Partial(
        t.Object({
          title: t.Union([t.String(), t.Null()]),
          modelId: t.String(),
          thinkingLevel: t.String(),
        })
      ),
      response: t.Ref("session"),
    }
  )
  .get("/api/sessions/:id/messages", async ({ params, store }) => {
    const ctx = getCtx(store);
    const storage = new SqliteSessionStorage(ctx.db, params.id, {
      id: params.id,
      createdAt: new Date().toISOString(),
    });
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages } = buildSessionContext(entries);
    return messages;
  });
