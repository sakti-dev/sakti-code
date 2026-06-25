import { CATALOG, PROVIDER_INFO, PROVIDERS } from "@sakti-code/llm";
import { Hono } from "hono";

export const availableModelsRoutes = new Hono()
  .basePath("/models")
  .get("/available", (c) =>
    c.json(
      PROVIDERS.map((id) => ({
        id,
        name: PROVIDER_INFO[id]?.name ?? id,
        modelCount: CATALOG[id]?.length ?? 0,
      }))
    )
  );
