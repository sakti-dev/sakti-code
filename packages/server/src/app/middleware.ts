import { createLogger } from "@sakti-code/shared/logger";
import type { Hono } from "hono";
import { v7 as uuidv7 } from "uuid";
import type { Env } from "../index.js";
import { authMiddleware } from "../middleware/auth.js";
import { cacheMiddleware } from "../middleware/cache.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import "./logging-env.js";

const logger = createLogger("server");

export function composeMiddleware(app: Hono<Env>): void {
  // CORS
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

  // Request logging
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

  // Rate limiting
  app.use("*", rateLimitMiddleware);

  // Cache
  app.use("*", cacheMiddleware);

  // Auth
  app.use("*", authMiddleware);
}
