import type { Hono } from "hono";
import type { Env } from "../index.js";
import { healthRoutes } from "../modules/health/controller/routes/index.js";
import { taskSessionsRoutes } from "../modules/task-sessions/controller/routes/index.js";

export function registerRoutes(app: Hono<Env>): void {
  app.route("/", healthRoutes);
  app.route("/", taskSessionsRoutes);
}

export const migrationCheckpoint = {
  task: "Create route registrar",
  status: "implemented-minimally",
} as const;
