import { tbValidator } from "@hono/typebox-validator";
import { buildSessionContext } from "@sakti-code/agent";
import { Hono } from "hono";
import Type from "typebox";
import { createSessionStorage, getCtx } from "../../context.ts";

export const sessionsRoutes = new Hono()
  .basePath("/sessions")
  .get("/", (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) {
      return c.json({ error: "Missing projectId" }, 400);
    }
    return c.json(getCtx(c).repos.sessions.listByProject(projectId));
  })
  .get("/:id", (c) => {
    const s = getCtx(c).repos.sessions.findById(c.req.param("id"));
    if (!s) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(s);
  })
  .post(
    "/",
    tbValidator(
      "json",
      Type.Object({
        projectId: Type.String(),
        modelId: Type.String(),
        title: Type.Optional(Type.String()),
      })
    ),
    async (c) => {
      const body = c.req.valid("json");
      const created = await getCtx(c).repos.sessions.create(
        body.projectId,
        body.modelId,
        {
          ...(body.title === undefined ? {} : { title: body.title }),
        }
      );
      return c.json(created);
    }
  )
  .patch(
    "/:id",
    tbValidator(
      "json",
      Type.Partial(
        Type.Object({
          title: Type.Union([Type.String(), Type.Null()]),
          modelId: Type.String(),
          thinkingLevel: Type.String(),
        })
      )
    ),
    async (c) =>
      c.json(
        await getCtx(c).repos.sessions.update(
          c.req.param("id"),
          c.req.valid("json")
        )
      )
  )
  .get("/:id/messages", async (c) => {
    const ctx = getCtx(c);
    const storage = createSessionStorage(ctx, c.req.param("id"));
    const entries = await storage.getPathToRoot(await storage.getLeafId());
    const { messages } = buildSessionContext(entries);
    return c.json(messages);
  });
