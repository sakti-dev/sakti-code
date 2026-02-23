/**
 * Question API routes
 */

import { QuestionManager } from "@sakti-code/core/server";
import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import { z } from "zod";
import { QuestionRejected, QuestionReplied, publish } from "../bus";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const logger = createLogger("server");

const replySchema = z.object({
  id: z.string(),
  reply: z.unknown().refine(value => value !== undefined, "reply is required"),
});

const rejectSchema = z.object({
  id: z.string(),
  reason: z.string().optional(),
});

app.get("/pending", c => {
  const questionMgr = QuestionManager.getInstance();
  const pending = questionMgr.getPendingRequests();
  return c.json({ pending });
});

app.post("/reply", async c => {
  const requestId = c.get("requestId");
  try {
    const body = await c.req.json();
    const { id, reply } = replySchema.parse(body);

    const questionMgr = QuestionManager.getInstance();
    const pending = questionMgr.getPendingRequests().find(request => request.id === id);
    const handled = questionMgr.reply({ id, reply });
    if (!handled || !pending) {
      return c.json({ error: `Question request not found: ${id}` }, 404);
    }

    await publish(QuestionReplied, {
      sessionID: pending.sessionID,
      requestID: id,
      reply,
    });

    logger.info("Question replied", {
      module: "questions",
      requestId,
      questionId: id,
      sessionId: pending.sessionID,
    });

    return c.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Question reply failed", error instanceof Error ? error : undefined, {
      module: "questions",
      requestId,
    });
    return c.json({ error: message }, 400);
  }
});

app.post("/reject", async c => {
  const requestId = c.get("requestId");
  try {
    const body = await c.req.json();
    const { id, reason } = rejectSchema.parse(body);

    const questionMgr = QuestionManager.getInstance();
    const pending = questionMgr.getPendingRequests().find(request => request.id === id);
    const handled = questionMgr.reject({ id, reason });
    if (!handled || !pending) {
      return c.json({ error: `Question request not found: ${id}` }, 404);
    }

    await publish(QuestionRejected, {
      sessionID: pending.sessionID,
      requestID: id,
      reason,
    });

    logger.info("Question rejected", {
      module: "questions",
      requestId,
      questionId: id,
      sessionId: pending.sessionID,
      reason,
    });

    return c.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Question reject failed", error instanceof Error ? error : undefined, {
      module: "questions",
      requestId,
    });
    return c.json({ error: message }, 400);
  }
});

export default app;
