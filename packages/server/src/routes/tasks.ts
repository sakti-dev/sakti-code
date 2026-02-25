/**
 * Tasks API Routes
 *
 * GET /api/agent-tasks - List all tasks (with optional filters)
 * GET /api/agent-tasks/:sessionId - Get tasks for a specific session
 */

import { taskStorage } from "@sakti-code/core/memory/task/storage";
import { Hono } from "hono";
import type { Env } from "../index";

const tasksRouter = new Hono<Env>();

/**
 * Get tasks for a specific session
 */
tasksRouter.get("/api/agent-tasks/:sessionId", async c => {
  const sessionId = c.req.param("sessionId");

  const sessionTasks = await taskStorage.listTasksBySession(sessionId);

  return c.json({
    sessionId,
    tasks: sessionTasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      createdAt: t.created_at?.getTime(),
      updatedAt: t.updated_at?.getTime(),
      closedAt: t.closed_at?.getTime(),
      closeReason: t.close_reason,
    })),
    hasMore: false,
    total: sessionTasks.length,
  });
});

/**
 * List all tasks with optional filters
 */
tasksRouter.get("/api/agent-tasks", async c => {
  const status = c.req.query("status") as "open" | "in_progress" | "closed" | undefined;
  const limit = parseInt(c.req.query("limit") || "100");

  const tasks = await taskStorage.listTasks({ status, limit });

  return c.json({
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      sessionId: t.session_id,
      createdAt: t.created_at?.getTime(),
      updatedAt: t.updated_at?.getTime(),
    })),
    hasMore: tasks.length === limit,
    total: tasks.length,
  });
});

export default tasksRouter;
