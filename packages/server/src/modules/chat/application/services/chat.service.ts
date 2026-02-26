import { getModelByReference } from "@sakti-code/core";
import { createLogger } from "@sakti-code/shared/logger";
import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, toolSessions } from "../../../../../db/index.js";
import { updateTaskSessionTitle } from "../../../../../db/task-sessions.js";

const logger = createLogger("server");
const SESSION_TITLE_TOKEN_LIMIT = 24;
const SPEC_TOOL_NAME = "spec";
const SESSION_MODE_KEY = "runtimeMode";

export type RuntimeMode = "intake" | "plan" | "build";

export function isRuntimeMode(value: unknown): value is RuntimeMode {
  return value === "intake" || value === "plan" || value === "build";
}

export async function persistRuntimeMode(sessionId: string, mode: RuntimeMode): Promise<void> {
  const now = new Date();
  const existing = await db
    .select()
    .from(toolSessions)
    .where(
      and(
        eq(toolSessions.session_id, sessionId),
        eq(toolSessions.tool_name, SPEC_TOOL_NAME),
        eq(toolSessions.tool_key, SESSION_MODE_KEY)
      )
    )
    .get();

  if (existing) {
    await db
      .update(toolSessions)
      .set({
        data: { mode },
        last_accessed: now,
      })
      .where(eq(toolSessions.tool_session_id, existing.tool_session_id));
    return;
  }

  await db.insert(toolSessions).values({
    tool_session_id: uuidv7(),
    session_id: sessionId,
    tool_name: SPEC_TOOL_NAME,
    tool_key: SESSION_MODE_KEY,
    data: { mode },
    created_at: now,
    last_accessed: now,
  });
}

function normalizeGeneratedTitle(text: string): string | null {
  const stripped = text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return null;
  return stripped.length > 80 ? stripped.slice(0, 80).trimEnd() : stripped;
}

function deriveFallbackTitle(messageText: string): string {
  const compact = messageText.replace(/\s+/g, " ").trim();
  if (!compact) return "New Chat";
  return compact.length > 60 ? `${compact.slice(0, 60).trimEnd()}...` : compact;
}

export async function maybeAssignAutoSessionTitle(args: {
  sessionId: string;
  modelReference: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<void> {
  const { sessionId, modelReference, userMessage, assistantMessage } = args;

  try {
    const model = getModelByReference(modelReference);
    const titlePrompt = `Generate a short chat title (max 8 words) for this conversation.
Return only the title text, with no quotes or punctuation suffix.

User message:
${userMessage}

Assistant summary:
${assistantMessage}`;

    const { text } = await generateText({
      model,
      temperature: 0.2,
      maxOutputTokens: SESSION_TITLE_TOKEN_LIMIT,
      prompt: titlePrompt,
    });

    const candidate = normalizeGeneratedTitle(text) ?? deriveFallbackTitle(userMessage);
    const updated = await updateTaskSessionTitle(sessionId, candidate, {
      source: "auto",
      onlyIfProvisional: true,
    });

    if (updated) {
      logger.info("Auto-updated session title", {
        module: "chat",
        sessionId,
        title: candidate,
      });
    }
  } catch (error) {
    const fallback = deriveFallbackTitle(userMessage);
    const updated = await updateTaskSessionTitle(sessionId, fallback, {
      source: "auto",
      onlyIfProvisional: true,
    });
    if (updated) {
      logger.warn("Auto-title generation failed, used fallback title", {
        module: "chat",
        sessionId,
      });
      return;
    }
    logger.warn("Auto-title generation skipped", {
      module: "chat",
      sessionId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
