import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { ASK_KINDS, isKnownAskKind, type AskCtx } from "../../agent/config/ask-kinds.ts";
import { applyTransition } from "../../agent/config/transition-apply.ts";
import { buildForceReset } from "../../agent/config/force-reset.ts";
import { buildGraduation } from "../../agent/config/graduation.ts";
import {
  getEdge,
  hasEdge,
  phaseFromSession,
  type Phase,
} from "../../agent/config/transition-table.ts";
import { getCtx } from "../../context.ts";

const confirmBody = Type.Object({
  action: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
  body: Type.String(),
  // Transition flow: the destination phase (`to`).
  to: Type.Optional(Type.String()),
  // Legacy ask flow: the kind discriminator (`kind`).
  kind: Type.Optional(Type.String()),
});

export const confirmRoutes = new Hono()
  .basePath("/sessions")
  .post("/:id/confirm", tbValidator("json", confirmBody), async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const { action, body, to, kind } = c.req.valid("json");

    const existing = ctx.repos.sessions.findById(id);
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    // ---- Transition gate flow (the new system) ---------------------------
    // The body carries the destination phase; the current phase is derived
    // from the session. approve runs the edge's side-effects (status flip,
    // forced observe, graduation); reject (NO) dismisses with no action.
    if (to !== undefined) {
      const fromPhase = phaseFromSession(existing);
      const dest = to as Phase;
      if (!hasEdge(fromPhase, dest)) {
        return c.json({ error: `Invalid transition: ${fromPhase} -> ${to}` }, 400);
      }
      const edge = getEdge(fromPhase, dest);

      if (action === "approve") {
        // Bind side-effect builders, then apply. Graduation is plan-only.
        const forceReset = edge.requiresForcedObserve ? buildForceReset(ctx, existing) : undefined;
        const graduate =
          edge.requiresGraduation && existing.kind === "plan"
            ? buildGraduation(ctx, existing)
            : undefined;
        await applyTransition(
          {
            repos: ctx.repos,
            ...(forceReset !== undefined ? { forceReset } : {}),
            ...(graduate !== undefined ? { graduate } : {}),
            ...(ctx.log !== undefined ? { log: ctx.log } : {}),
          },
          existing,
          edge,
        );
      }
      // reject (NO): dismiss only — no status change, no side-effect.
      await ctx.repos.sessions.update(id, {
        pendingTransitionTo: null,
        pendingTransitionBody: null,
      });
      return c.json(ctx.repos.sessions.findById(id) ?? existing);
    }

    // ---- Legacy ask flow (removed in a later task) -----------------------
    if (kind === undefined) {
      return c.json({ error: "Missing `to` or `kind`" }, 400);
    }
    const handlers = isKnownAskKind(kind) ? ASK_KINDS[kind] : undefined;
    if (!handlers) {
      return c.json({ error: `Unknown ask kind: ${kind}` }, 400);
    }

    const forceReset = buildForceReset(ctx, existing);
    const graduate = existing.kind === "plan" ? buildGraduation(ctx, existing) : undefined;

    const askCtx: AskCtx = {
      sessions: ctx.repos.sessions,
      forceReset,
      ...(graduate !== undefined ? { graduate } : {}),
      ...(ctx.log !== undefined ? { log: ctx.log } : {}),
    };
    if (action === "approve") {
      await handlers.onApprove?.(id, body, askCtx);
    } else if (handlers.onReject) {
      await handlers.onReject(id, body, askCtx);
    }

    await ctx.repos.sessions.update(id, { pendingAskKind: null, pendingAskBody: null });

    return c.json(ctx.repos.sessions.findById(id) ?? existing);
  });
