import { CATALOG, PROVIDERS } from "@sakti-code/llm";
import { Hono } from "hono";

export const availableModelsRoutes = new Hono()
  .basePath("/models")
  .get("/available", (c) => c.json(PROVIDERS))
  .get("/available/:provider", (c) =>
    c.json(CATALOG[c.req.param("provider")] ?? [])
  );
