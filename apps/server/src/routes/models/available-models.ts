import { getModels, getProviders } from "@earendil-works/pi-ai";
import { Elysia } from "elysia";

export const availableModelsRoutes = new Elysia({
  name: "routes.availableModels",
  prefix: "/models",
})
  .get("/available", () => getProviders())
  .get("/available/:provider", ({ params }) =>
    getModels(params.provider as import("@earendil-works/pi-ai").KnownProvider)
  );
