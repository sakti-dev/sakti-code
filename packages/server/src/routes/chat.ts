/**
 * Chat API - AI chat endpoint with session management
 *
 * Handles chat requests with session bridge integration and UIMessage streaming.
 */

import { createLogger } from "@ekacode/shared/logger";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { v7 as uuidv7 } from "uuid";
import type { Env } from "../index";
import { createSessionMessage, sessionBridge } from "../middleware/session-bridge";

const app = new Hono<Env>();
const logger = createLogger("server");

// Apply session bridge middleware
app.use("*", sessionBridge);

/**
 * Chat endpoint
 *
 * Accepts chat messages and streams AI responses using UIMessage format.
 *
 * Usage:
 * POST /api/chat
 * Headers:
 *   - X-Session-ID: <session-id> (optional, will be created if missing)
 *   - Content-Type: application/json
 * Body:
 *   {
 *     "message": "Hello, AI!",
 *     "stream": true
 *   }
 */
app.post("/api/chat", async c => {
  const requestId = c.get("requestId");
  const session = c.get("session");
  const sessionIsNew = c.get("sessionIsNew") ?? false;

  if (!session) {
    return c.json({ error: "Session not available" }, 500);
  }

  const body = await c.req.json();
  const message = body.message || "";
  const shouldStream = body.stream !== false;

  logger.info("Chat request received", {
    module: "chat",
    requestId,
    sessionId: session.sessionId,
    messageLength: message.length,
  });

  // For now, echo back the message with session info
  // In production, this would invoke the AI agent
  if (shouldStream) {
    c.header("x-vercel-ai-ui-message-stream", "v1");
    return streamSSE(c, async stream => {
      const writePart = async (part: Record<string, unknown>) => {
        await stream.writeSSE({
          data: JSON.stringify(part),
        });
      };

      if (sessionIsNew) {
        await writePart(createSessionMessage(session));
      }

      const messageId = uuidv7();
      await writePart({
        type: "text-delta",
        messageId,
        text: `Echo: You said "${message}"`,
      });

      await writePart({ type: "finish" });
    });
  } else {
    return c.json({
      sessionId: session.sessionId,
      response: `Echo: You said "${message}"`,
    });
  }
});

/**
 * Get session info endpoint
 *
 * Returns the current session information.
 *
 * Usage:
 * GET /api/chat/session
 */
app.get("/api/chat/session", c => {
  const session = c.get("session");

  if (!session) {
    return c.json({ error: "Session not available" }, 500);
  }

  return c.json({
    sessionId: session.sessionId,
    resourceId: session.resourceId,
    threadId: session.threadId,
    createdAt: session.createdAt.toISOString(),
    lastAccessed: session.lastAccessed.toISOString(),
  });
});

export default app;
