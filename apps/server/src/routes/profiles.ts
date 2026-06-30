import { Hono } from "hono";
import { getCtx } from "../context.ts";
import type { Profiles } from "../lib/profiles-store.ts";

export const profilesRoutes = new Hono()
  .basePath("/profiles")
  .get("/", (c) => {
    try {
      const profiles = getCtx(c).profiles.read();
      return c.json(profiles);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to read profiles" }, 500);
    }
  })
  .put("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Malformed JSON" }, 400);
    }
    try {
      getCtx(c).profiles.writeAll(body as Profiles);
      return c.body(null, 204);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Invalid profiles" }, 400);
    }
  });

export type ProfilesRoutes = typeof profilesRoutes;
