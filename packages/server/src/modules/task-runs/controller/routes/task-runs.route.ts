import { Hono } from "hono";
import type { Env } from "../../../../index.js";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import { getTaskSessionUsecase } from "../../../task-sessions/application/usecases/update-task-session.usecase.js";
import {
  cancelTaskRunUsecase,
  getTaskRunByIdUsecase,
  listTaskRunsBySessionUsecase,
} from "../../application/usecases/cancel-task-run.usecase.js";
import { createTaskRunUsecase } from "../../application/usecases/create-task-run.usecase.js";
import {
  CreateTaskRunSchema,
  TaskRunParamsSchema,
  TaskSessionTaskRunsParamsSchema,
} from "../schemas/task-run.schema.js";

const app = new Hono<Env>();

app.get(
  "/api/task-sessions/:taskSessionId/runs",
  zValidator("param", TaskSessionTaskRunsParamsSchema),
  async c => {
    const { taskSessionId } = c.req.valid("param");
    const session = await getTaskSessionUsecase(taskSessionId);
    if (!session) {
      return c.json({ error: "Task session not found" }, 404);
    }

    const runs = await listTaskRunsBySessionUsecase(taskSessionId);
    return c.json({ runs });
  }
);

app.get("/api/runs/:runId", zValidator("param", TaskRunParamsSchema), async c => {
  const { runId } = c.req.valid("param");
  const run = await getTaskRunByIdUsecase(runId);
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }
  return c.json({ run });
});

app.post(
  "/api/task-sessions/:taskSessionId/runs",
  zValidator("param", TaskSessionTaskRunsParamsSchema),
  zValidator("json", CreateTaskRunSchema),
  async c => {
    const { taskSessionId } = c.req.valid("param");
    const session = await getTaskSessionUsecase(taskSessionId);
    if (!session) {
      return c.json({ error: "Task session not found" }, 404);
    }

    const parsed = c.req.valid("json");

    try {
      const result = await createTaskRunUsecase({
        taskSessionId,
        runtimeMode: parsed.runtimeMode,
        clientRequestKey: parsed.clientRequestKey,
        input: parsed.input,
        metadata: parsed.metadata,
        maxAttempts: parsed.maxAttempts,
      });

      return c.json({ run: result.run }, result.created ? 201 : 200);
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
  }
);

app.post("/api/runs/:runId/cancel", zValidator("param", TaskRunParamsSchema), async c => {
  const { runId } = c.req.valid("param");

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
