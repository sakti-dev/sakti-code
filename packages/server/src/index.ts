/**
 * @ekacode/server
 *
 * Hono server with authentication and permission API
 */

import { createLogger } from "@ekacode/logger";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { nanoid } from "nanoid";
import permissionsRouter from "./routes/permissions";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const logger = createLogger("server");

// Generated at startup
const SERVER_TOKEN = nanoid(32);
const SERVER_PORT = parseInt(process.env.PORT || "0") || 0; // Random port

// CORS for localhost
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (c.req.method === "OPTIONS") {
    return c.newResponse(null, 204);
  }
  return next();
});

// Request logging middleware
app.use("*", async (c, next) => {
  const start = Date.now();
  const requestId = nanoid(8);

  c.set("requestId", requestId);
  c.set("startTime", start);

  logger.debug(`${c.req.method} ${c.req.url}`, {
    module: "api",
    requestId,
  });

  await next();

  const duration = Date.now() - start;
  logger.info(`${c.req.method} ${c.req.url} ${c.res.status}`, {
    module: "api",
    requestId,
    duration,
    status: c.res.status,
  });
});

// Auth middleware for /api/* routes
app.use("/api/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  const requestId = c.get("requestId");

  if (!auth?.startsWith(`Bearer ${SERVER_TOKEN}`)) {
    logger.warn("Unauthorized access attempt", {
      module: "api:auth",
      requestId,
      authPresent: !!auth,
    });
    return c.json({ error: "Unauthorized" }, 401);
  }

  logger.debug("Request authenticated", { module: "api:auth", requestId });
  return next();
});

// System status (no auth required)
app.get("/system/status", c => {
  return c.json({
    status: "ok",
    version: "0.0.1",
  });
});

// Server config endpoint (for renderer - no auth required)
app.get("/api/config", c => {
  return c.json({
    token: SERVER_TOKEN,
    baseUrl: `http://127.0.0.1:${SERVER_PORT}`,
  });
});

// Mount permission routes
app.route("/api/permissions", permissionsRouter);

// Health check
app.get("/", c => {
  return c.text("ekacode server running");
});

// Start server
export async function startServer() {
  const server = await serve({
    fetch: app.fetch,
    port: SERVER_PORT,
  });

  // Get the actual port from the server's address
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : SERVER_PORT;

  logger.info(`Server started on http://127.0.0.1:${port}`, {
    module: "server:lifecycle",
    port,
  });
  logger.debug(`Server token: ${SERVER_TOKEN}`, {
    module: "server:lifecycle",
  });

  return { server, port, token: SERVER_TOKEN };
}

export default app;
