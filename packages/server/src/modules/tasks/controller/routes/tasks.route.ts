import { Hono } from "hono";
import type { Env } from "../../../../index.js";
import tasksRouter from "../../../../routes/tasks.js";

const app = new Hono<Env>();

app.route("/", tasksRouter);

export { app as tasksRoutes };
