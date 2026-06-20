import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

const projectModel = t.Object({
  id: t.String(),
  name: t.String(),
  cwd: t.String(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
});

export const projectsRoutes = new Elysia({ name: "routes.projects" })
  .model({ project: projectModel })
  .get("/api/projects", ({ store }) => getCtx(store).repos.projects.list(), {
    response: t.Array(t.Ref("project")),
  })
  .get(
    "/api/projects/:id",
    ({ params, store }) => {
      const p = getCtx(store).repos.projects.findById(params.id);
      if (!p) {
        return new Response("Not found", { status: 404 });
      }
      return p;
    },
    { response: t.Ref("project") }
  )
  .post(
    "/api/projects",
    ({ body, store }) =>
      getCtx(store).repos.projects.create(body.name, body.cwd),
    {
      body: t.Object({ name: t.String(), cwd: t.String() }),
      response: t.Ref("project"),
    }
  )
  .put(
    "/api/projects/:id",
    ({ params, body, store }) =>
      getCtx(store).repos.projects.update(params.id, body),
    {
      body: t.Partial(t.Object({ name: t.String(), cwd: t.String() })),
      response: t.Ref("project"),
    }
  )
  .delete("/api/projects/:id", ({ params, store }) =>
    getCtx(store).repos.projects.delete(params.id)
  );
