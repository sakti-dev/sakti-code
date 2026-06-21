import { Elysia, t } from "elysia";
import { getCtx } from "../../context.ts";

const modelConfigModel = t.Object({
  id: t.String(),
  projectId: t.Union([t.String(), t.Null()]),
  provider: t.String(),
  modelId: t.String(),
  thinkingLevel: t.String(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
});

export const modelConfigRoutes = new Elysia({ name: "routes.modelConfigs" })
  .model({ modelConfig: modelConfigModel })
  .get("/api/model-configs/global", ({ store }) =>
    getCtx(store).repos.models.getGlobalDefault()
  )
  .get("/api/model-configs/projects/:projectId", ({ params, store }) =>
    getCtx(store).repos.models.getForProject(params.projectId)
  )
  .post(
    "/api/model-configs",
    ({ body, store }) => getCtx(store).repos.models.set(body),
    {
      body: t.Object({
        provider: t.String(),
        modelId: t.String(),
        thinkingLevel: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
      }),
    }
  );
