import { Hono } from "hono";
import type { Env } from "../index.js";
import { registerRoutes } from "./register-routes.js";

export const app = new Hono<Env>();

registerRoutes(app);

export type App = typeof app;

app.get("/__plan_probe__", c => {
  return c.text("ok");
});

export const migrationCheckpoint = {
  task: "Create app composition root",
  status: "implemented-minimally",
} as const;
