import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

export const costsRoutes = new Elysia({ name: "routes.costs" })
  .get(
    "/api/costs/projects/:projectId",
    ({ params, store }) =>
      getCtx(store).repos.costs.aggregateByProject(params.projectId) ?? {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      },
    {
      response: t.Object({
        totalInputTokens: t.Number(),
        totalOutputTokens: t.Number(),
        totalCostUsd: t.Number(),
      }),
    }
  )
  .get(
    "/api/costs/sessions/:sessionId",
    ({ params, store }) =>
      getCtx(store).repos.costs.aggregateBySession(params.sessionId) ?? {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      }
  );
