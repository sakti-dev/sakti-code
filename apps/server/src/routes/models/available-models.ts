import { getModels, getProviders } from "@earendil-works/pi-ai";
import { Hono } from "hono";

export const availableModelsRoutes = new Hono()
  .basePath("/models")
  .get("/available", (c) => c.json(getProviders()))
  .get("/available/:provider", (c) =>
    c.json(
      getModels(
        c.req.param("provider") as import("@earendil-works/pi-ai").KnownProvider
      )
    )
  );
