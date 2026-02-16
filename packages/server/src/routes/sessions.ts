/**
 * Sessions API - Session listing and management
 *
 * Provides endpoints for listing and deleting sessions.
 */

import { Hono } from "hono";
import { deleteSession, getAllSessions } from "../../db/sessions";
import type { Env } from "../index";

const app = new Hono<Env>();

/**
 * List all sessions
 *
 * Usage:
 * GET /api/sessions
 *
 * Returns:
 * {
 *   sessions: [
 *     { sessionId, resourceId, threadId, createdAt, lastAccessed }
 *   ]
 * }
 */
app.get("/api/sessions", async c => {
  try {
    const sessions = await getAllSessions();

    // Transform dates to ISO strings for JSON serialization
    const serialized = sessions.map(session => ({
      sessionId: session.sessionId,
      resourceId: session.resourceId,
      threadId: session.threadId,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      lastAccessed: session.lastAccessed.toISOString(),
    }));

    return c.json({ sessions: serialized });
  } catch (error) {
    console.error("Failed to list sessions:", error);
    return c.json({ error: "Failed to list sessions" }, 500);
  }
});

/**
 * Get a specific session
 *
 * Usage:
 * GET /api/sessions/:sessionId
 */
app.get("/api/sessions/:sessionId", async c => {
  const { sessionId } = c.req.param();

  try {
    const sessions = await getAllSessions();
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json({
      sessionId: session.sessionId,
      resourceId: session.resourceId,
      threadId: session.threadId,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      lastAccessed: session.lastAccessed.toISOString(),
    });
  } catch (error) {
    console.error("Failed to get session:", error);
    return c.json({ error: "Failed to get session" }, 500);
  }
});

/**
 * Delete a session
 *
 * Usage:
 * DELETE /api/sessions/:sessionId
 */
app.delete("/api/sessions/:sessionId", async c => {
  const { sessionId } = c.req.param();

  try {
    await deleteSession(sessionId);
    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to delete session:", error);
    return c.json({ error: "Failed to delete session" }, 500);
  }
});

export default app;
