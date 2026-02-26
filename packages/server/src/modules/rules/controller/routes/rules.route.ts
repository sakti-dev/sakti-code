import {
  PermissionManager,
  createDefaultRules,
  formatConfigRules,
  parseConfigRules,
} from "@sakti-code/core/server";
import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../../../../shared/controller/http/validators.js";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const logger = createLogger("server");

const ruleSchema = z.object({
  permission: z.enum(["read", "edit", "bash", "external_directory", "mode_switch"]),
  pattern: z.string(),
  action: z.enum(["allow", "deny", "ask"]),
});

const rulesArraySchema = z.array(ruleSchema);
const rulesPayloadSchema = z.object({
  rules: rulesArraySchema,
});

const configSchema = z.record(
  z.string(),
  z.union([
    z.enum(["allow", "deny", "ask"]),
    z.record(z.string(), z.enum(["allow", "deny", "ask"])),
  ])
);
const configPayloadSchema = z.object({
  config: configSchema,
});

const evaluateSchema = z.object({
  permission: z.enum(["read", "edit", "bash", "external_directory", "mode_switch"]),
  pattern: z.string(),
});

app.get("/api/permissions/rules", c => {
  const requestId = c.get("requestId");
  const permissionMgr = PermissionManager.getInstance();
  const rules = permissionMgr.getRules();

  logger.debug("Permission rules fetched", {
    module: "permissions",
    requestId,
    count: rules.length,
  });

  return c.json({ rules });
});

app.get("/api/permissions/rules/config", c => {
  const requestId = c.get("requestId");
  const permissionMgr = PermissionManager.getInstance();
  const rules = permissionMgr.getRules();
  const config = formatConfigRules(rules);

  logger.debug("Permission rules config fetched", {
    module: "permissions",
    requestId,
  });

  return c.json({ config });
});

app.get("/api/permissions/rules/default", c => {
  const requestId = c.get("requestId");
  const defaultRules = createDefaultRules();

  logger.debug("Default permission rules fetched", {
    module: "permissions",
    requestId,
  });

  return c.json({ rules: defaultRules });
});

app.put("/api/permissions/rules", zValidator("json", rulesPayloadSchema), async c => {
  const requestId = c.get("requestId");

  try {
    const { rules } = c.req.valid("json");

    const permissionMgr = PermissionManager.getInstance();
    permissionMgr.setRules(rules);

    logger.info("Permission rules replaced", {
      module: "permissions",
      requestId,
      count: rules.length,
    });

    return c.json({ success: true, rules });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid request";
    logger.error("Failed to update permission rules", error instanceof Error ? error : undefined, {
      module: "permissions",
      requestId,
    });
    return c.json({ error: message }, 400);
  }
});

app.post("/api/permissions/rules", zValidator("json", ruleSchema), async c => {
  const requestId = c.get("requestId");

  try {
    const rule = c.req.valid("json");

    const permissionMgr = PermissionManager.getInstance();
    permissionMgr.addRule(rule);

    logger.info("Permission rule added", {
      module: "permissions",
      requestId,
      rule,
    });

    return c.json({ success: true, rule });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid request";
    logger.error("Failed to add permission rule", error instanceof Error ? error : undefined, {
      module: "permissions",
      requestId,
    });
    return c.json({ error: message }, 400);
  }
});

app.post("/api/permissions/rules/config", zValidator("json", configPayloadSchema), async c => {
  const requestId = c.get("requestId");

  try {
    const { config } = c.req.valid("json");
    const rules = parseConfigRules(config);

    const permissionMgr = PermissionManager.getInstance();
    permissionMgr.setRules(rules);

    logger.info("Permission rules updated from config", {
      module: "permissions",
      requestId,
      count: rules.length,
    });

    return c.json({ success: true, rules });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid request";
    logger.error(
      "Failed to update permission rules from config",
      error instanceof Error ? error : undefined,
      {
        module: "permissions",
        requestId,
      }
    );
    return c.json({ error: message }, 400);
  }
});

app.post("/api/permissions/rules/reset", c => {
  const requestId = c.get("requestId");
  const defaultRules = createDefaultRules();

  const permissionMgr = PermissionManager.getInstance();
  permissionMgr.setRules(defaultRules);

  logger.info("Permission rules reset to defaults", {
    module: "permissions",
    requestId,
  });

  return c.json({ success: true, rules: defaultRules });
});

app.delete("/api/permissions/rules", c => {
  const requestId = c.get("requestId");

  const permissionMgr = PermissionManager.getInstance();
  permissionMgr.clearRules();

  logger.info("Permission rules cleared", {
    module: "permissions",
    requestId,
  });

  return c.json({ success: true, rules: [] });
});

app.post("/api/permissions/rules/evaluate", zValidator("json", evaluateSchema), async c => {
  const requestId = c.get("requestId");

  try {
    const { permission, pattern } = c.req.valid("json");

    const permissionMgr = PermissionManager.getInstance();
    const rules = permissionMgr.getRules();

    const { evaluatePermission } = await import("@sakti-code/core/server");
    const action = evaluatePermission(permission, pattern, rules);

    logger.debug("Permission rule evaluated", {
      module: "permissions",
      requestId,
      permission,
      pattern,
      action,
    });

    return c.json({ permission, pattern, action });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid request";
    logger.error("Failed to evaluate permission rule", error instanceof Error ? error : undefined, {
      module: "permissions",
      requestId,
    });
    return c.json({ error: message }, 400);
  }
});

export const rulesRoutes = app;
