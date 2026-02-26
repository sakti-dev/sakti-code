import { Hono } from "hono";
import { getTaskSession } from "../../../../../db/task-sessions.js";
import type { Env } from "../../../../index.js";
import {
  cancelTaskRunUsecase,
  getTaskRunByIdUsecase,
  listTaskRunsBySessionUsecase,
} from "../../application/usecases/cancel-task-run.usecase.js";
import { createTaskRunUsecase } from "../../application/usecases/create-task-run.usecase.js";
import { CreateTaskRunSchema } from "../schemas/task-run.schema.js";

const app = new Hono<Env>();

app.get("/api/task-sessions/:taskSessionId/runs", async c => {
  const taskSessionId = c.req.param("taskSessionId");
  const session = await getTaskSession(taskSessionId);
  if (!session) {
    return c.json({ error: "Task session not found" }, 404);
  }

  const runs = await listTaskRunsBySessionUsecase(taskSessionId);
  return c.json({ runs });
});

app.get("/api/runs/:runId", async c => {
  const runId = c.req.param("runId");
  const run = await getTaskRunByIdUsecase(runId);
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }
  return c.json({ run });
});

app.post("/api/task-sessions/:taskSessionId/runs", async c => {
  const taskSessionId = c.req.param("taskSessionId");
  const session = await getTaskSession(taskSessionId);
  if (!session) {
    return c.json({ error: "Task session not found" }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = CreateTaskRunSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid payload",
        details: parsed.error.issues.map(issue => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400
    );
  }

  try {
    const result = await createTaskRunUsecase({
      taskSessionId,
      runtimeMode: parsed.data.runtimeMode,
      clientRequestKey: parsed.data.clientRequestKey,
      input: parsed.data.input,
      metadata: parsed.data.metadata,
      maxAttempts: parsed.data.maxAttempts,
    });

    return c.json({ run: result.run }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("Active run already exists")) {
      const activeRuns = await listTaskRunsBySessionUsecase(taskSessionId);
      const activeRun = activeRuns.find(
        r => r.state === "queued" || r.state === "running" || r.state === "cancel_requested"
      );
      return c.json(
        {
          error: "Active run already exists for task session",
          existingRunId: activeRun?.runId,
        },
        409
      );
    }
    throw error;
  }
});

app.post("/api/runs/:runId/cancel", async c => {
  const runId = c.req.param("runId");

  try {
    const result = await cancelTaskRunUsecase({ runId });
    return c.json({ run: result.run });
  } catch (error) {
    if (error instanceof Error && error.message === "Run not found") {
      return c.json({ error: "Run not found" }, 404);
    }
    throw error;
  }
});

export const taskRunsRoutes = app;

export const migrationCheckpoint = {
  task: "Create task-runs controller route",
  status: "implemented-minimally",
} as const;
