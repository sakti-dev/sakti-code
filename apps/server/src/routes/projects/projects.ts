import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { getCtx } from "../../context.ts";

export const projectsRoutes = new Hono()
  .basePath("/projects")
  .get("/", (c) => c.json(getCtx(c).repos.projects.list()))
  .get("/:id", (c) => {
    const p = getCtx(c).repos.projects.findById(c.req.param("id"));
    if (!p) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(p);
  })
  .post(
    "/",
    tbValidator(
      "json",
      Type.Object({ name: Type.String(), cwd: Type.String() })
    ),
    (c) => {
      const body = c.req.valid("json");
      return c.json(getCtx(c).repos.projects.create(body.name, body.cwd));
    }
  )
  .put(
    "/:id",
    tbValidator(
      "json",
      Type.Partial(Type.Object({ name: Type.String(), cwd: Type.String() }))
    ),
    (c) => {
      const body = c.req.valid("json");
      return c.json(getCtx(c).repos.projects.update(c.req.param("id"), body));
    }
  )
  .delete("/:id", (c) => {
    getCtx(c).repos.projects.delete(c.req.param("id"));
    return c.body(null, 204);
  });
