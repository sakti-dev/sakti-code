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
      try {
        // plan→mission: resolve the active change, create the worktree, and
        // stamp both on the plan session BEFORE graduation. Worktree creation
        // can fail (not a git repo, permissions); doing it first leaves the
        // gate intact for retry, since graduation is an irreversible OM write.
        if (edge.from === "plan" && edge.to === "mission") {
          const project = ctx.repos.projects.findById(existing.projectId);
          if (project) {
            const changeName = resolveActiveChangeName(project.cwd);
            if (changeName) {
              const wtPath = createMissionWorktree(project.cwd, changeName);
              await ctx.repos.sessions.update(id, { changeName, worktreePath: wtPath });
            } else {
              // No resolvable change → mission would run unisolated on
              // project.cwd. Surface it so the silent skip is diagnosable
              // (design: every mission gets a worktree).
              ctx.log?.server.warn?.(
                "plan→mission: no change name resolved; mission will run without a worktree",
                { sessionId: id, projectCwd: project.cwd },
              );
            }
          }
        }

        // Bind side-effect builders, then apply. Graduation is plan-only;
        // worktree teardown is archive→done.
        const forceReset = edge.requiresForcedObserve ? buildForceReset(ctx, existing) : undefined;
        const graduate =
          edge.requiresGraduation && existing.kind === "plan"
            ? buildGraduation(ctx, existing)
            : undefined;
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
      } catch (err) {
        // Worktree creation or side-effect failure: keep the pending transition
        // so the user can retry. Graduation runs only after worktree create
        // succeeds, so nothing irreversible has happened.
        ctx.log?.server.error?.("confirm approve failed", err, { sessionId: id });
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    // Clear pending on success (approve completed, or reject). Unreachable on
    // approve failure — the catch above returns before this.
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
 * Removes the mission's git worktree (keeps the branch for merge/review), then
 * clears the now-dangling worktreePath so resolveSessionCwd falls back to
 * project.cwd for any post-done access. The worktree CREATE is done inline in
 * the plan→mission block above (it needs resolveActiveChangeName + the
 * returned path to stamp); teardown only needs the session's changeName.
 */
function buildWorktreeTeardown(
  ctx: ReturnType<typeof getCtx>,
  session: { id: string; projectId: string; changeName: string | null },
): (sessionId: string) => Promise<void> {
  return async (sessionId) => {
    const project = ctx.repos.projects.findById(session.projectId);
    if (project && session.changeName) {
      removeMissionWorktree(project.cwd, session.changeName);
    }
    // The worktree dir is gone — clear the path so it doesn't dangle.
    await ctx.repos.sessions.update(sessionId, { worktreePath: null });
  };
}
