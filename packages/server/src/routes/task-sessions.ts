/**
 * Task Sessions API - Task session listing and management
 *
 * Provides endpoints for listing, creating, updating, and deleting task sessions.
 * Replaces the legacy sessions API with task-session semantics.
 */

import { Hono } from "hono";
import { publish, TaskSessionUpdated } from "../bus";
import {
  createTaskSession,
  deleteTaskSession,
  getLatestTaskSessionByWorkspace,
  getTaskSession,
  listTaskSessions,
  updateTaskSession,
} from "../../db/task-sessions";
import type { Env } from "../index";

const app = new Hono<Env>();
const VALID_KINDS = new Set(["intake", "task"]);
const VALID_STATUSES = new Set([
  "researching",
  "specifying",
  "implementing",
  "completed",
  "failed",
]);
const VALID_SPEC_TYPES = new Set(["comprehensive", "quick", null]);

function serializeTaskSession(session: Awaited<ReturnType<typeof getTaskSession>>) {
  if (!session) return null;
  return {
    taskSessionId: session.taskSessionId,
    resourceId: session.resourceId,
    threadId: session.threadId,
    workspaceId: session.workspaceId,
    title: session.title,
    status: session.status,
    specType: session.specType,
    sessionKind: session.sessionKind,
    runtimeMode: session.runtimeMode,
    createdAt: session.createdAt.toISOString(),
    lastAccessed: session.lastAccessed.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
  };
}

/**
 * List all task sessions, optionally filtered by workspace and kind
 *
 * Usage:
 * GET /api/task-sessions
 * GET /api/task-sessions?workspaceId=xxx
 * GET /api/task-sessions?workspaceId=xxx&kind=task
 *
 * Returns:
 * {
 *   taskSessions: [
 *     { taskSessionId, resourceId, threadId, workspaceId, title, status, specType, sessionKind, createdAt, lastAccessed, lastActivityAt }
 *   ]
 * }
 */
app.get("/api/task-sessions", async c => {
  try {
    const workspaceId = c.req.query("workspaceId");
    const kindRaw = c.req.query("kind");
    if (kindRaw !== undefined && !VALID_KINDS.has(kindRaw)) {
      return c.json({ error: "Invalid kind. Expected intake | task" }, 400);
    }
    const kind = kindRaw as "intake" | "task" | undefined;

    const sessions = await listTaskSessions({
      workspaceId: workspaceId ?? undefined,
      kind: kind ?? "task",
    });

    const serialized = sessions.map(serializeTaskSession);

    return c.json({ taskSessions: serialized });
  } catch (error) {
    console.error("Failed to list task sessions:", error);
    return c.json({ error: "Failed to list task sessions" }, 500);
  }
});

/**
 * Get latest task session for a workspace
 *
 * Usage:
 * GET /api/task-sessions/latest?workspaceId=xxx
 * GET /api/task-sessions/latest?workspaceId=xxx&kind=task
 */
app.get("/api/task-sessions/latest", async c => {
  const workspaceId = c.req.query("workspaceId");
  const kindRaw = c.req.query("kind");
  if (kindRaw !== undefined && !VALID_KINDS.has(kindRaw)) {
    return c.json({ error: "Invalid kind. Expected intake | task" }, 400);
  }
  const kind = (kindRaw as "intake" | "task" | undefined) ?? "task";

  if (!workspaceId) {
    return c.json({ error: "workspaceId query parameter required" }, 400);
  }

  try {
    const session = await getLatestTaskSessionByWorkspace(workspaceId, kind);

    if (!session) {
      return c.json({ error: "No task session found for workspace" }, 404);
    }

    return c.json({ taskSession: serializeTaskSession(session) });
  } catch (error) {
    console.error("Failed to get latest task session:", error);
    return c.json({ error: "Failed to get latest task session" }, 500);
  }
});

/**
 * Get a specific task session
 *
 * Usage:
 * GET /api/task-sessions/:taskSessionId
 */
app.get("/api/task-sessions/:taskSessionId", async c => {
  const { taskSessionId } = c.req.param();

  try {
    const session = await getTaskSession(taskSessionId);

    if (!session) {
      return c.json({ error: "Task session not found" }, 404);
    }

    return c.json(serializeTaskSession(session));
  } catch (error) {
    console.error("Failed to get task session:", error);
    return c.json({ error: "Failed to get task session" }, 500);
  }
});

/**
 * Create a new task session
 *
 * Usage:
 * POST /api/task-sessions
 * Body: { resourceId: string, workspaceId?: string, sessionKind?: "intake" | "task" }
 *
 * Returns:
 * {
 *   taskSession: { taskSessionId, resourceId, threadId, workspaceId, title, status, specType, sessionKind, createdAt, lastAccessed, lastActivityAt }
 * }
 */
app.post("/api/task-sessions", async c => {
  try {
    const body = await c.req.json();
    const { resourceId, workspaceId, sessionKind } = body;

    if (!resourceId) {
      return c.json({ error: "resourceId is required" }, 400);
    }
    if (sessionKind !== undefined && !VALID_KINDS.has(sessionKind)) {
      return c.json({ error: "Invalid sessionKind. Expected intake | task" }, 400);
    }

    const session = await createTaskSession(
      resourceId,
      workspaceId,
      sessionKind ?? "task"
    );

    await publish(TaskSessionUpdated, {
      taskSessionId: session.taskSessionId,
      workspaceId: session.workspaceId,
      status: session.status,
      specType: session.specType,
      sessionKind: session.sessionKind,
      title: session.title,
      lastActivityAt: session.lastActivityAt.toISOString(),
      mutation: "created",
    });

    return c.json({ taskSession: serializeTaskSession(session) }, 201);
  } catch (error) {
    console.error("Failed to create task session:", error);
    return c.json({ error: "Failed to create task session" }, 500);
  }
});

/**
 * Update a task session
 *
 * Usage:
 * PATCH /api/task-sessions/:taskSessionId
 * Body: { status?: string, specType?: string, title?: string }
 */
app.patch("/api/task-sessions/:taskSessionId", async c => {
  const { taskSessionId } = c.req.param();

  try {
    const body = await c.req.json();
    const { status, specType, title } = body;

    const updates: Partial<{
      status: "researching" | "specifying" | "implementing" | "completed" | "failed";
      specType: "comprehensive" | "quick" | null;
      title: string;
    }> = {};

    if (status !== undefined) {
      if (!VALID_STATUSES.has(status)) {
        return c.json(
          { error: "Invalid status. Expected researching | specifying | implementing | completed | failed" },
          400
        );
      }
      updates.status = status;
    }
    if (specType !== undefined) {
      if (!VALID_SPEC_TYPES.has(specType)) {
        return c.json({ error: "Invalid specType. Expected comprehensive | quick | null" }, 400);
      }
      updates.specType = specType;
    }
    if (title !== undefined) updates.title = title;

    await updateTaskSession(taskSessionId, updates);

    const session = await getTaskSession(taskSessionId);
    if (!session) {
      return c.json({ error: "Task session not found" }, 404);
    }

    await publish(TaskSessionUpdated, {
      taskSessionId: session.taskSessionId,
      workspaceId: session.workspaceId,
      status: session.status,
      specType: session.specType,
      sessionKind: session.sessionKind,
      title: session.title,
      lastActivityAt: session.lastActivityAt.toISOString(),
      mutation: "updated",
    });

    return c.json({ taskSession: serializeTaskSession(session) });
  } catch (error) {
    console.error("Failed to update task session:", error);
    return c.json({ error: "Failed to update task session" }, 500);
  }
});

/**
 * Delete a task session
 *
 * Usage:
 * DELETE /api/task-sessions/:taskSessionId
 */
app.delete("/api/task-sessions/:taskSessionId", async c => {
  const { taskSessionId } = c.req.param();

  try {
    const existing = await getTaskSession(taskSessionId);
    if (!existing) {
      return c.json({ error: "Task session not found" }, 404);
    }

    await deleteTaskSession(taskSessionId);

    await publish(TaskSessionUpdated, {
      taskSessionId: existing.taskSessionId,
      workspaceId: existing.workspaceId,
      status: existing.status,
      specType: existing.specType,
      sessionKind: existing.sessionKind,
      title: existing.title,
      lastActivityAt: new Date().toISOString(),
      mutation: "deleted",
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Failed to delete task session:", error);
    return c.json({ error: "Failed to delete task session" }, 500);
  }
});

export default app;
