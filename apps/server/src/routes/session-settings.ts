import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

// Default per-session setting values matching runner.ts
const DEFAULT_SETTINGS = {
  auto_compaction: false,
  auto_retry: true,
  follow_up_mode: "all",
  max_retries: 3,
  steering_mode: "all",
  thinking_level: "off",
};

const patchBody = t.Object({
  auto_compaction: t.Optional(t.Boolean()),
  auto_retry: t.Optional(t.Boolean()),
  follow_up_mode: t.Optional(t.String()),
  max_retries: t.Optional(t.Number()),
  steering_mode: t.Optional(t.String()),
  thinking_level: t.Optional(t.String()),
});

export const sessionSettingsRoutes = new Elysia({
  name: "routes.session-settings",
})
  .get("/api/sessions/:id/settings", ({ params, store }) => {
    const ctx = getCtx(store);
    const session = ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }

    const prefix = `session:${params.id}:`;
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

    return settings;
  })
  .patch(
    "/api/sessions/:id/settings",
    async ({ params, body, store }) => {
      const ctx = getCtx(store);
      const session = ctx.repos.sessions.findById(params.id);
      if (!session) {
        return new Response("Not found", { status: 404 });
      }

      const prefix = `session:${params.id}:`;
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined) {
          await ctx.repos.settings.set(`${prefix}${key}`, String(value));
        }
      }

      return new Response(null, { status: 204 });
    },
    { body: patchBody }
  );
