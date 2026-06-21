import { Elysia, t } from "elysia";
import { hasWsConnection } from "../../agent/ws.ts";
import { getCtx } from "../../context.ts";

const createBody = t.Object({
  // The client's WS connection id (the wsId from the welcome frame). Terminals
  // are pushed to over WS, so a terminal MUST belong to a live connection.
  connectionId: t.String(),
  cols: t.Optional(t.Number()),
  cwd: t.Optional(t.String()),
  rows: t.Optional(t.Number()),
});

const writeBody = t.Object({
  data: t.String(),
});

const resizeBody = t.Object({
  cols: t.Number(),
  rows: t.Number(),
});

export const terminalRoutes = new Elysia({
  name: "routes.terminals",
  prefix: "/workspace",
})
  .post(
    "/terminals",
    async ({ body, store }) => {
      const ctx = getCtx(store);
      await ctx.terminalManager.ensureLoaded();
      if (!hasWsConnection(body.connectionId)) {
        return new Response(
          JSON.stringify({
            error: "Unknown connectionId; open a WS connection first",
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      if (!ctx.terminalManager.bunPtyAvailable) {
        const msg = ctx.terminalManager.loadError ?? "bun-pty not available";
        return new Response(
          JSON.stringify({ error: `Terminal unavailable: ${msg}` }),
          { status: 503, headers: { "content-type": "application/json" } }
        );
      }
      const result = ctx.terminalManager.create(body.connectionId, {
        ...(body.cwd === undefined ? {} : { cwd: body.cwd }),
        ...(body.cols === undefined ? {} : { cols: body.cols }),
        ...(body.rows === undefined ? {} : { rows: body.rows }),
      });
      return result;
    },
    { body: createBody }
  )
  .post(
    "/terminals/:id/write",
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
    "/terminals/:id/resize",
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
  .delete("/terminals/:id", ({ params, store }) => {
    const ctx = getCtx(store);
    try {
      ctx.terminalManager.close(params.id);
      return new Response("OK", { status: 200 });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
