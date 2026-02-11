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

import { Instance } from "@ekacode/core/server";
import type { Context, Next } from "hono";
import { v7 as uuidv7 } from "uuid";
import type { Session } from "../../db/sessions";
import { createSession, createSessionWithId, getSession, touchSession } from "../../db/sessions";
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
 * Checks for X-Session-ID header:
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
  const sessionId = c.req.header("X-Session-ID");

  if (!sessionId) {
    // No session ID provided - create new session
    logger.info("No session ID provided, creating new session");
    const session = await createSession("local");

    // Make session available to handlers
    c.set("session", session);
    c.set("sessionIsNew", true);

    // Detect workspace directory from request
    const workspace = await detectWorkspaceFromRequest(c);
    const messageId = uuidv7();

    if (workspace) {
      // Establish Instance context for all downstream operations
      await Instance.provide({
        directory: workspace,
        sessionID: session.sessionId,
        messageID: messageId,
        async fn() {
          // Set instance context in Hono context for reference
          c.set("instanceContext", Instance.context);
          await next();
        },
      });
      return;
    }

    await next();
  } else {
    // Session ID provided - validate format first (Batch 2: Data Integrity)
    if (!isValidSessionId(sessionId)) {
      logger.warn("Invalid session ID format received", { sessionId });
      return c.json(
        {
          error: "Invalid session ID format",
          message: "Session ID must be a valid UUIDv7",
          code: "INVALID_SESSION_ID",
        },
        400
      );
    }

    // Session ID provided - validate and retrieve
    let session = await getSession(sessionId);

    let sessionIsNew = false;
    if (!session) {
      logger.info("Session not found, creating new session with provided ID", { sessionId });
      session = await createSessionWithId("local", sessionId);
      sessionIsNew = true;
    }

    // Update lastAccessed timestamp
    await touchSession(sessionId);

    // Make session available to handlers
    c.set("session", session);
    c.set("sessionIsNew", sessionIsNew);

    // Detect workspace directory from request
    const workspace = await detectWorkspaceFromRequest(c);
    const messageId = uuidv7();

    if (workspace) {
      // Establish Instance context for all downstream operations
      await Instance.provide({
        directory: workspace,
        sessionID: session.sessionId,
        messageID: messageId,
        async fn() {
          // Set instance context in Hono context for reference
          c.set("instanceContext", Instance.context);
          await next();
        },
      });
      return;
    }

    await next();
  }
}

/**
 * Detect workspace directory from request
 *
 * Prefers query string (directory/workspace), then body, then headers.
 * Falls back to current working directory if not specified.
 */
async function detectWorkspaceFromRequest(c: Context<Env>): Promise<string | undefined> {
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

  // Attempt to parse JSON body without consuming the original stream
  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const clone = c.req.raw.clone();
      const parsed = (await clone.json()) as { workspace?: string } | undefined;
      if (parsed && typeof parsed === "object") {
        c.set("parsedBody", parsed);
        if (parsed.workspace) {
          return parsed.workspace;
        }
      }
    } catch {
      // Ignore body parsing failures
    }
  }

  // Try X-Workspace header
  const headerWorkspace = c.req.header("X-Workspace") || c.req.header("X-Directory");
  if (headerWorkspace) {
    return headerWorkspace;
  }

  return undefined;
}

/**
 * Helper to emit data-session in UIMessage stream
 *
 * This would be used in the chat endpoint when streaming responses.
 *
 * @param session - The session to emit
 * @returns A UIMessage part containing the session data
 */
export function createSessionMessage(session: Session): {
  type: "data-session";
  id: "session";
  data: {
    sessionId: string;
    resourceId: string;
    threadId: string;
    createdAt: string;
    lastAccessed: string;
  };
} {
  return {
    type: "data-session",
    id: "session",
    data: {
      sessionId: session.sessionId,
      resourceId: session.resourceId,
      threadId: session.threadId,
      createdAt: session.createdAt.toISOString(),
      lastAccessed: session.lastAccessed.toISOString(),
    },
  };
}
