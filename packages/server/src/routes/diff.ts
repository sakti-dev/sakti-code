/**
 * Diff API Routes
 *
 * GET /api/chat/:sessionId/diff - Get file changes for a session
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../index";
import { paginationSchema, zValidator } from "../shared/controller/http/validators.js";

const diffRouter = new Hono<Env>();

const diffParamsSchema = z.object({
  sessionId: z.string().min(1),
});

/**
 * Get file diffs for a session
 */
diffRouter.get(
  "/api/chat/:sessionId/diff",
  zValidator("param", diffParamsSchema),
  zValidator("query", paginationSchema),
  async c => {
    const { sessionId } = c.req.valid("param");

    return c.json({
      sessionID: sessionId,
      diffs: [],
      hasMore: false,
      total: 0,
    });
  }
);

export default diffRouter;
