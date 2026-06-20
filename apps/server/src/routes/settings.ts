import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

export const settingsRoutes = new Elysia({ name: "routes.settings" })
  .get("/api/settings", ({ store }) => getCtx(store).repos.settings.getAll())
  .get("/api/settings/:key", ({ params, store }) => {
    const v = getCtx(store).repos.settings.get(params.key);
    if (v === null) {
      return new Response("Not found", { status: 404 });
    }
    return v;
  })
  .put(
    "/api/settings/:key",
    ({ params, body, store }) => {
      getCtx(store).repos.settings.set(params.key, body.value);
      return new Response(null, { status: 204 });
    },
    { body: t.Object({ value: t.String() }) }
  );
