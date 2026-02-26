/**
 * Task Sessions API - Task session listing and management
 *
 * Provides endpoints for listing, creating, updating, and deleting task sessions.
 * Replaces the legacy sessions API with task-session semantics.
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  createTaskSession,
  deleteTaskSession,
  getLatestTaskSessionByWorkspace,
  getTaskSession,
  listTaskSessions,
  updateTaskSession,
} from "../../db/task-sessions";
import { publish, TaskSessionUpdated } from "../bus";
import type { Env } from "../index";
import { zValidator } from "../shared/controller/http/validators.js";

const app = new Hono<Env>();
const taskSessionKindSchema = z.enum(["intake", "task"]);
const taskSessionStatusSchema = z.enum([
  "researching",
  "specifying",
  "implementing",
  "completed",
  "failed",
]);
const taskSpecTypeSchema = z.enum(["comprehensive", "quick"]).nullable();

const listTaskSessionsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  kind: taskSessionKindSchema.optional(),
});

const latestTaskSessionQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  kind: taskSessionKindSchema.optional(),
});

const taskSessionParamsSchema = z.object({
  taskSessionId: z.string().uuid(),
});

const createTaskSessionSchema = z.object({
  resourceId: z.string().min(1),
  workspaceId: z.string().uuid().optional(),
  sessionKind: taskSessionKindSchema.optional().default("task"),
});

const updateTaskSessionSchema = z.object({
  status: taskSessionStatusSchema.optional(),
  specType: taskSpecTypeSchema.optional(),
  title: z.string().optional(),
});

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
app.get("/api/task-sessions", zValidator("query", listTaskSessionsQuerySchema), async c => {
  try {
    const { workspaceId, kind } = c.req.valid("query");

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
app.get("/api/task-sessions/latest", zValidator("query", latestTaskSessionQuerySchema), async c => {
  const { workspaceId, kind } = c.req.valid("query");

  try {
    const session = await getLatestTaskSessionByWorkspace(workspaceId, kind ?? "task");

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
app.get(
  "/api/task-sessions/:taskSessionId",
  zValidator("param", taskSessionParamsSchema),
  async c => {
    const { taskSessionId } = c.req.valid("param");
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
  }
);

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
app.post("/api/task-sessions", zValidator("json", createTaskSessionSchema), async c => {
  try {
    const { resourceId, workspaceId, sessionKind } = c.req.valid("json");

    const session = await createTaskSession(resourceId, workspaceId, sessionKind ?? "task");

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
app.patch(
  "/api/task-sessions/:taskSessionId",
  zValidator("param", taskSessionParamsSchema),
  zValidator("json", updateTaskSessionSchema),
  async c => {
    const { taskSessionId } = c.req.valid("param");
    const updates = c.req.valid("json");

    try {
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
  }
);

/**
 * Delete a task session
 *
 * Usage:
 * DELETE /api/task-sessions/:taskSessionId
 */
app.delete(
  "/api/task-sessions/:taskSessionId",
  zValidator("param", taskSessionParamsSchema),
  async c => {
    const { taskSessionId } = c.req.valid("param");

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
  }
);

export default app;
