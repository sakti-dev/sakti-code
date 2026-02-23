/**
 * Question tool
 *
 * Allows an agent to ask structured questions and wait for a user answer.
 */

import { tool } from "ai";
import { z } from "zod";
import { Instance } from "../instance";
import {
  QuestionManager,
  QuestionRejectedError,
  type QuestionPrompt,
} from "../session/question-manager";

const questionOptionSchema = z.object({
  label: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
});

const questionPromptSchema = z.object({
  header: z.string().max(30).optional(),
  question: z.string().min(1).max(1000),
  options: z.array(questionOptionSchema).max(12).optional(),
  multiple: z.boolean().optional(),
});

const questionInputSchema = z.object({
  questions: z.array(questionPromptSchema).min(1).max(6),
});

function formatReply(value: unknown): string {
  if (value === undefined || value === null) return "unanswered";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildSummary(questions: QuestionPrompt[], reply: unknown): string {
  if (questions.length === 1) {
    const q = questions[0]?.question ?? "question";
    return `User response for "${q}": ${formatReply(reply)}`;
  }
  return `User answered ${questions.length} questions: ${formatReply(reply)}`;
}

export const questionTool = tool({
  description: `Ask one or more structured clarifying questions to the user and wait for answers.

Use this when requirements are ambiguous, decisions are needed, or trade-offs must be chosen.

Guidelines:
- Prefer 1 concise question at a time unless batching is clearly better
- Prefer multiple-choice options for fast replies
- Put the recommended choice first and suffix label with "(Recommended)"
- Keep header short (<=30 chars)
- Use multiple=true only when multiple selections are valid`,
  inputSchema: questionInputSchema,
  execute: async (params, options) => {
    if (!Instance.inContext) {
      throw new Error("question tool must be run within an Instance.provide() context");
    }

    const manager = QuestionManager.getInstance();

    try {
      const reply = await manager.ask({
        sessionID: Instance.context.sessionID,
        questions: params.questions,
        tool: options?.toolCallId
          ? {
              messageID: Instance.context.messageID,
              callID: options.toolCallId,
            }
          : undefined,
      });

      return {
        title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
        output: buildSummary(params.questions, reply),
        metadata: {
          reply,
          answered: true,
        },
      };
    } catch (error) {
      if (!(error instanceof QuestionRejectedError)) {
        throw error;
      }

      return {
        title: `Question rejected`,
        output: "User declined to answer the question.",
        metadata: {
          rejected: true,
          reason: error.reason,
        },
      };
    }
  },
});
