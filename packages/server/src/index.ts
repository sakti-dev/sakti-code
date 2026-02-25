/**
 * @sakti-code/server
 *
 * Hono server with authentication and permission API
 */

// Load environment variables from .env file in development
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Try to load .env from project root (works in both dev and production)
const envPaths = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env"),
  resolve(process.cwd(), "../../.env"),
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

// Debug: Log if API keys are loaded (only in development)
if (process.env.NODE_ENV !== "production") {
  const hasZai = !!process.env.ZAI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  console.log(`[server] Environment loaded - ZAI: ${hasZai}, OpenAI: ${hasOpenAI}`);
}

import { serve } from "@hono/node-server";
import { ShutdownHandler } from "@sakti-code/core";
import {
  initializePermissionRules,
  PermissionManager,
  QuestionManager,
} from "@sakti-code/core/server";
import { createLogger } from "@sakti-code/shared/logger";
import { shutdown } from "@sakti-code/shared/shutdown";
import { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import { PermissionAsked, publish, QuestionAsked } from "./bus";
import { authMiddleware } from "./middleware/auth";
import { cacheMiddleware } from "./middleware/cache";
import { errorHandler } from "./middleware/error-handler";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import agentRouter from "./routes/agent";
import chatRouter from "./routes/chat";
import commandRouter from "./routes/command";
import diffRouter from "./routes/diff";
import eventRouter from "./routes/event";
import eventsRouter from "./routes/events";
import filesRouter from "./routes/files";
import healthRouter from "./routes/health";
import lspRouter from "./routes/lsp";
import mcpRouter from "./routes/mcp";
import permissionsRouter from "./routes/permissions";
import projectRouter from "./routes/project";
import projectKeypointsRouter from "./routes/project-keypoints";
import providerRouter from "./routes/provider";
import questionsRouter from "./routes/questions";
import rulesRouter from "./routes/rules";
import sessionDataRouter from "./routes/session-data";
import taskSessionsRouter from "./routes/task-sessions";
import tasksRouter from "./routes/tasks";
import vcsRouter from "./routes/vcs";
import workspaceRouter from "./routes/workspace";
import workspacesRouter from "./routes/workspaces";
import { getServerToken, getSessionManager } from "./runtime";
export { getServerToken, getSessionManager } from "./runtime";
export { app };

let permissionBusBound = false;
let questionBusBound = false;

// Generic server type with close method
interface CloseableServer {
  close(cb?: () => void): void;
}

export type Env = {
  Variables: {
    requestId: string;
    startTime: number;
    session?: import("../db/task-sessions").TaskSessionRecord;
    sessionIsNew?: boolean;
    instanceContext?: import("@sakti-code/core/server").InstanceContext;
    parsedBody?: { workspace?: string };
  };
};

const app = new Hono<Env>();

if (process.env.NODE_ENV !== "production") {
  process.env.LOG_FILE_PATH ||= resolve(process.cwd(), "logs/server-dev.log");
  process.env.LOG_FILE_OUTPUT ||= "true";
}

const logger = createLogger("server");

const SERVER_PORT = parseInt(process.env.PORT || "0") || 0; // Random port

// CORS for localhost
app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Task-Session-ID, X-Workspace, X-Directory"
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

// Rate limiting middleware (before auth to avoid wasting resources)
app.use("*", rateLimitMiddleware);

// Cache middleware (after rate limit, before auth)
// Only caches GET requests, skips excluded paths
app.use("*", cacheMiddleware);

// Auth middleware (Basic Auth)
// Uses app.onError() for error handling
app.use("*", authMiddleware);

// Error handler (must be after routes are defined)
app.onError(errorHandler);

// Mount health check route (public - auth middleware skips /api/health)
app.route("/", healthRouter);

// Mount permission routes (protected by auth)
app.route("/api/permissions", permissionsRouter);
app.route("/api/questions", questionsRouter);

// Mount chat routes (protected by auth)
// Note: chatRouter uses full paths like "/api/chat", so mount at "/"
app.route("/", chatRouter);

// Mount unified event SSE endpoint (Opencode-style)
app.route("/", eventRouter);

// Mount events catch-up endpoint (Batch 3: WS5)
app.route("/", eventsRouter);

// Mount rules routes
app.route("/", rulesRouter);

// Mount task sessions routes
app.route("/", taskSessionsRouter);
app.route("/", tasksRouter);

// Mount session data routes (historical messages)
app.route("/", sessionDataRouter);

// Mount workspace routes
app.route("/", workspaceRouter);

// Mount workspaces CRUD API routes
app.route("/", workspacesRouter);

// Mount bootstrap API routes
app.route("/", projectRouter);
app.route("/", projectKeypointsRouter);
app.route("/", providerRouter);
app.route("/", agentRouter);
app.route("/", commandRouter);
app.route("/", mcpRouter);
app.route("/", lspRouter);
app.route("/", vcsRouter);

// Mount diff routes
app.route("/", diffRouter);

// Mount files routes
app.route("/", filesRouter);

let currentPort = SERVER_PORT;
let serverInstance: CloseableServer | null = null;

// Server config endpoint (for renderer - protected by auth)
app.get("/api/config", c => {
  return c.json({
    authType: "basic",
    baseUrl: `http://127.0.0.1:${currentPort}`,
  });
});

// Root endpoint
app.get("/", c => {
  return c.text("sakti-code server running");
});

// Start server
export async function startServer() {
  // Initialize permission rules from config
  initializePermissionRules();

  if (!permissionBusBound) {
    const permissionMgr = PermissionManager.getInstance();
    permissionMgr.on("permission:request", request => {
      publish(PermissionAsked, request).catch(error => {
        logger.error("Failed to publish permission.asked event", error as Error, {
          module: "permissions",
          permissionId: request.id,
          sessionId: request.sessionID,
        });
      });
    });
    permissionBusBound = true;
  }

  if (!questionBusBound) {
    const questionMgr = QuestionManager.getInstance();
    questionMgr.on("question:request", request => {
      publish(QuestionAsked, request).catch(error => {
        logger.error("Failed to publish question.asked event", error as Error, {
          module: "questions",
          requestId: request.id,
          sessionId: request.sessionID,
        });
      });
    });
    questionBusBound = true;
  }

  // Initialize SessionManager
  const sessionManager = getSessionManager();
  await sessionManager.initialize();
  logger.info("SessionManager initialized", { module: "server:lifecycle" });

  // Initialize shutdown handler
  new ShutdownHandler(sessionManager as any); // eslint-disable-line @typescript-eslint/no-explicit-any
  logger.debug("Shutdown handler registered", { module: "server:lifecycle" });

  const server = await serve({
    fetch: app.fetch,
    port: SERVER_PORT,
  });

  // Store server instance for cleanup
  serverInstance = server;

  // Get the actual port from the server's address
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : SERVER_PORT;

  currentPort = port;
  logger.info(`Server started on http://127.0.0.1:${port}`, {
    module: "server:lifecycle",
    port,
  });
  logger.debug(
    `Server auth: Basic Auth (username: ${process.env.SAKTI_CODE_USERNAME || "admin"})`,
    {
      module: "server:lifecycle",
    }
  );

  // Register cleanup with centralized shutdown manager
  shutdown.register(
    "hono-server",
    async () => {
      if (serverInstance) {
        await new Promise<void>(resolve => {
          serverInstance!.close(() => resolve());
        });
        serverInstance = null;
        logger.info("Hono server closed", { module: "server:lifecycle" });
      }
    },
    10
  ); // Very high priority (run first)

  return { server, port, token: getServerToken() };
}

export default app;

// Re-export database-backed sequential thinking tool for production use
export {
  clearSession as clearSessionDb,
  createSequentialThinkingToolDb,
  getSession as getSessionDb,
  sequentialThinkingDb,
} from "../db/sequential-thinking";
