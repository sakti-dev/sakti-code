import { Hono } from "hono";
import type { Env } from "../../../../index.js";
import { buildHealthUsecases } from "../factory/health.factory.js";

const app = new Hono<Env>();
const { getHealthUsecase } = buildHealthUsecases();

app.get("/api/health", c => {
  return c.json(getHealthUsecase());
});

export const healthRoutes = app;
