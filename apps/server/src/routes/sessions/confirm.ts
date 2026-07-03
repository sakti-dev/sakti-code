import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { ASK_KINDS, isKnownAskKind, type AskCtx } from "../../agent/config/ask-kinds.ts";
import { getCtx } from "../../context.ts";

const confirmBody = Type.Object({
  action: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
  kind: Type.String(),
  body: Type.String(),
});

export const confirmRoutes = new Hono()
  .basePath("/sessions")
  .post("/:id/confirm", tbValidator("json", confirmBody), async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const { action, kind, body } = c.req.valid("json");

    const existing = ctx.repos.sessions.findById(id);
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    const handlers = isKnownAskKind(kind) ? ASK_KINDS[kind] : undefined;
    if (!handlers) {
      return c.json({ error: `Unknown ask kind: ${kind}` }, 400);
    }

    const askCtx: AskCtx = { sessions: ctx.repos.sessions };
    if (action === "approve") {
      await handlers.onApprove?.(id, body, askCtx);
    } else if (handlers.onReject) {
      await handlers.onReject(id, body, askCtx);
    }

    return c.json(ctx.repos.sessions.findById(id) ?? existing);
  });
