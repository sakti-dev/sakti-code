import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import { buildPermissionUsecases } from "../factory/permissions.factory.js";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const logger = createLogger("server");
const { approvePermissionUsecase, clearSessionPermissionsUsecase, listPendingPermissionsUsecase } =
  buildPermissionUsecases();

const approvalSchema = z.object({
  id: z.string(),
  approved: z.boolean(),
  patterns: z.array(z.string()).optional(),
});

app.post("/approve", zValidator("json", approvalSchema), async c => {
  const requestId = c.get("requestId");
  try {
    const { id, approved, patterns } = c.req.valid("json");

    logger.info(`Permission ${approved ? "approved" : "denied"}`, {
      module: "permissions",
      requestId,
      permissionId: id,
      approved,
      patterns,
    });

    await approvePermissionUsecase({ id, approved, patterns });

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

app.get("/pending", c => {
  const requestId = c.get("requestId");
  const pending = listPendingPermissionsUsecase();

  logger.debug("Pending requests fetched", {
    module: "permissions",
    requestId,
    count: pending.length,
  });

  return c.json({ pending });
});

const sessionParamSchema = z.object({
  sessionID: z.string().min(1),
});

app.post("/session/:sessionID/clear", zValidator("param", sessionParamSchema), c => {
  const requestId = c.get("requestId");
  const { sessionID } = c.req.valid("param");

  logger.info("Session approvals cleared", {
    module: "permissions",
    requestId,
    sessionID,
  });

  clearSessionPermissionsUsecase(sessionID);

  return c.json({ success: true });
});

export const permissionsRoutes = app;
