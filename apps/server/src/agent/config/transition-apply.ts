import type { SessionRepo } from "@sakti-code/db";
import type { TransitionEdge } from "./transition-table.ts";

/**
 * Context for {@link applyTransition}. The side-effect builders (forceReset,
 * graduate) are injected already-bound so this stays unit-testable without the
 * full ServerContext — the confirm route and runner bind them via
 * `buildForceReset` / `buildGraduation`.
 */
export interface TransitionApplyCtx {
  repos: { sessions: Pick<SessionRepo, "update"> };
  /** Bound forced-OM-observe (build→verify bias reduction). Best-effort. */
  forceReset?: (sessionId: string) => Promise<void>;
  /** Bound plan-graduation (plan→mission). Best-effort. */
  graduate?: (sessionId: string) => Promise<void>;
  /** Bound worktree teardown (archive→done). Best-effort. */
  worktreeTeardown?: (sessionId: string) => Promise<void>;
  /** Bound .sakti.yaml phase sync (worktree only). Best-effort. */
  syncSddPhase?: (phase: string) => Promise<void>;
  log?: {
    agent?: {
      warn?: (msg: string, ctx?: Record<string, unknown>) => void;
      info?: (msg: string, ctx?: Record<string, unknown>) => void;
    };
  };
}

/**
 * Run a transition edge's side-effects: forced observe (build→verify) runs
 * BEFORE the status flip so the verify agent starts on a compacted context;
 * graduation (plan→mission) reflects the child transcript into the project OM.
 *
 * Side-effects are best-effort: a forced-observe or graduation failure is
 * logged but never strands the status flip (the user's durable intent). No-ops
 * cleanly when an edge has no side-effects.
 */
export async function applyTransition(
  ctx: TransitionApplyCtx,
  session: { id: string },
  edge: TransitionEdge,
): Promise<void> {
  // Forced observe BEFORE the status flip — the verify agent must start on a
  // compacted, observation-driven context. Best-effort.
  if (edge.requiresForcedObserve && ctx.forceReset) {
    try {
      await ctx.forceReset(session.id);
    } catch (err) {
      ctx.log?.agent?.warn?.("transition: forced observe failed (continuing)", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Graduation — plan transcript → project OM. Best-effort.
  if (edge.requiresGraduation && ctx.graduate) {
    try {
      await ctx.graduate(session.id);
    } catch (err) {
      ctx.log?.agent?.warn?.("transition: graduation failed (continuing)", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Worktree teardown (archive→done). Best-effort.
  if (edge.requiresWorktreeTeardown && ctx.worktreeTeardown) {
    try {
      await ctx.worktreeTeardown(session.id);
    } catch (err) {
      ctx.log?.agent?.warn?.("transition: worktree teardown failed (continuing)", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Status flip — the durable intent. Runs last so observe/graduation precede it.
  if (edge.statusTarget) {
    await ctx.repos.sessions.update(session.id, { status: edge.statusTarget });
  }

  // Sync .sakti.yaml phase in the worktree (best-effort). Only for edges
  // with a statusTarget (build/verify/archive — not done, which tears down
  // the worktree). Runs AFTER the status flip so the DB is already correct.
  if (edge.statusTarget && edge.statusTarget !== "done" && ctx.syncSddPhase) {
    try {
      await ctx.syncSddPhase(edge.statusTarget);
    } catch (err) {
      ctx.log?.agent?.warn?.("transition: sync .sakti.yaml phase failed (continuing)", {
        sessionId: session.id,
        phase: edge.statusTarget,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
