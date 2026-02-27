import { Hono } from "hono";
import { z } from "zod";
import { publish, TaskSessionUpdated } from "../../../../bus";
import type { Env } from "../../../../index.js";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import { buildTaskSessionUsecases } from "../factory/task-sessions.factory.js";
import {
  CreateTaskSessionSchema,
  ListTaskSessionsQuerySchema,
  TaskSessionKindSchema,
  TaskSessionParamsSchema,
  UpdateTaskSessionSchema,
} from "../schemas/task-session.schema.js";

const latestTaskSessionQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  kind: TaskSessionKindSchema.optional(),
});

const app = new Hono<Env>();
const {
  createTaskSessionUsecase,
  listTaskSessionsUsecase,
  getTaskSessionUsecase,
  updateTaskSessionUsecase,
  deleteTaskSessionUsecase,
  getLatestTaskSessionByWorkspaceUsecase,
} = buildTaskSessionUsecases();

function serializeTaskSession(session: Awaited<ReturnType<typeof getTaskSessionUsecase>>) {
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

app.get("/api/task-sessions", zValidator("query", ListTaskSessionsQuerySchema), async c => {
  const { workspaceId, kind } = c.req.valid("query");

  const sessions = await listTaskSessionsUsecase({
    workspaceId: workspaceId ?? undefined,
    kind: kind ?? "task",
  });

  return c.json({
    taskSessions: sessions.taskSessions.map(serializeTaskSession),
  });
});

app.get("/api/task-sessions/latest", zValidator("query", latestTaskSessionQuerySchema), async c => {
  const { workspaceId, kind } = c.req.valid("query");

  const session = await getLatestTaskSessionByWorkspaceUsecase(workspaceId, kind ?? "task");
  if (!session) {
    return c.json({ error: "No task session found for workspace" }, 404);
  }

  return c.json({ taskSession: serializeTaskSession(session) });
});

app.get(
  "/api/task-sessions/:taskSessionId",
  zValidator("param", TaskSessionParamsSchema),
  async c => {
    const { taskSessionId } = c.req.valid("param");

    const session = await getTaskSessionUsecase(taskSessionId);
    if (!session) {
      return c.json({ error: "Task session not found" }, 404);
    }

    return c.json(serializeTaskSession(session));
  }
);

app.post("/api/task-sessions", zValidator("json", CreateTaskSessionSchema), async c => {
  const { resourceId, workspaceId, sessionKind } = c.req.valid("json");

  const result = await createTaskSessionUsecase({
    resourceId,
    workspaceId,
    sessionKind: sessionKind ?? "task",
  });

  await publish(TaskSessionUpdated, {
    taskSessionId: result.taskSession.taskSessionId,
    workspaceId: result.taskSession.workspaceId ?? "",
    status: result.taskSession.status,
    specType: result.taskSession.specType,
    sessionKind: result.taskSession.sessionKind,
    title: result.taskSession.title ?? "",
    lastActivityAt: result.taskSession.lastActivityAt.toISOString(),
    mutation: "created",
  });

  return c.json({ taskSession: serializeTaskSession(result.taskSession) }, 201);
});

app.patch(
  "/api/task-sessions/:taskSessionId",
  zValidator("param", TaskSessionParamsSchema),
  zValidator("json", UpdateTaskSessionSchema),
  async c => {
    const { taskSessionId } = c.req.valid("param");
    const updates = c.req.valid("json");

    const result = await updateTaskSessionUsecase(taskSessionId, updates);

    await publish(TaskSessionUpdated, {
      taskSessionId: result.taskSession.taskSessionId,
      workspaceId: result.taskSession.workspaceId ?? "",
      status: result.taskSession.status,
      specType: result.taskSession.specType,
      sessionKind: result.taskSession.sessionKind,
      title: result.taskSession.title ?? "",
      lastActivityAt: result.taskSession.lastActivityAt.toISOString(),
      mutation: "updated",
    });

    return c.json({ taskSession: serializeTaskSession(result.taskSession) });
  }
);

app.delete(
  "/api/task-sessions/:taskSessionId",
  zValidator("param", TaskSessionParamsSchema),
  async c => {
    const { taskSessionId } = c.req.valid("param");

    const existing = await getTaskSessionUsecase(taskSessionId);
    if (!existing) {
      return c.json({ error: "Task session not found" }, 404);
    }

    await deleteTaskSessionUsecase(taskSessionId);

    await publish(TaskSessionUpdated, {
      taskSessionId: existing.taskSessionId,
      workspaceId: existing.workspaceId ?? "",
      status: existing.status,
      specType: existing.specType,
      sessionKind: existing.sessionKind,
      title: existing.title ?? "",
      lastActivityAt: new Date().toISOString(),
      mutation: "deleted",
    });

    return c.json({ success: true });
  }
);

export const taskSessionsRoutes = app;
