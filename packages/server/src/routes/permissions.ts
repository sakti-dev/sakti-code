/**
 * Permission API routes
 */

import { PermissionManager } from "@sakti-code/core/server";
import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import { z } from "zod";
import { PermissionReplied, publish } from "../bus";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const logger = createLogger("server");

const approvalSchema = z.object({
  id: z.string(),
  approved: z.boolean(),
  patterns: z.array(z.string()).optional(),
});

// Approve a permission request
app.post("/approve", async c => {
  const requestId = c.get("requestId");
  try {
    const body = await c.req.json();
    const { id, approved, patterns } = approvalSchema.parse(body);

    logger.info(`Permission ${approved ? "approved" : "denied"}`, {
      module: "permissions",
      requestId,
      permissionId: id,
      approved,
      patterns,
    });

    const permissionMgr = PermissionManager.getInstance();
    const pending = permissionMgr.getPendingRequests();
    const match = pending.find(request => request.id === id);

    permissionMgr.handleResponse({ id, approved, patterns });

    if (match) {
      await publish(PermissionReplied, {
        sessionID: match.sessionID,
        requestID: id,
        reply: approved ? (patterns && patterns.length > 0 ? "always" : "once") : "reject",
      });
    }

    return c.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Permission approval failed", error instanceof Error ? error : undefined, {
      module: "permissions",
      requestId,
    });
    return c.json({ error: message }, 400);
  }
});

// Get pending requests (for frontend polling)
app.get("/pending", c => {
  const requestId = c.get("requestId");
  const permissionMgr = PermissionManager.getInstance();
  const pending = permissionMgr.getPendingRequests();

  logger.debug("Pending requests fetched", {
    module: "permissions",
    requestId,
    count: pending.length,
  });

  return c.json({ pending });
});

// Clear session approvals
app.post("/session/:sessionID/clear", c => {
  const requestId = c.get("requestId");
  const { sessionID } = c.req.param();

  logger.info("Session approvals cleared", {
    module: "permissions",
    requestId,
    sessionID,
  });

  const permissionMgr = PermissionManager.getInstance();
  permissionMgr.clearSession(sessionID);

  return c.json({ success: true });
});

export default app;
