/**
 * Mode Transition Orchestrator
 *
 * Provides safe, lock-protected runtime mode transitions between plan and build.
 * Ensures atomic transitions with approval gating and serialization.
 */

import type { RuntimeMode } from "../spec/helpers";
import { getSessionRuntimeMode, updateSessionRuntimeMode } from "../spec/helpers";

export type ModeTransitionOutcome = "approved" | "denied" | "noop" | "invalid";

export interface ModeTransitionResult {
  outcome: ModeTransitionOutcome;
  fromMode?: RuntimeMode;
  toMode?: RuntimeMode;
  error?: string;
}

export interface TransitionInput {
  sessionId: string;
  from: RuntimeMode;
  to: RuntimeMode;
  approvalCallback?: (input: {
    sessionId: string;
    fromMode: RuntimeMode;
    toMode: RuntimeMode;
    reason?: string;
  }) => Promise<boolean>;
  reason?: string;
}

const ALLOWED = new Set(["intake->plan", "plan->build", "build->plan"]);

const sessionLocks = new Map<string, { resolve: () => void; promise: Promise<void> }>();

function isValidMode(mode: string): mode is RuntimeMode {
  return mode === "intake" || mode === "plan" || mode === "build";
}

function isAllowedTransition(from: RuntimeMode, to: RuntimeMode): boolean {
  return ALLOWED.has(`${from}->${to}`);
}

async function acquireLock(sessionId: string): Promise<() => void> {
  while (sessionLocks.has(sessionId)) {
    await sessionLocks.get(sessionId)!.promise;
  }

  let releaseFn: () => void;
  const promise = new Promise<void>(resolve => {
    releaseFn = resolve;
  });

  sessionLocks.set(sessionId, { resolve: releaseFn!, promise });

  return () => {
    const lock = sessionLocks.get(sessionId);
    if (lock) {
      lock.resolve();
      sessionLocks.delete(sessionId);
    }
  };
}

/**
 * Transition session runtime mode with approval gating and locking.
 *
 * @param input.sessionId - The session ID
 * @param input.from - The current mode (or undefined to auto-detect)
 * @param input.to - The target mode
 * @param input.approvalCallback - Optional callback to approve/deny the transition
 * @param input.reason - Optional reason for the transition
 */
export async function transitionSessionMode(input: TransitionInput): Promise<ModeTransitionResult> {
  const { sessionId, from, to, approvalCallback, reason } = input;

  if (!isValidMode(to)) {
    return {
      outcome: "invalid",
      error: `invalid target mode: ${to}. Allowed: intake, plan, build`,
    };
  }

  const resolvedFrom = from ?? (await getSessionRuntimeMode(sessionId)) ?? "intake";

  if (resolvedFrom === to) {
    return {
      outcome: "noop",
      fromMode: resolvedFrom,
      toMode: to,
    };
  }

  if (!isAllowedTransition(resolvedFrom, to)) {
    return {
      outcome: "invalid",
      fromMode: resolvedFrom,
      toMode: to,
      error: `invalid transition: ${resolvedFrom} -> ${to}. Allowed: intake->plan, plan->build, build->plan`,
    };
  }

  if (approvalCallback) {
    const approved = await approvalCallback({
      sessionId,
      fromMode: resolvedFrom,
      toMode: to,
      reason,
    });

    if (!approved) {
      return {
        outcome: "denied",
        fromMode: resolvedFrom,
        toMode: to,
      };
    }
  }

  const release = await acquireLock(sessionId);
  try {
    await updateSessionRuntimeMode(sessionId, to);
    return {
      outcome: "approved",
      fromMode: resolvedFrom,
      toMode: to,
    };
  } finally {
    release();
  }
}
