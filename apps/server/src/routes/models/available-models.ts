import { CATALOG, PROVIDER_INFO, PROVIDERS } from "@sakti-code/llm";
import { Hono } from "hono";
import { getCtx } from "../../context.ts";

export const availableModelsRoutes = new Hono()
  .basePath("/models")
  .get("/available", (c) => {
    const auth = getCtx(c).auth.list();
    const connected = new Set(
      auth.filter((entry) => entry.hasKey).map((entry) => entry.provider)
    );
    return c.json(
      PROVIDERS.map((id) => ({
        id,
        name: PROVIDER_INFO[id]?.name ?? id,
        modelCount: CATALOG[id]?.length ?? 0,
        connected: connected.has(id),
      }))
    );
  });
