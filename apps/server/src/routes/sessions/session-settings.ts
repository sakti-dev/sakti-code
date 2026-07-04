import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { getCtx } from "../../context.ts";

// Default per-session setting values matching runner.ts
const DEFAULT_SETTINGS = {
  auto_retry: true,
  follow_up_mode: "all",
  max_retries: 3,
  steering_mode: "all",
  thinking_level: "off",
};

const patchBody = Type.Object({
  auto_retry: Type.Optional(Type.Boolean()),
  follow_up_mode: Type.Optional(Type.String()),
  max_retries: Type.Optional(Type.Number()),
  steering_mode: Type.Optional(Type.String()),
  thinking_level: Type.Optional(Type.String()),
});

export const sessionSettingsRoutes = new Hono()
  .basePath("/sessions")
  .get("/:id/settings", (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    const prefix = `session:${id}:`;
    const rows = ctx.repos.settings.getByPrefix(prefix);
    const overrides: Record<string, string> = {};
    for (const row of rows) {
      const key = row.key.slice(prefix.length);
      overrides[key] = row.value;
    }

    const settings: Record<string, unknown> = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
      const stored = overrides[key];
      if (stored === undefined) {
        settings[key] = defaultValue;
      } else if (typeof defaultValue === "boolean") {
        settings[key] = stored === "true";
      } else if (typeof defaultValue === "number") {
        settings[key] = Number(stored);
      } else {
        settings[key] = stored;
      }
    }

    return c.json(settings);
  })
  .patch("/:id/settings", tbValidator("json", patchBody), async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    const body = c.req.valid("json");
    const prefix = `session:${id}:`;
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        await ctx.repos.settings.set(`${prefix}${key}`, String(value));
      }
    }

    return c.body(null, 204);
  });
