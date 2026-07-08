/**
 * The transition table — the single source of truth for phase-edge gating policy.
 *
 * Replaces `ask-kinds.ts`. Each phase edge declares:
 *   - `mode`: "gate" (renders a yes/no card, pauses the chain) or "auto"
 *     (runs side-effects and continues immediately).
 *   - `requiresForcedObserve`: force an OM observe on the destination so its
 *     agent starts on a compacted, observation-driven context (bias reduction).
 *     Set only on build→verify.
 *   - `instruction`: the `<instruction>` block delivered to the next phase
 *     (tool result between phases; embedded in the handoff user message at
 *     mission start).
 *
 * The agent's only job is deciding the destination (`to`). The destination
 * encodes the decision (verify clean → archive; verify found issues → build).
 * Gate-vs-auto is NOT the agent's concern — it lives here.
 */

export type Phase = "plan" | "specify" | "build" | "verify" | "archive" | "mission";

export type Mode = "gate" | "auto";

export interface TransitionEdge {
  from: Phase;
  to: Phase;
  mode: Mode;
  /** Force an OM observe on the destination (bias reduction). build→verify only. */
  requiresForcedObserve?: boolean;
  /** Graduate the plan transcript into the project OM. plan→mission only. */
  requiresGraduation?: boolean;
  /** Status to flip the session to (the DB `status` column value). */
  statusTarget?: string;
  /** The `<instruction>` block delivered to the next phase. */
  instruction: string;
}

function instruction(body: string): string {
  return `<instruction>\n${body.trim()}\n</instruction>`;
}

const TABLE: Record<string, TransitionEdge> = {
  "plan->mission": {
    from: "plan",
    to: "mission",
    mode: "gate",
    requiresGraduation: true,
    // Delivered by embedding in the mission's handoff user message (mission
    // start has no preceding transition call to produce a tool result).
    instruction: instruction(
      'You are now in specify mode. Read proposal.md for this change and produce design.md + tasks.md (always), plus specs deltas when there is a behavior change. Follow the sakti-specify skill. When the spec is ready, call transition({to:"build"}).',
    ),
  },
  "specify->build": {
    from: "specify",
    to: "build",
    mode: "gate",
    statusTarget: "building",
    instruction: instruction(
      'You are now in build mode. Read design.md + tasks.md and implement the change with TDD (failing test first, then minimal implementation, then commit). Check off each task in tasks.md as it lands. When every task is checked AND the project\'s full test suite passes, call transition({to:"verify"}) with a completion summary. Follow the sakti-build skill.',
    ),
  },
  "build->verify": {
    from: "build",
    to: "verify",
    mode: "auto",
    requiresForcedObserve: true,
    statusTarget: "review",
    instruction: instruction(
      'You are now in verify mode. Review the work for completeness, correctness, and coherence against design.md + specs + tasks.md. You are edit-denied — do not fix issues yourself; if you find any, write a fixing plan and call transition({to:"build"}) carrying it. Only call transition({to:"archive"}) if the work is genuinely clean. Follow the sakti-verify skill.',
    ),
  },
  "verify->build": {
    from: "verify",
    to: "build",
    mode: "auto",
    statusTarget: "building",
    instruction: instruction(
      'You are now back in build mode. Read the fixing plan from the transition call above and address every issue it lists. Then re-run the project\'s full test suite and call transition({to:"verify"}) again only when tests pass. Do not skip to a final review — the verify agent rejected the previous completion for concrete reasons. Follow the sakti-build skill.',
    ),
  },
  "verify->archive": {
    from: "verify",
    to: "archive",
    mode: "gate",
    statusTarget: "merged",
    // Archive is terminal; the archive skill guides the rest.
    instruction: instruction(
      "You are now in archive mode. Sync any delta specs into the main specs, then move this change into the archive. Follow the sakti-archive skill.",
    ),
  },
};

const EDGE_KEY = (from: Phase, to: Phase): string => `${from}->${to}`;

/** Look up an edge. Throws on an unknown edge — every transition must be declared. */
export function getEdge(from: Phase, to: Phase): TransitionEdge {
  const edge = TABLE[EDGE_KEY(from, to)];
  if (!edge) {
    throw new Error(
      `Unknown phase transition: ${from} -> ${to}. No such edge in the transition table.`,
    );
  }
  return edge;
}

/** All declared edges (for validation / iteration). */
export function allEdges(): TransitionEdge[] {
  return Object.values(TABLE);
}

/** Whether a declared edge exists between two phases. */
export function hasEdge(from: Phase, to: Phase): boolean {
  return TABLE[EDGE_KEY(from, to)] !== undefined;
}

/**
 * Derive the current phase from a session's DB state. Plan sessions are always
 * in the plan phase; missions map by status (specifying→specify,
 * building→build, review→verify, merged→archive). Used by the runner and the
 * confirm route to resolve the transition edge.
 */
export function phaseFromSession(session: { kind: string; status: string }): Phase {
  if (session.kind === "plan") return "plan";
  switch (session.status) {
    case "specifying":
      return "specify";
    case "building":
      return "build";
    case "review":
      return "verify";
    case "merged":
      return "archive";
    default:
      return "specify";
  }
}
