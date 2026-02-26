import { publish, TaskSessionUpdated } from "@/bus";
import { Hono } from "hono";
import type { Env } from "../../../../index.js";
import { createTaskSessionUsecase } from "../../application/usecases/create-task-session.usecase.js";
import { listTaskSessionsUsecase } from "../../application/usecases/list-task-sessions.usecase.js";
import {
  deleteTaskSessionUsecase,
  getLatestTaskSessionByWorkspaceUsecase,
  getTaskSessionUsecase,
  updateTaskSessionUsecase,
} from "../../application/usecases/update-task-session.usecase.js";

const VALID_KINDS = new Set(["intake", "task"]);
const VALID_STATUSES = new Set([
  "researching",
  "specifying",
  "implementing",
  "completed",
  "failed",
]);
const VALID_SPEC_TYPES = new Set(["comprehensive", "quick", null]);

const app = new Hono<Env>();

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

app.get("/api/task-sessions", async c => {
  const workspaceId = c.req.query("workspaceId");
  const kindRaw = c.req.query("kind");
  if (kindRaw !== undefined && !VALID_KINDS.has(kindRaw)) {
    return c.json({ error: "Invalid kind. Expected intake | task" }, 400);
  }
  const kind = kindRaw as "intake" | "task" | undefined;

  const sessions = await listTaskSessionsUsecase({
    workspaceId: workspaceId ?? undefined,
    kind: kind ?? "task",
  });

  return c.json({
    taskSessions: sessions.taskSessions.map(serializeTaskSession),
  });
});

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

  const session = await getLatestTaskSessionByWorkspaceUsecase(workspaceId, kind);
  if (!session) {
    return c.json({ error: "No task session found for workspace" }, 404);
  }

  return c.json({ taskSession: serializeTaskSession(session) });
});

app.get("/api/task-sessions/:taskSessionId", async c => {
  const { taskSessionId } = c.req.param();

  const session = await getTaskSessionUsecase(taskSessionId);
  if (!session) {
    return c.json({ error: "Task session not found" }, 404);
  }

  return c.json(serializeTaskSession(session));
});

app.post("/api/task-sessions", async c => {
  const body = await c.req.json();
  const { resourceId, workspaceId, sessionKind } = body;

  if (!resourceId) {
    return c.json({ error: "resourceId is required" }, 400);
  }
  if (sessionKind !== undefined && !VALID_KINDS.has(sessionKind)) {
    return c.json({ error: "Invalid sessionKind. Expected intake | task" }, 400);
  }

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

app.patch("/api/task-sessions/:taskSessionId", async c => {
  const { taskSessionId } = c.req.param();
  const body = await c.req.json();
  const { status, specType, title } = body;

  const updates: Parameters<typeof updateTaskSessionUsecase>[1] = {};

  if (status !== undefined) {
    if (!VALID_STATUSES.has(status)) {
      return c.json(
        {
          error:
            "Invalid status. Expected researching | specifying | implementing | completed | failed",
        },
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
});

app.delete("/api/task-sessions/:taskSessionId", async c => {
  const { taskSessionId } = c.req.param();

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
});

export const taskSessionsRoutes = app;

export const migrationCheckpoint = {
  task: "Create task-session controller route",
  status: "implemented-minimally",
} as const;
