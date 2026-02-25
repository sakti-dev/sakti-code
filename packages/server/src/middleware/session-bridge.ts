/**
 * Session bridge middleware
 *
 * Handles session generation, validation, and context injection for Hono.
 * Generates UUIDv7 session IDs server-side and persists sessions to the database.
 *
 * Integrates Instance.provide() for automatic context propagation to tools.
 *
 * Updated for Batch 2: Data Integrity - Added session ID validation
 */

import { Instance } from "@sakti-code/core/server";
import type { Context, Next } from "hono";
import { v7 as uuidv7 } from "uuid";
import { createTaskSession, createTaskSessionWithId, getTaskSession, touchTaskSession } from "../../db/task-sessions";
import type { TaskSessionRecord } from "../../db/task-sessions";
import type { Env } from "../index";

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.log(`[session-bridge] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn(`[session-bridge] ${msg}`, meta),
  error: (msg: string, error?: Error, meta?: Record<string, unknown>) =>
    console.error(`[session-bridge] ${msg}`, error, meta),
};

/**
 * UUIDv7 regex pattern for validation
 */
const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates session ID format (must be UUIDv7)
 */
function isValidSessionId(sessionId: string): boolean {
  return UUIDV7_REGEX.test(sessionId);
}

/**
 * Session bridge middleware
 *
 * Checks for X-Task-Session-ID header:
 * - If missing: generates UUIDv7, creates session, makes it available via context
 * - If present: validates session exists, touches lastAccessed, makes it available via context
 *
 * The session is available to request handlers via `c.get("session")`.
 *
 * Establishes Instance.provide() context for automatic workspace propagation to tools.
 *
 * Batch 2: Data Integrity - Added session ID validation
 */
export async function sessionBridge(c: Context<Env>, next: Next): Promise<Response | void> {
  const sessionId = c.req.header("X-Task-Session-ID");
  const legacySessionId = c.req.header("X-Session-ID");

  if (!sessionId && legacySessionId) {
    logger.warn("Legacy X-Session-ID header received without X-Task-Session-ID", {
      legacySessionId,
    });
    return c.json(
      {
        error: "Legacy session header is not supported",
        message: "Use X-Task-Session-ID instead of X-Session-ID",
        code: "LEGACY_SESSION_HEADER_NOT_SUPPORTED",
      },
      400
    );
  }

  if (!sessionId) {
    const workspace = await detectWorkspaceFromRequest(c);
    const runtimeMode = await detectRuntimeModeFromRequest(c);
    const sessionKind = runtimeMode === "intake" ? "intake" : "task";
    const created = await createTaskSession(
      workspace ?? "local",
      undefined,
      sessionKind
    );

    c.set("session", created);
    c.set("sessionIsNew", true);
    c.header("X-Task-Session-ID", created.taskSessionId);

    const messageId = uuidv7();
    if (workspace) {
      await Instance.provide({
        directory: workspace,
        sessionID: created.taskSessionId,
        messageID: messageId,
        async fn() {
          c.set("instanceContext", Instance.context);
          await next();
        },
      });
      return;
    }

    await next();
    return;
  }

  if (!isValidSessionId(sessionId)) {
    logger.warn("Invalid task session ID format received", { sessionId });
    return c.json(
      {
        error: "Invalid task session ID format",
        message: "Task session ID must be a valid UUIDv7",
        code: "INVALID_TASK_SESSION_ID",
      },
      400
    );
  }

  const session = await getTaskSession(sessionId);

  if (!session) {
    const workspace = await detectWorkspaceFromRequest(c);
    const runtimeMode = await detectRuntimeModeFromRequest(c);
    const sessionKind = runtimeMode === "intake" ? "intake" : "task";
    const created = await createTaskSessionWithId(
      workspace ?? "local",
      sessionId,
      undefined,
      sessionKind
    );

    c.set("session", created);
    c.set("sessionIsNew", true);
    c.header("X-Task-Session-ID", created.taskSessionId);

    const messageId = uuidv7();
    if (workspace) {
      await Instance.provide({
        directory: workspace,
        sessionID: created.taskSessionId,
        messageID: messageId,
        async fn() {
          c.set("instanceContext", Instance.context);
          await next();
        },
      });
      return;
    }

    await next();
    return;
  }

  await touchTaskSession(sessionId);

  c.set("session", session);
  c.set("sessionIsNew", false);
  c.header("X-Task-Session-ID", session.taskSessionId);

  const workspace = await detectWorkspaceFromRequest(c);
  const messageId = uuidv7();

  if (workspace) {
    await Instance.provide({
      directory: workspace,
      sessionID: session.taskSessionId,
      messageID: messageId,
      async fn() {
        c.set("instanceContext", Instance.context);
        await next();
      },
    });
    return;
  }

  await next();
}

async function detectRuntimeModeFromRequest(
  c: Context<Env>
): Promise<"intake" | "plan" | "build" | null> {
  await parseJsonBodyIfAvailable(c);
  const cachedBody = c.get("parsedBody") as { runtimeMode?: unknown } | undefined;
  const mode = cachedBody?.runtimeMode;
  if (mode === "intake" || mode === "plan" || mode === "build") {
    return mode;
  }
  return null;
}

/**
 * Detect workspace directory from request
 *
 * Prefers query string (directory/workspace), then body, then headers.
 * Falls back to current working directory if not specified.
 */
async function detectWorkspaceFromRequest(c: Context<Env>): Promise<string | undefined> {
  await parseJsonBodyIfAvailable(c);

  // Try query string (preferred for GET/streaming requests)
  const queryWorkspace = c.req.query("directory") || c.req.query("workspace");
  if (queryWorkspace) {
    return queryWorkspace;
  }

  // Try to get workspace from request body (for chat requests)
  const cachedBody = c.get("parsedBody") as { workspace?: string } | undefined;
  if (cachedBody?.workspace) {
    return cachedBody.workspace;
  }

  // Try X-Workspace header
  const headerWorkspace = c.req.header("X-Workspace") || c.req.header("X-Directory");
  if (headerWorkspace) {
    return headerWorkspace;
  }

  return undefined;
}

async function parseJsonBodyIfAvailable(c: Context<Env>): Promise<void> {
  const existing = c.get("parsedBody") as unknown;
  if (existing && typeof existing === "object") {
    return;
  }

  const contentType = c.req.header("content-type") || "";
  if (!contentType.includes("application/json")) {
    return;
  }

  try {
    const clone = c.req.raw.clone();
    const parsed = (await clone.json()) as Record<string, unknown> | undefined;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      c.set("parsedBody", parsed);
    }
  } catch {
    // Ignore body parsing failures
  }
}

/**
 * Helper to emit data-session in UIMessage stream
 *
 * This would be used in the chat endpoint when streaming responses.
 *
 * @param session - The session to emit
 * @returns A UIMessage part containing the session data
 */
export function createSessionMessage(session: TaskSessionRecord): {
  type: "data-session";
  id: "session";
  data: {
    sessionId: string;
    resourceId: string;
    threadId: string;
    title: string | null;
    createdAt: string;
    lastAccessed: string;
  };
} {
  return {
    type: "data-session",
    id: "session",
    data: {
      sessionId: session.taskSessionId,
      resourceId: session.resourceId,
      threadId: session.threadId,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      lastAccessed: session.lastAccessed.toISOString(),
    },
  };
}
