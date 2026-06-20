import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

const createBody = t.Object({
  cwd: t.Optional(t.String()),
  cols: t.Optional(t.Number()),
  rows: t.Optional(t.Number()),
});

const writeBody = t.Object({
  data: t.String(),
});

const resizeBody = t.Object({
  cols: t.Number(),
  rows: t.Number(),
});

export const terminalRoutes = new Elysia({ name: "routes.terminals" })
  .post(
    "/api/terminals",
    ({ body, store }) => {
      const ctx = getCtx(store);
      if (!ctx.terminalManager.bunPtyAvailable) {
        const msg = ctx.terminalManager.loadError ?? "bun-pty not available";
        return new Response(
          JSON.stringify({ error: `Terminal unavailable: ${msg}` }),
          { status: 503, headers: { "content-type": "application/json" } }
        );
      }
      const result = ctx.terminalManager.create(crypto.randomUUID(), {
        cwd: body.cwd,
        cols: body.cols,
        rows: body.rows,
      });
      return result;
    },
    { body: createBody }
  )
  .post(
    "/api/terminals/:id/write",
    ({ params, body, store }) => {
      const ctx = getCtx(store);
      try {
        ctx.terminalManager.write(params.id, body.data);
        return new Response("OK", { status: 200 });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
    { body: writeBody }
  )
  .post(
    "/api/terminals/:id/resize",
    ({ params, body, store }) => {
      const ctx = getCtx(store);
      try {
        ctx.terminalManager.resize(params.id, body.cols, body.rows);
        return new Response("OK", { status: 200 });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
    { body: resizeBody }
  )
  .delete("/api/terminals/:id", ({ params, store }) => {
    const ctx = getCtx(store);
    try {
      ctx.terminalManager.close(params.id);
      return new Response("OK", { status: 200 });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
