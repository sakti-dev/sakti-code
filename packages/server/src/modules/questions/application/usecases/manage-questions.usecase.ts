import { QuestionManager } from "@sakti-code/core/server";
import { QuestionRejected, QuestionReplied, publish } from "../../../../bus";

export interface ReplyQuestionInput {
  id: string;
  reply: unknown;
}

export interface RejectQuestionInput {
  id: string;
  reason?: string;
}

export function listPendingQuestionsUsecase() {
  const questionManager = QuestionManager.getInstance();
  return questionManager.getPendingRequests();
}

export async function replyQuestionUsecase(input: ReplyQuestionInput): Promise<string> {
  const questionManager = QuestionManager.getInstance();
  const pending = questionManager.getPendingRequests().find(request => request.id === input.id);
  const handled = questionManager.reply({ id: input.id, reply: input.reply });

  if (!handled || !pending) {
    throw new Error(`Question request not found: ${input.id}`);
  }

  await publish(QuestionReplied, {
    sessionID: pending.sessionID,
    requestID: input.id,
    reply: input.reply as Record<string, unknown> | null,
  });

  return pending.sessionID;
}

export async function rejectQuestionUsecase(input: RejectQuestionInput): Promise<string> {
  const questionManager = QuestionManager.getInstance();
  const pending = questionManager.getPendingRequests().find(request => request.id === input.id);
  const handled = questionManager.reject({ id: input.id, reason: input.reason });

  if (!handled || !pending) {
    throw new Error(`Question request not found: ${input.id}`);
  }

  await publish(QuestionRejected, {
    sessionID: pending.sessionID,
    requestID: input.id,
    reason: input.reason,
  });

  return pending.sessionID;
}
