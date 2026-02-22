/**
 * Permission Rules API - CRUD endpoints for managing permission rules
 * Based on OpenCode's permission management pattern
 */

import {
  PermissionManager,
  createDefaultRules,
  formatConfigRules,
  parseConfigRules,
} from "@sakti-code/core/server";
import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import { z } from "zod";

type Env = {
  Variables: {
    requestId: string;
    startTime: number;
  };
};

const app = new Hono<Env>();
const logger = createLogger("server");

// Validation schemas
const ruleSchema = z.object({
  permission: z.enum(["read", "edit", "bash", "external_directory", "mode_switch"]),
  pattern: z.string(),
  action: z.enum(["allow", "deny", "ask"]),
});

const rulesArraySchema = z.array(ruleSchema);

const configSchema = z.record(
  z.string(),
  z.union([
    z.enum(["allow", "deny", "ask"]),
    z.record(z.string(), z.enum(["allow", "deny", "ask"])),
  ])
);

/**
 * GET /api/permissions/rules
 *
 * Get all current permission rules
 */
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

/**
 * GET /api/permissions/rules/config
 *
 * Get rules in config format (for display/editing in UI)
 */
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

/**
 * GET /api/permissions/rules/default
 *
 * Get default permission rules
 */
app.get("/api/permissions/rules/default", c => {
  const requestId = c.get("requestId");
  const defaultRules = createDefaultRules();

  logger.debug("Default permission rules fetched", {
    module: "permissions",
    requestId,
  });

  return c.json({ rules: defaultRules });
});

/**
 * PUT /api/permissions/rules
 *
 * Replace all permission rules with new set
 */
app.put("/api/permissions/rules", async c => {
  const requestId = c.get("requestId");

  try {
    const body = await c.req.json();
    const rules = rulesArraySchema.parse(body.rules);

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

/**
 * POST /api/permissions/rules
 *
 * Add a new permission rule (appends to existing rules)
 */
app.post("/api/permissions/rules", async c => {
  const requestId = c.get("requestId");

  try {
    const body = await c.req.json();
    const rule = ruleSchema.parse(body);

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

/**
 * POST /api/permissions/rules/config
 *
 * Set rules from config format (more user-friendly)
 */
app.post("/api/permissions/rules/config", async c => {
  const requestId = c.get("requestId");

  try {
    const body = await c.req.json();
    const config = configSchema.parse(body.config);
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

/**
 * POST /api/permissions/rules/reset
 *
 * Reset to default permission rules
 */
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

/**
 * DELETE /api/permissions/rules
 *
 * Clear all permission rules
 */
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

/**
 * POST /api/permissions/rules/evaluate
 *
 * Test what action would be taken for a given permission/pattern
 * Useful for UI to show users what will happen before they submit
 */
app.post("/api/permissions/rules/evaluate", async c => {
  const requestId = c.get("requestId");

  try {
    const body = await c.req.json();
    const { permission, pattern } = z
      .object({
        permission: z.enum(["read", "edit", "bash", "external_directory", "mode_switch"]),
        pattern: z.string(),
      })
      .parse(body);

    const permissionMgr = PermissionManager.getInstance();
    const rules = permissionMgr.getRules();

    // Import the evaluation function
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

export default app;
