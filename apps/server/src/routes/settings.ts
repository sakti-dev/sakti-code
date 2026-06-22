import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { getCtx } from "../context.ts";

export const settingsRoutes = new Hono()
  .basePath("/settings")
  .get("/", (c) => c.json(getCtx(c).repos.settings.getAll()))
  .get("/:key", (c) => {
    const v = getCtx(c).repos.settings.get(c.req.param("key"));
    if (v === null) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(v);
  })
  .put(
    "/:key",
    tbValidator("json", Type.Object({ value: Type.String() })),
    async (c) => {
      const body = c.req.valid("json");
      await getCtx(c).repos.settings.set(c.req.param("key"), body.value);
      return c.body(null, 204);
    }
  );
