import { Hono } from "hono";
import type { Env } from "../../../../index.js";
import sessionDataRoutes from "../../../../routes/session-data.js";

const app = new Hono<Env>();

app.route("/", sessionDataRoutes);

export { app as sessionDataRoutes };
