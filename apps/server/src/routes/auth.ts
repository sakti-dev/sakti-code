import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { getCtx } from "../context.ts";

export const authRoutes = new Hono()
  .basePath("/auth")
  .get("/", (c) => c.json(getCtx(c).auth.list()))
  .post("/:provider", tbValidator("json", Type.Object({ key: Type.String() })), (c) => {
    const provider = c.req.param("provider");
    const body = c.req.valid("json");
    const ok = getCtx(c).auth.set(provider, body.key);
    if (!ok) {
      return c.json({ error: "Unknown provider or empty key" }, 400);
    }
    return c.body(null, 204);
  })
  .delete("/:provider", (c) => {
    const ok = getCtx(c).auth.delete(c.req.param("provider"));
    if (!ok) {
      return c.json({ error: "Key not found" }, 404);
    }
    return c.body(null, 204);
  });

export type AuthRoutes = typeof authRoutes;
