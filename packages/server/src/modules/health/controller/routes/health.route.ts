import { Hono } from "hono";
import type { Env } from "../../../../index.js";
import type { HealthResponse } from "../../../../types.js";

const app = new Hono<Env>();

function buildHealthResponse(): HealthResponse {
  const uptime = process.uptime();
  const timestamp = new Date().toISOString();

  return {
    status: "ok",
    uptime,
    timestamp,
    version: "0.0.1",
  };
}

app.get("/api/health", c => {
  return c.json(buildHealthResponse());
});

export const healthRoutes = app;
