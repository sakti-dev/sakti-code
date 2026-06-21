import { getModels, getProviders } from "@earendil-works/pi-ai";
import { Elysia } from "elysia";

export const availableModelsRoutes = new Elysia({
  name: "routes.availableModels",
})
  .get("/api/available-models", () => getProviders())
  .get("/api/available-models/:provider", ({ params }) =>
    getModels(params.provider as import("@earendil-works/pi-ai").KnownProvider)
  );
