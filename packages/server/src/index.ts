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
import { app } from "./app/app.js";
import "./app/logging-env.js";
import { setRuntimePort } from "./app/runtime-config.js";
import { PermissionAsked, publish, QuestionAsked } from "./bus";
import { getServerToken, getSessionManager } from "./runtime";
import { createChatTaskRunExecutor, TaskRunWorker } from "./services/task-run-worker";
export type { AppType } from "./app/types.js";
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

const logger = createLogger("server");

const SERVER_PORT = parseInt(process.env.PORT || "0") || 0; // Random port
let serverInstance: CloseableServer | null = null;
let taskRunWorker: TaskRunWorker | null = null;

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

  setRuntimePort(port);
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

  if (process.env.SAKTI_CODE_BACKGROUND_RUNS_ENABLED === "true") {
    taskRunWorker = new TaskRunWorker({
      workerId: `worker-${process.pid}`,
      executor: createChatTaskRunExecutor({
        baseUrl: `http://127.0.0.1:${port}`,
        token: getServerToken(),
      }),
    });
    taskRunWorker.start();
    logger.info("Background task run worker started", { module: "server:task-runs" });
  }

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

      if (taskRunWorker) {
        taskRunWorker.stop();
        taskRunWorker = null;
        logger.info("Background task run worker stopped", { module: "server:task-runs" });
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
