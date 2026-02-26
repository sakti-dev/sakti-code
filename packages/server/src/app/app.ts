import { Hono } from "hono";
import type { Env } from "../index.js";
import { errorHandler } from "../middleware/error-handler.js";
import { composeMiddleware } from "./middleware.js";
import { registerRoutes } from "./register-routes.js";
import { getRuntimeBaseUrl } from "./runtime-config.js";

export const app = new Hono<Env>();

composeMiddleware(app);

registerRoutes(app);

app.onError(errorHandler);

// Server config endpoint (for renderer - protected by auth)
app.get("/api/config", c => {
  return c.json({
    authType: "basic",
    baseUrl: getRuntimeBaseUrl(),
  });
});

// Root endpoint
app.get("/", c => {
  return c.text("sakti-code server running");
});
