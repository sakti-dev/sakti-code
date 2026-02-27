import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import { buildQuestionUsecases } from "../factory/questions.factory.js";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const logger = createLogger("server");
const { listPendingQuestionsUsecase, rejectQuestionUsecase, replyQuestionUsecase } =
  buildQuestionUsecases();

const replySchema = z.object({
  id: z.string(),
  reply: z.unknown().refine(value => value !== undefined, "reply is required"),
});

const rejectSchema = z.object({
  id: z.string(),
  reason: z.string().optional(),
});

app.get("/pending", c => {
  const pending = listPendingQuestionsUsecase();
  return c.json({ pending });
});

app.post("/reply", zValidator("json", replySchema), async c => {
  const requestId = c.get("requestId");
  try {
    const { id, reply } = c.req.valid("json");
    const sessionId = await replyQuestionUsecase({ id, reply });

    logger.info("Question replied", {
      module: "questions",
      requestId,
      questionId: id,
      sessionId,
    });

    return c.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Question request not found:")) {
      return c.json({ error: error.message }, 404);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Question reply failed", error instanceof Error ? error : undefined, {
      module: "questions",
      requestId,
    });
    return c.json({ error: message }, 400);
  }
});

app.post("/reject", zValidator("json", rejectSchema), async c => {
  const requestId = c.get("requestId");
  try {
    const { id, reason } = c.req.valid("json");
    const sessionId = await rejectQuestionUsecase({ id, reason });

    logger.info("Question rejected", {
      module: "questions",
      requestId,
      questionId: id,
      sessionId,
      reason,
    });

    return c.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Question request not found:")) {
      return c.json({ error: error.message }, 404);
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Question reject failed", error instanceof Error ? error : undefined, {
      module: "questions",
      requestId,
    });
    return c.json({ error: message }, 400);
  }
});

export const questionsRoutes = app;
