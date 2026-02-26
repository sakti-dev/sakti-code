/**
 * MCP API Routes
 *
 * GET /api/mcp/status - Get MCP server status
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../index";
import { zValidator } from "../shared/controller/http/validators.js";
import { resolveDirectory } from "./_shared/directory-resolver";

const mcpRouter = new Hono<Env>();
const mcpQuerySchema = z.object({
  directory: z.string().optional(),
});

/**
 * Get MCP server status
 */
mcpRouter.get("/api/mcp/status", zValidator("query", mcpQuerySchema), async c => {
  const directory = c.req.valid("query").directory?.trim();

  if (directory === "") {
    return c.json({ error: "Directory parameter required" }, 400);
  }

  const resolution = resolveDirectory(c, { allowFallbackCwd: true });

  if (!resolution.ok) {
    return c.json({ error: resolution.reason }, 400);
  }

  return c.json({
    directory: resolution.directory,
    servers: [],
    summary: {
      total: 0,
      connected: 0,
      degraded: 0,
      offline: 0,
    },
  });
});

export default mcpRouter;
