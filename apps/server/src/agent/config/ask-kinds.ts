import type { SessionRepo } from "@sakti-code/db";

/**
 * Minimal context the ask-kind handlers need. Covers status transitions plus
 * `forceReset` for the spec→build switch (the route binds it to a forced OM
 * observe so the build agent starts with a clean, plan-focused context).
 */
export interface AskCtx {
  sessions: Pick<SessionRepo, "update">;
  /** Force a context reset (OM observe) on spec→build. */
  forceReset?: (sessionId: string) => Promise<void>;
  /**
   * Graduate a child intake's transcript into the project's resource-scope OM
   * (the main intake's memory). Bound by the confirm route only for intake
   * sessions. Best-effort: a failure must not strand the mission spawn.
   */
  graduate?: (sessionId: string) => Promise<void>;
  /** Optional structured logger (warn level used when forceReset fails). */
  log?: {
    agent?: {
      warn?: (msg: string, ctx?: Record<string, unknown>) => void;
      info?: (msg: string, ctx?: Record<string, unknown>) => void;
    };
  };
}

export type AskAction = "approve" | "reject";

export type AskCard = "proposed-session" | "proposed-spec" | "proposed-completion";

/** The known ask kinds — the closed set wired to lifecycle transitions. */
export type AskKind = "session" | "spec" | "completion";

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
 * session    — plan hands off to a new mission session. Approve is a no-op
 *              here: the card's Create button calls the session-create REST
 *              route directly (the new mission is born in `specifying`).
 * spec       — a specifying mission's spec is approved → status flips to
 *              `building`. A forced OM observe runs here.
 * completion — a building mission declares completion → approve merges
 *              (status `merged`); reject requests changes (status `building`).
 */
export const ASK_KINDS: Record<AskKind, AskKindHandlers> = {
  session: {
    card: "proposed-session",
    onApprove: async (id, _body, ctx) => {
      // Graduate the child plan's transcript into the project's resource-scope
      // OM so the next child/mission inherits it. Best-effort: the mission
      // spawn (the card's Create button) is the user's durable intent and must
      // not be blocked by a graduation failure.
      try {
        await ctx.graduate?.(id);
      } catch (err) {
        ctx.log?.agent?.warn?.("plan graduation failed (continuing)", {
          sessionId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  },
  spec: {
    card: "proposed-spec",
    onApprove: async (id, _body, ctx) => {
      await ctx.sessions.update(id, { status: "building" });
      // Force a context reset before the agent switch. The spec→build agent
      // swap invalidates the prompt cache anyway (system prompt + tools
      // change), so observing the specifying chatter costs nothing cached and
      // gives the build agent a clean, spec-focused start. Best-effort: a
      // reset failure must not strand the mission — the status flip above is
      // the user's durable intent, and the build agent still works on the
      // un-observed context.
      try {
        await ctx.forceReset?.(id);
      } catch (err) {
        ctx.log?.agent?.warn?.("spec→build: forced reset failed (continuing)", {
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
  return kind === "session" || kind === "spec" || kind === "completion";
}
