import { Elysia, t } from "elysia";

export const healthRoutes = new Elysia({ name: "routes.health" }).get(
  "/health",
  () => ({ status: "ok" as const, uptime: process.uptime() }),
  {
    response: t.Object({ status: t.Literal("ok"), uptime: t.Number() }),
  }
);
