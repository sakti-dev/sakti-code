import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { hasWsConnection } from "../../agent/ws.ts";
import { getCtx } from "../../context.ts";

const createBody = Type.Object({
  // The client's WS connection id (the wsId from the welcome frame). Terminals
  // are pushed to over WS, so a terminal MUST belong to a live connection.
  connectionId: Type.String(),
  cols: Type.Optional(Type.Number()),
  cwd: Type.Optional(Type.String()),
  rows: Type.Optional(Type.Number()),
});

const writeBody = Type.Object({
  data: Type.String(),
});

const resizeBody = Type.Object({
  cols: Type.Number(),
  rows: Type.Number(),
});

export const terminalRoutes = new Hono()
  .basePath("/workspace")
  .post("/terminals", tbValidator("json", createBody), async (c) => {
    const ctx = getCtx(c);
    const body = c.req.valid("json");
    await ctx.terminalManager.ensureLoaded();
    if (!hasWsConnection(body.connectionId)) {
      return c.json(
        { error: "Unknown connectionId; open a WS connection first" },
        400
      );
    }
    if (!ctx.terminalManager.ptyAvailable) {
      const msg = ctx.terminalManager.loadError ?? "node-pty not available";
      return c.json({ error: `Terminal unavailable: ${msg}` }, 503);
    }
    const result = ctx.terminalManager.create(body.connectionId, {
      ...(body.cwd === undefined ? {} : { cwd: body.cwd }),
      ...(body.cols === undefined ? {} : { cols: body.cols }),
      ...(body.rows === undefined ? {} : { rows: body.rows }),
    });
    return c.json(result);
  })
  .post("/terminals/:id/write", tbValidator("json", writeBody), (c) => {
    const ctx = getCtx(c);
    try {
      ctx.terminalManager.write(c.req.param("id"), c.req.valid("json").data);
      return c.body(null, 200);
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  })
  .post("/terminals/:id/resize", tbValidator("json", resizeBody), (c) => {
    const ctx = getCtx(c);
    const body = c.req.valid("json");
    try {
      ctx.terminalManager.resize(c.req.param("id"), body.cols, body.rows);
      return c.body(null, 200);
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  })
  .delete("/terminals/:id", (c) => {
    const ctx = getCtx(c);
    try {
      ctx.terminalManager.close(c.req.param("id"));
      return c.body(null, 200);
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  });
