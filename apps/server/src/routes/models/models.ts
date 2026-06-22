import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { getCtx } from "../../context.ts";

export const modelConfigRoutes = new Hono()
  .basePath("/models")
  .get("/config", (c) => c.json(getCtx(c).repos.models.getGlobalDefault()))
  .get("/config/:projectId", (c) =>
    c.json(getCtx(c).repos.models.getForProject(c.req.param("projectId")))
  )
  .post(
    "/config",
    tbValidator(
      "json",
      Type.Object({
        provider: Type.String(),
        modelId: Type.String(),
        thinkingLevel: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
      })
    ),
    (c) => c.json(getCtx(c).repos.models.set(c.req.valid("json")))
  );
