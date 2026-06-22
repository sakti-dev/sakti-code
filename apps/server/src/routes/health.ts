import { Hono } from "hono";

export const healthRoutes = new Hono()
  .basePath("/health")
  .get("/", (c) => c.json({ status: "ok" as const, uptime: process.uptime() }));
