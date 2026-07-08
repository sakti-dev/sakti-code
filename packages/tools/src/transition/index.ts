import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";

const transitionSchema = Type.Object({
  to: Type.String({
    description:
      'The destination phase: "specify" | "build" | "verify" | "archive" | "mission". You decide based on your judgment (e.g. verify clean -> "archive"; verify found issues -> "build"). You do NOT decide gating — the server does.',
  }),
  body: Type.String({
    description:
      "Context that travels with the transition — a mission brief (to: mission), a spec summary (to: build), a completion summary (to: verify), a fixing plan (to: build from verify), or a verify summary (to: archive). Always end your turn after calling transition.",
  }),
});

export type TransitionToolInput = Static<typeof transitionSchema>;

/**
 * The lifecycle transition tool — a pure signal. The agent's only job is
 * deciding the destination (`to`); the server (ws-handler + runner) resolves
 * gating (gate/auto) from the transition table and runs side-effects. This
 * tool does NO DB writes and NO observes — it just ends the turn cleanly
 * (terminate: true). The phase-specific `<instruction>` is delivered
 * server-side, not from this result.
 */
export function createTransitionTool(): AgentTool<typeof transitionSchema, undefined> {
  return {
    name: "transition",
    label: "transition",
    description:
      "Move to the next phase. Pass the destination (`to`: specify/build/verify/archive/mission) and a `body` (mission brief / fixing plan / summary). Ends your turn. The server decides whether the transition is gated (you wait) or automatic (the next phase runs immediately).",
    parameters: transitionSchema,
    async execute() {
      return {
        content: [{ type: "text" as const, text: "Phase transition recorded." }],
        details: undefined,
        terminate: true,
      };
    },
  };
}
