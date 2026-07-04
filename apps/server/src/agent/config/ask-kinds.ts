import type { SessionRepo } from "@sakti-code/db";

/**
 * Minimal context the ask-kind handlers need. Covers status transitions plus
 * `forceReset` for the plan→build switch (the route binds it to a forced OM
 * observe so the build agent starts with a clean, plan-focused context).
 */
export interface AskCtx {
  sessions: Pick<SessionRepo, "update">;
  /** Force a context reset (OM observe) on plan→build. */
  forceReset?: (sessionId: string) => Promise<void>;
  /** Optional structured logger (warn level used when forceReset fails). */
  log?: {
    agent?: {
      warn?: (msg: string, ctx?: Record<string, unknown>) => void;
      info?: (msg: string, ctx?: Record<string, unknown>) => void;
    };
  };
}

export type AskAction = "approve" | "reject";

export type AskCard = "proposed-session" | "proposed-plan" | "proposed-completion";

/** The known ask kinds — the closed set wired to lifecycle transitions. */
export type AskKind = "session" | "plan" | "completion";

export interface AskKindHandlers {
  card: AskCard;
  /** Runs on the approve action. Receives the ask body (the plan/brief/summary). */
  onApprove?: (sessionId: string, body: string, ctx: AskCtx) => Promise<void>;
  /** Runs on the reject/revise action. */
  onReject?: (sessionId: string, body: string, ctx: AskCtx) => Promise<void>;
}

/**
 * Server wiring for the generic `ask` tool. Each known kind maps to a card
 * and a pair of transition handlers. The tool itself (packages/tools) knows
 * nothing about kinds — this table is the policy that turns an approved ask
 * into a lifecycle consequence.
 *
 * session    — intake hands off to a new mission session. Approve is a no-op
 *              here: the card's Create button calls the session-create REST
 *              route directly (the new mission is born in `planning`).
 * plan       — a planning mission's plan is approved → status flips to
 *              `building`. A forced OM observe runs here.
 * completion — a building mission declares completion → approve merges
 *              (status `merged`); reject requests changes (status `building`).
 */
export const ASK_KINDS: Record<AskKind, AskKindHandlers> = {
  session: {
    card: "proposed-session",
    onApprove: async () => {},
  },
  plan: {
    card: "proposed-plan",
    onApprove: async (id, _body, ctx) => {
      await ctx.sessions.update(id, { status: "building" });
      // Force a context reset before the agent switch. The plan→build agent
      // swap invalidates the prompt cache anyway (system prompt + tools
      // change), so observing the planning chatter costs nothing cached and
      // gives the build agent a clean, plan-focused start. Best-effort: a
      // reset failure must not strand the mission — the status flip above is
      // the user's durable intent, and the build agent still works on the
      // un-observed context.
      try {
        await ctx.forceReset?.(id);
      } catch (err) {
        ctx.log?.agent?.warn?.("plan→build: forced reset failed (continuing)", {
          sessionId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    onReject: async () => {},
  },
  completion: {
    card: "proposed-completion",
    onApprove: async (id, _body, ctx) => {
      await ctx.sessions.update(id, { status: "merged" });
    },
    onReject: async (id, _body, ctx) => {
      await ctx.sessions.update(id, { status: "building" });
    },
  },
};

/** Runtime guard for a string received over the wire. */
export function isKnownAskKind(kind: string): kind is AskKind {
  return kind === "session" || kind === "plan" || kind === "completion";
}
