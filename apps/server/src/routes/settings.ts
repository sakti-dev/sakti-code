import { Hono } from "hono";
import { getCtx } from "../context.ts";

export const settingsRoutes = new Hono()
  .basePath("/settings")
  .get("/", (c) => c.json(getCtx(c).settingsFile.read()))
  .put("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Malformed JSON" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "Body must be a JSON object" }, 400);
    }
    getCtx(c).settingsFile.update(body as Record<string, unknown>);
    return c.body(null, 204);
  });

export type SettingsRoutes = typeof settingsRoutes;
