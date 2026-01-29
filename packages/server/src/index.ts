/**
 * @ekacode/server
 *
 * Hono server with authentication and permission API
 */

import { initializePermissionRules } from "@ekacode/core/server";
import { createLogger } from "@ekacode/shared/logger";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import chatRouter from "./routes/chat";
import eventsRouter from "./routes/events";
import healthRouter from "./routes/health";
import permissionsRouter from "./routes/permissions";
import rulesRouter from "./routes/rules";
import workspaceRouter from "./routes/workspace";

export type Env = {
  Variables: {
    requestId: string;
    startTime: number;
    session?: import("../db/sessions").Session;
    sessionIsNew?: boolean;
    instanceContext?: import("@ekacode/core/server").InstanceContext;
    parsedBody?: { workspace?: string };
  };
};

const app = new Hono<Env>();
const logger = createLogger("server");

// Generated at startup);

const SERVER_TOKEN = randomBytes(16).toString("hex"); // 32 characters
const SERVER_PORT = parseInt(process.env.PORT || "0") || 0; // Random port

// CORS for localhost
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Session-ID, X-Workspace, X-Directory"
  );
  if (c.req.method === "OPTIONS") {
    return c.newResponse(null, 204);
  }
  return next();
});

// Request logging middleware
app.use("*", async (c, next) => {
  const start = Date.now();
  const requestId = uuidv7();

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

// Auth middleware (Basic Auth)
// Uses app.onError() for error handling
app.use("*", authMiddleware);

// Error handler (must be after routes are defined)
app.onError(errorHandler);

// Mount health check route (public - auth middleware skips /api/health)
app.route("/", healthRouter);

// Mount permission routes (protected by auth)
app.route("/api/permissions", permissionsRouter);

// Mount chat routes (protected by auth)
app.route("/api/chat", chatRouter);

// Mount events routes
app.route("/", eventsRouter);

// Mount rules routes
app.route("/", rulesRouter);

// Mount workspace routes
app.route("/", workspaceRouter);

let currentPort = SERVER_PORT;

// Server config endpoint (for renderer - protected by auth)
app.get("/api/config", c => {
  return c.json({
    authType: "basic",
    baseUrl: `http://127.0.0.1:${currentPort}`,
  });
});

// Root endpoint
app.get("/", c => {
  return c.text("ekacode server running");
});

// Start server
export async function startServer() {
  // Initialize permission rules from config
  initializePermissionRules();

  const server = await serve({
    fetch: app.fetch,
    port: SERVER_PORT,
  });

  // Get the actual port from the server's address
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : SERVER_PORT;

  currentPort = port;
  logger.info(`Server started on http://127.0.0.1:${port}`, {
    module: "server:lifecycle",
    port,
  });
  logger.debug(`Server auth: Basic Auth (username: ${process.env.EKACODE_USERNAME || "admin"})`, {
    module: "server:lifecycle",
  });

  return { server, port, token: SERVER_TOKEN };
}

export default app;

// Re-export database-backed sequential thinking tool for production use
export {
  clearSession as clearSessionDb,
  createSequentialThinkingToolDb,
  getSession as getSessionDb,
  sequentialThinkingDb,
} from "../db/sequential-thinking";
