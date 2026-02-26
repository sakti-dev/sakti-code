/**
 * Session Data API - Historical message retrieval
 *
 * Provides endpoints for fetching historical messages for a session.
 * Follows Opencode SDK pattern with pagination support.
 *
 * Opencode SDK equivalent: client.session.messages({ sessionID, limit })
 */

import { readFile } from "fs/promises";
import { Hono } from "hono";
import { join } from "path";
import { z } from "zod";
import type { Env } from "../index";
import { getSessionManager } from "../runtime";
import { zValidator } from "../shared/controller/http/validators.js";
import { getSessionMessages } from "../state/session-message-store";
import { normalizeCheckpointMessages } from "./session-data-normalize";

const app = new Hono<Env>();

/**
 * Schema for session.messages request
 * Matches Opencode SDK pattern
 */
const sessionMessagesSchema = z.object({
  limit: z.coerce.number().min(1).max(1000).default(100),
  offset: z.coerce.number().min(0).default(0),
});

const sessionMessagesParamsSchema = z.object({
  sessionId: z.string().min(1),
});

/**
 * Checkpoint data structure
 */
interface Checkpoint {
  sessionId: string;
  phase: string;
  task: string;
  timestamp: number;
  result?: {
    agentId: string;
    type: string;
    status: string;
    messages?: unknown[];
    finalContent?: string;
    iterations?: number;
    duration?: number;
  };
}

/**
 * Get messages for a session
 *
 * Usage:
 * GET /api/chat/:sessionId/messages?limit=100&offset=0
 *
 * Returns:
 * {
 *   sessionID: string,
 *   messages: [{ info, parts, createdAt, updatedAt }],
 *   hasMore: boolean
 * }
 *
 * Opencode SDK equivalent:
 * client.session.messages({ sessionID, limit })
 */
app.get(
  "/api/chat/:sessionId/messages",
  zValidator("param", sessionMessagesParamsSchema),
  zValidator("query", sessionMessagesSchema),
  async c => {
    const { sessionId } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");

    try {
      // Prefer live bus-backed messages (SSE parity with opencode store semantics)
      const liveMessages = getSessionMessages(sessionId);
      if (liveMessages.length > 0) {
        const messages = liveMessages.slice(offset, offset + limit);
        const hasMore = offset + limit < liveMessages.length;
        return c.json({
          sessionID: sessionId,
          messages,
          hasMore,
          total: liveMessages.length,
        });
      }

      // Fallback to checkpoint normalization for older sessions
      // (kept only for compatibility with existing local checkpoint files)
      // Get session manager and controller
      const sessionManager = getSessionManager();
      const controller = await sessionManager.getSession(sessionId);

      if (!controller) {
        return c.json({ error: "Session not found" }, 404);
      }

      // Check if checkpoint exists
      const hasCheckpoint = await controller.hasCheckpoint();
      if (!hasCheckpoint) {
        return c.json({
          sessionID: sessionId,
          messages: [],
          hasMore: false,
        });
      }

      // Read checkpoint file
      const checkpointPath = join("./checkpoints", sessionId, "checkpoint.json");
      const checkpointData = await readFile(checkpointPath, "utf-8");
      const checkpoint = JSON.parse(checkpointData) as Checkpoint;

      // Extract messages from checkpoint
      const rawMessages = checkpoint.result?.messages || [];

      const normalizedMessages = normalizeCheckpointMessages({
        sessionID: sessionId,
        rawMessages,
      });
      const messages = normalizedMessages.slice(offset, offset + limit);

      const hasMore = offset + limit < normalizedMessages.length;

      return c.json({
        sessionID: sessionId,
        messages,
        hasMore,
        total: normalizedMessages.length,
      });
    } catch (error) {
      console.error("Failed to fetch session messages:", error);
      return c.json({ error: "Failed to fetch session messages" }, 500);
    }
  }
);

export default app;
