import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { listTaskRunEventsAfter } from "../../db/task-run-events";
import { getTaskSessionRunById } from "../../db/task-session-runs";
import type { Env } from "../index";
import { zValidator } from "../shared/controller/http/validators.js";

const app = new Hono<Env>();
const logger = createLogger("server:run-events");

const querySchema = z.object({
  afterEventSeq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const runIdParamSchema = z.object({
  runId: z.string().min(1),
});

const runEventsSseQuerySchema = z.object({
  afterEventSeq: z.coerce.number().int().min(0).optional(),
});

app.get(
  "/api/runs/:runId/events",
  zValidator("param", runIdParamSchema),
  zValidator("query", querySchema),
  async c => {
    const { runId } = c.req.valid("param");
    const parsed = c.req.valid("query");

    const run = await getTaskSessionRunById(runId);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const events = await listTaskRunEventsAfter({
      runId,
      afterEventSeq: parsed.afterEventSeq,
      limit: parsed.limit,
    });

    const lastEventSeq =
      events.length > 0 ? events[events.length - 1].eventSeq : parsed.afterEventSeq;

    return c.json({
      runId,
      taskSessionId: run.taskSessionId,
      events,
      lastEventSeq,
      hasMore: events.length >= parsed.limit,
    });
  }
);

app.get(
  "/api/runs/:runId/events:sse",
  zValidator("param", runIdParamSchema),
  zValidator("query", runEventsSseQuerySchema),
  async c => {
    const { runId } = c.req.valid("param");
    const run = await getTaskSessionRunById(runId);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const explicitAfter = c.req.valid("query").afterEventSeq;
    const lastEventId = c.req.header("Last-Event-ID");
    const afterEventSeq =
      explicitAfter !== undefined ? Number(explicitAfter) : Number(lastEventId ?? "0");
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
        const backlog = await listTaskRunEventsAfter({ runId, afterEventSeq: cursor, limit: 1000 });
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
        const latestRun = await getTaskSessionRunById(runId);
        const appended = await writeEventsAfterCursor();
        if (!latestRun || (terminalStates.has(latestRun.state) && appended === 0)) {
          break;
        }
        await new Promise<void>(resolve => {
          setTimeout(() => resolve(), 250);
        });
      }

      logger.debug("run events SSE replay/tail completed", {
        runId,
        lastEventSeq: cursor,
        startAfterEventSeq: safeAfter,
        aborted,
      });
      stream.close();
    });
  }
);

export default app;
