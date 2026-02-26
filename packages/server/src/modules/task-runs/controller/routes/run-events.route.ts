import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Env } from "../../../../index.js";
import { getTaskRunByIdUsecase } from "../../application/usecases/cancel-task-run.usecase.js";
import { taskRunEventRepository } from "../../infrastructure/repositories/task-run-event.repository.drizzle.js";

const app = new Hono<Env>();

const querySchema = z.object({
  afterEventSeq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

app.get("/api/runs/:runId/events", async c => {
  const runId = c.req.param("runId");
  const parsed = querySchema.safeParse({
    afterEventSeq: c.req.query("afterEventSeq") ?? 0,
    limit: c.req.query("limit") ?? 100,
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid query parameters" }, 400);
  }

  const run = await getTaskRunByIdUsecase(runId);
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  const events = await taskRunEventRepository.listAfter(
    runId,
    parsed.data.afterEventSeq,
    parsed.data.limit
  );

  const lastEventSeq =
    events.length > 0 ? events[events.length - 1].eventSeq : parsed.data.afterEventSeq;

  return c.json({
    runId,
    taskSessionId: run.taskSessionId,
    events,
    lastEventSeq,
    hasMore: events.length >= parsed.data.limit,
  });
});

app.get("/api/runs/:runId/events:sse", async c => {
  const runId = c.req.param("runId");
  const run = await getTaskRunByIdUsecase(runId);
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  const explicitAfter = c.req.query("afterEventSeq");
  const lastEventId = c.req.header("Last-Event-ID");
  const afterEventSeq = explicitAfter ? Number(explicitAfter) : Number(lastEventId ?? "0");
  const safeAfter = Number.isFinite(afterEventSeq) && afterEventSeq >= 0 ? afterEventSeq : 0;

  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");
  c.header("Content-Encoding", "none");

  return streamSSE(c, async stream => {
    let aborted = false;
    stream.onAbort(() => {
      aborted = true;
    });

    let cursor = safeAfter;
    const writeEventsAfterCursor = async (): Promise<number> => {
      const backlog = await taskRunEventRepository.listAfter(runId, cursor, 1000);
      for (const event of backlog) {
        await stream.writeSSE({
          id: String(event.eventSeq),
          data: JSON.stringify(event),
        });
        cursor = event.eventSeq;
      }
      return backlog.length;
    };

    await writeEventsAfterCursor();

    const terminalStates = new Set(["completed", "failed", "canceled", "dead"]);
    while (!aborted) {
      const latestRun = await getTaskRunByIdUsecase(runId);
      const appended = await writeEventsAfterCursor();
      if (!latestRun || (terminalStates.has(latestRun.state) && appended === 0)) {
        break;
      }
      await new Promise<void>(resolve => {
        setTimeout(() => resolve(), 250);
      });
    }

    stream.close();
  });
});

export const runEventsRoutes = app;

export const migrationCheckpoint = {
  task: "Create run-events controller route",
  status: "implemented-minimally",
} as const;
