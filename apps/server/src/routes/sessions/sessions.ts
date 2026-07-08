import { tbValidator } from "@hono/typebox-validator";
import { buildSessionContextFromEntries } from "@sakti-code/agent";
import { Effect } from "effect";
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
        title: Type.Optional(Type.String()),
        kind: Type.Optional(Type.String()),
        parentSessionId: Type.Optional(Type.String()),
        profileId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        changeName: Type.Optional(Type.String()),
        worktreePath: Type.Optional(Type.String()),
      }),
    ),
    async (c) => {
      const ctx = getCtx(c);
      const body = c.req.valid("json");

      const created = await ctx.repos.sessions.create(body.projectId, {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.kind === undefined ? {} : { kind: body.kind }),
        ...(body.parentSessionId === undefined ? {} : { parentSessionId: body.parentSessionId }),
        ...(body.profileId === undefined ? {} : { profileId: body.profileId }),
        ...(body.changeName === undefined ? {} : { changeName: body.changeName }),
        ...(body.worktreePath === undefined ? {} : { worktreePath: body.worktreePath }),
      });
      return c.json(created);
    },
  )
  .patch(
    "/:id",
    tbValidator(
      "json",
      Type.Partial(
        Type.Object({
          title: Type.Union([Type.String(), Type.Null()]),
          profileId: Type.Union([Type.String(), Type.Null()]),
          thinkingLevel: Type.String(),
        }),
      ),
    ),
    async (c) =>
      c.json(await getCtx(c).repos.sessions.update(c.req.param("id"), c.req.valid("json"))),
  )
  .delete("/:id", async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const existing = ctx.repos.sessions.findById(id);
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }
    await ctx.repos.sessions.delete(id);
    return c.json({ ok: true });
  })
  .get("/:id/messages", async (c) => {
    const ctx = getCtx(c);
    const storage = createSessionStorage(ctx, c.req.param("id"));
    const leafId = await Effect.runPromise(storage.getLeafId());
    const entries = await Effect.runPromise(storage.getPathToRoot(leafId));
    const { messages } = buildSessionContextFromEntries(entries);
    return c.json(messages);
  });
