import type { Phase } from "./config/transition-table.ts";

/**
 * Phases that run autonomously — the agent must reach a `transition` call, not
 * pause for mid-run questions. Specify is intentionally interactive here
 * (brainstorming legitimately pauses); build and verify are the autonomous loop.
 */
export type AutonomousPhase = "build" | "verify";

/** Returns the autonomous phase for a session, or null if it's interactive. */
export function autonomousPhaseForSession(session: {
  kind: string;
  status: string;
}): AutonomousPhase | null {
  if (session.kind !== "mission") return null;
  switch (session.status) {
    case "build":
      return "build";
    case "verify":
      return "verify";
    default:
      return null;
  }
}

export interface TaskProgressLike {
  total: number;
  completed: number;
}

/**
 * Build the oh-my-pi style `<reminder>` injected when an autonomous agent ends
 * its turn WITHOUT a `transition` call (a stall). Build is progress-aware
 * (real counts when `progress` is supplied); verify is phase-aware. At the
 * stall cap (`stallCount >= 2`), the tone escalates to surface the blocker.
 * The reminder is a user-role message that re-prompts the agent to continue.
 */
export function buildReminder(
  phase: AutonomousPhase,
  progress?: TaskProgressLike,
  stallCount = 0,
): string {
  const escalated = stallCount >= 2;
  if (phase === "build") {
    const remaining = progress ? progress.total - progress.completed : 0;
    const progressNote =
      progress && remaining > 0 ? ` — ${remaining} of ${progress.total} tasks still unchecked` : "";
    if (escalated) {
      return `<reminder phase="build" escalated>
You've stalled twice without completing the build phase${progressNote}. Explain the specific blocker in your output, or finish the remaining tasks and call transition({to:"verify"}). Do not stall again without progress.
</reminder>`;
    }
    return `<reminder phase="build">
Build phase isn't complete${progressNote}. Continue: pick the next unchecked task in tasks.md, write its failing test (RED), implement minimally (GREEN), commit. Only call transition({to:"verify"}) once every task is checked AND the project's full test suite passes.
</reminder>`;
  }
  if (escalated) {
    return `<reminder phase="verify" escalated>
You've stalled twice without completing verification. Explain the specific blocker in your output. If you're blocked on the user, say so and stop. Otherwise, finish checking and call transition({to:"build"}) with a fixing plan, or transition({to:"archive"}) if clean.
</reminder>`;
  }
  return `<reminder phase="verify">
Verify phase hasn't transitioned yet. If you still need to check completeness, correctness, or coherence against design.md + specs + tasks.md, do that now. If you found issues, call transition({to:"build"}) with a fixing plan. If the work is clean, call transition({to:"archive"}). If you're waiting for user input, just say so and stop — no transition needed.
</reminder>`;
}

/** Re-export Phase for callers that need the full phase union. */
export type { Phase };
