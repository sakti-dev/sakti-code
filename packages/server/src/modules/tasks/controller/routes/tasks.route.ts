/**
 * Tasks API Routes
 *
 * GET /api/agent-tasks - List all tasks (with optional filters)
 * GET /api/agent-tasks/:sessionId - Get tasks for a specific session
 */

import { taskStorage } from "@sakti-code/core/memory/task/storage";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../../index.js";
import { zValidator } from "../../../../shared/controller/http/validators.js";

const tasksRouter = new Hono<Env>();

const tasksBySessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

const tasksQuerySchema = z.object({
  status: z.enum(["open", "in_progress", "closed"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});

/**
 * Get tasks for a specific session
 */
tasksRouter.get(
  "/api/agent-tasks/:sessionId",
  zValidator("param", tasksBySessionParamsSchema),
  async c => {
    const { sessionId } = c.req.valid("param");

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
  }
);

/**
 * List all tasks with optional filters
 */
tasksRouter.get("/api/agent-tasks", zValidator("query", tasksQuerySchema), async c => {
  const { status, limit } = c.req.valid("query");
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
