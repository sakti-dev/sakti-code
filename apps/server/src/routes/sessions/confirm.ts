import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { applyTransition } from "../../agent/config/transition-apply.ts";
import { buildForceReset } from "../../agent/config/force-reset.ts";
import { buildGraduation } from "../../agent/config/graduation.ts";
import {
  getEdge,
  hasEdge,
  phaseFromSession,
  type Phase,
} from "../../agent/config/transition-table.ts";
import { resolveActiveChangeName } from "../../agent/config/resolve-change-name.ts";
import { createMissionWorktree, removeMissionWorktree } from "../../lib/worktree.ts";
import { getCtx } from "../../context.ts";

const confirmBody = Type.Object({
  action: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
  body: Type.String(),
  // The destination phase (`to`). The current phase is derived from the
  // session; the edge = current → to.
  to: Type.String(),
});

export const confirmRoutes = new Hono()
  .basePath("/sessions")
  .post("/:id/confirm", tbValidator("json", confirmBody), async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const { action, to } = c.req.valid("json");

    const existing = ctx.repos.sessions.findById(id);
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    // The body carries the destination phase; the current phase is derived
    // from the session. approve runs the edge's side-effects (status flip,
    // forced observe, graduation); reject (NO) dismisses with no action.
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
      // Worktree teardown (archive→done) runs via applyTransition's side-effect
      // callback; it only needs the session's changeName + project.
      const worktreeTeardown = edge.requiresWorktreeTeardown
        ? buildWorktreeTeardown(ctx, existing)
        : undefined;
      await applyTransition(
        {
          repos: ctx.repos,
          ...(forceReset !== undefined ? { forceReset } : {}),
          ...(graduate !== undefined ? { graduate } : {}),
          ...(worktreeTeardown !== undefined ? { worktreeTeardown } : {}),
          ...(ctx.log !== undefined ? { log: ctx.log } : {}),
        },
        existing,
        edge,
      );
      // plan→mission: resolve the active change name, create the worktree, and
      // stamp both on the plan session so the client can carry them to the new
      // mission.
      if (edge.from === "plan" && edge.to === "mission") {
        const project = ctx.repos.projects.findById(existing.projectId);
        if (project) {
          const changeName = resolveActiveChangeName(project.cwd);
          if (changeName) {
            const wtPath = createMissionWorktree(project.cwd, changeName);
            await ctx.repos.sessions.update(id, { changeName, worktreePath: wtPath });
          }
        }
      }
    }
    // reject (NO): dismiss only — no status change, no side-effect.
    await ctx.repos.sessions.update(id, {
      pendingTransitionTo: null,
      pendingTransitionBody: null,
    });
    const updated = ctx.repos.sessions.findById(id) ?? existing;
    if (action === "approve") {
      return c.json({ ...updated, instruction: edge.instruction });
    }
    return c.json(updated);
  });

/**
 * Build the worktree-teardown side-effect callback for the archive→done edge.
 * Removes the mission's git worktree (keeps the branch for merge/review). The
 * worktree CREATE is done inline in the plan→mission block above (it needs
 * resolveActiveChangeName + the returned path to stamp); teardown only needs
 * the session's changeName, already stored.
 */
function buildWorktreeTeardown(
  ctx: ReturnType<typeof getCtx>,
  session: { id: string; projectId: string; changeName: string | null },
): (sessionId: string) => Promise<void> {
  return async () => {
    const project = ctx.repos.projects.findById(session.projectId);
    if (!project || !session.changeName) return;
    removeMissionWorktree(project.cwd, session.changeName);
  };
}
