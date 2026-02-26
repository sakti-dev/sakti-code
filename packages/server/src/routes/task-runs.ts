import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import { z } from "zod";

import { appendTaskRunEvent } from "../../db/task-run-events";
import {
  createTaskSessionRun,
  findTaskSessionRunByClientRequestKey,
  getTaskSessionRunById,
  listTaskSessionRuns,
  requestTaskSessionRunCancel,
  type TaskRunRuntimeMode,
} from "../../db/task-session-runs";
import { getTaskSession } from "../../db/task-sessions";
import type { Env } from "../index";

const app = new Hono<Env>();
const logger = createLogger("server:task-runs");

const createRunBodySchema = z.object({
  runtimeMode: z.enum(["intake", "plan", "build"]),
  input: z.record(z.string(), z.unknown()).optional(),
  clientRequestKey: z.string().min(1).max(256).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  maxAttempts: z.number().int().min(1).max(20).optional(),
});

app.get("/api/task-sessions/:taskSessionId/runs", async c => {
  const taskSessionId = c.req.param("taskSessionId");
  const session = await getTaskSession(taskSessionId);
  if (!session) {
    return c.json({ error: "Task session not found" }, 404);
  }

  const runs = await listTaskSessionRuns(taskSessionId);
  return c.json({ runs });
});

app.get("/api/runs/:runId", async c => {
  const runId = c.req.param("runId");
  const run = await getTaskSessionRunById(runId);
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

  const parsed = createRunBodySchema.safeParse(body);
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

  if (parsed.data.clientRequestKey) {
    const existing = await findTaskSessionRunByClientRequestKey(
      taskSessionId,
      parsed.data.clientRequestKey
    );
    if (existing) {
      return c.json({ run: existing }, 200);
    }
  }

  const active = (await listTaskSessionRuns(taskSessionId)).find(
    run => run.state === "queued" || run.state === "running" || run.state === "cancel_requested"
  );
  if (active) {
    return c.json(
      {
        error: "Active run already exists for task session",
        existingRunId: active.runId,
      },
      409
    );
  }

  const run = await createTaskSessionRun({
    taskSessionId,
    runtimeMode: parsed.data.runtimeMode as TaskRunRuntimeMode,
    clientRequestKey: parsed.data.clientRequestKey,
    input: parsed.data.input,
    metadata: parsed.data.metadata,
    maxAttempts: parsed.data.maxAttempts,
  });

  logger.info("Created task run", {
    taskSessionId,
    runId: run.runId,
    runtimeMode: run.runtimeMode,
    state: run.state,
  });

  await appendTaskRunEvent({
    runId: run.runId,
    taskSessionId: run.taskSessionId,
    eventType: "task-run.updated",
    payload: {
      state: run.state,
      runtimeMode: run.runtimeMode,
    },
    dedupeKey: `queued:${run.runId}`,
  });

  return c.json({ run }, 201);
});

app.post("/api/runs/:runId/cancel", async c => {
  const runId = c.req.param("runId");
  const run = await requestTaskSessionRunCancel(runId);
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  if (run.state === "cancel_requested") {
    await appendTaskRunEvent({
      runId: run.runId,
      taskSessionId: run.taskSessionId,
      eventType: "task-run.updated",
      payload: { state: "cancel_requested" },
      dedupeKey: `cancel_requested:${run.runId}`,
    });
  } else if (run.state === "canceled") {
    await appendTaskRunEvent({
      runId: run.runId,
      taskSessionId: run.taskSessionId,
      eventType: "run.canceled",
      payload: { reason: "cancel_requested" },
      dedupeKey: `canceled:${run.runId}`,
    });
  }

  return c.json({ run });
});

export default app;
