import { CATALOG, PROVIDER_INFO } from "@sakti-code/llm";
import { Hono } from "hono";
import { getCtx } from "../../context.ts";

export const connectedModelsRoutes = new Hono()
  .basePath("/models")
  .get("/connected", (c) => {
    const auth = getCtx(c).auth.list();

    const connectedProviders = auth.filter((entry) => entry.hasKey);

    const result = connectedProviders
      .map((entry) => {
        const models = CATALOG[entry.provider];
        if (!models || models.length === 0) {
          return null;
        }

        const sorted = [...models].sort((a, b) => {
          const aDeprecated = a.status === "deprecated" ? 1 : 0;
          const bDeprecated = b.status === "deprecated" ? 1 : 0;
          return aDeprecated - bDeprecated;
        });

        return {
          providerId: entry.provider,
          providerName: PROVIDER_INFO[entry.provider]?.name ?? entry.provider,
          models: sorted.map((model) => ({
            id: model.id,
            name: model.name,
            ...(model.status === undefined ? {} : { status: model.status }),
            reasoning: model.reasoning,
          })),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    return c.json(result);
  });
