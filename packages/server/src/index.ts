/**
 * @ekacode/server
 *
 * Hono server with authentication and permission API
 */

import { SessionManager, ShutdownHandler } from "@ekacode/core";
import { initializePermissionRules } from "@ekacode/core/server";
import { createLogger } from "@ekacode/shared/logger";
import { shutdown } from "@ekacode/shared/shutdown";
import { serve } from "@hono/node-server";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { db, sessions } from "../db";
import { authMiddleware } from "./middleware/auth";
import { cacheMiddleware } from "./middleware/cache";
import { errorHandler } from "./middleware/error-handler";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import chatRouter from "./routes/chat";
import eventsRouter from "./routes/events";
import healthRouter from "./routes/health";
import permissionsRouter from "./routes/permissions";
import rulesRouter from "./routes/rules";
import sessionsRouter from "./routes/sessions";
import workspaceRouter from "./routes/workspace";

/**
 * Database adapter for SessionManager
 *
 * Adapts Drizzle ORM to the interface expected by SessionManager.
 */
const sessionDbAdapter = {
  insert: (table: string) => ({
    values: async (values: Record<string, unknown>) => {
      if (table === "sessions") {
        await db.insert(sessions).values(values as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    },
  }),
  query: {
    sessions: {
      findMany: async (_opts?: {
        orderBy?: (sessions: unknown, { desc }: { desc: (col: unknown) => unknown }) => unknown[];
      }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = await (db as any)
          .select()
          .from(sessions)
          .orderBy(desc(sessions.last_accessed))
          .all();
        return results;
      },
      findFirst: async (opts: { where: { session_id: string } }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (db as any)
          .select()
          .from(sessions)
          .where(eq(sessions.session_id, opts.where.session_id))
          .limit(1)
          .get();
        return result || undefined;
      },
    },
  },
};

// Global SessionManager instance
let globalSessionManager: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!globalSessionManager) {
    globalSessionManager = new SessionManager(
      sessionDbAdapter as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      "./checkpoints"
    );
  }
  return globalSessionManager;
}

// Generic server type with close method
interface CloseableServer {
  close(cb?: () => void): void;
}

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

// Mount chat routes (protected by auth)
app.route("/api/chat", chatRouter);

// Mount events routes
app.route("/", eventsRouter);

// Mount rules routes
app.route("/", rulesRouter);

// Mount sessions routes
app.route("/", sessionsRouter);

// Mount workspace routes
app.route("/", workspaceRouter);

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
  return c.text("ekacode server running");
});

// Start server
export async function startServer() {
  // Initialize permission rules from config
  initializePermissionRules();

  // Initialize SessionManager
  const sessionManager = getSessionManager();
  await sessionManager.initialize();
  logger.info("SessionManager initialized", { module: "server:lifecycle" });

  // Initialize shutdown handler
  const _shutdownHandler = new ShutdownHandler(sessionManager as any); // eslint-disable-line @typescript-eslint/no-explicit-any
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
  logger.debug(`Server auth: Basic Auth (username: ${process.env.EKACODE_USERNAME || "admin"})`, {
    module: "server:lifecycle",
  });

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
