import { tbValidator } from "@hono/typebox-validator";
import { buildSessionContext } from "@sakti-code/agent";
import { Hono } from "hono";
import Type from "typebox";
import { createSessionStorage, getCtx } from "../../context.ts";
import { resolveModelRef } from "../../lib/profile-resolver.ts";

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
        modelId: Type.Optional(Type.String()),
        title: Type.Optional(Type.String()),
      })
    ),
    async (c) => {
      const ctx = getCtx(c);
      const body = c.req.valid("json");

      let modelId = body.modelId;
      let thinkingLevel: string | undefined;

      if (modelId === undefined) {
        const project = ctx.repos.projects.findById(body.projectId);
        if (!project) {
          return c.json({ error: "Project not found" }, 404);
        }
        const profiles = ctx.profiles.read();
        try {
          const ref = resolveModelRef(profiles, project.profileId, "default");
          modelId = ref.model;
          thinkingLevel = ref.thinkingLevel;
        } catch (e) {
          return c.json(
            {
              error:
                e instanceof Error
                  ? e.message
                  : "No model configured for this project's profile",
            },
            400
          );
        }
      }

      const created = await ctx.repos.sessions.create(body.projectId, modelId, {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      });
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
