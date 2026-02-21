/**
 * Sessions API - Session listing and management
 *
 * Provides endpoints for listing and deleting sessions.
 */

import { Hono } from "hono";
import { deleteSession, getAllSessions, getLatestSessionByWorkspace } from "../../db/sessions";
import type { Env } from "../index";

const app = new Hono<Env>();

function serializeSession(session: Awaited<ReturnType<typeof getAllSessions>>[number]) {
  return {
    sessionId: session.sessionId,
    resourceId: session.resourceId,
    threadId: session.threadId,
    workspaceId: session.workspaceId,
    title: session.title,
    createdAt: session.createdAt.toISOString(),
    lastAccessed: session.lastAccessed.toISOString(),
  };
}

/**
 * List all sessions, optionally filtered by workspace
 *
 * Usage:
 * GET /api/sessions
 * GET /api/sessions?workspaceId=xxx
 *
 * Returns:
 * {
 *   sessions: [
 *     { sessionId, resourceId, threadId, workspaceId, title, createdAt, lastAccessed }
 *   ]
 * }
 */
app.get("/api/sessions", async c => {
  try {
    const workspaceId = c.req.query("workspaceId");
    let sessions = await getAllSessions();

    // Filter by workspace if provided
    if (workspaceId) {
      sessions = sessions.filter(s => s.workspaceId === workspaceId);
    }

    const serialized = sessions.map(serializeSession);

    return c.json({ sessions: serialized });
  } catch (error) {
    console.error("Failed to list sessions:", error);
    return c.json({ error: "Failed to list sessions" }, 500);
  }
});

/**
 * Get latest session for a workspace
 *
 * Usage:
 * GET /api/sessions/latest?workspaceId=xxx
 */
app.get("/api/sessions/latest", async c => {
  const workspaceId = c.req.query("workspaceId");

  if (!workspaceId) {
    return c.json({ error: "workspaceId query parameter required" }, 400);
  }

  try {
    const session = await getLatestSessionByWorkspace(workspaceId);

    if (!session) {
      return c.json({ error: "No session found for workspace" }, 404);
    }

    return c.json({ session: serializeSession(session) });
  } catch (error) {
    console.error("Failed to get latest session:", error);
    return c.json({ error: "Failed to get latest session" }, 500);
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

    return c.json(serializeSession(session));
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
