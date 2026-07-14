import { join } from "node:path";
import { readChangeMetadata, writeChangeMetadata } from "@sakti-code/sakti";

interface SddPhaseLog {
  agent?: {
    warn?: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

/**
 * Build a `syncSddPhase` callback for `applyTransition`. Reads the existing
 * `.sakti.yaml` from the worktree's change dir, updates the `phase` field,
 * and writes it back. Best-effort — logs and returns on any error.
 *
 * Only touches the WORKTREE's `.sakti.yaml` (never the main project — the
 * main project's change dir is cleaned at graduation and only returns via
 * merge).
 *
 * Returns `undefined` when the session has no worktree or changeName (plan
 * sessions, pre-isolation missions) — the caller skips the sync.
 */
export function buildSyncSddPhase(
  session: { worktreePath: string | null; changeName: string | null },
  log?: SddPhaseLog,
): ((phase: string) => Promise<void>) | undefined {
  if (!session.worktreePath || !session.changeName) return undefined;
  const changeDir = join(session.worktreePath, ".sakti", "changes", session.changeName);

  return async (phase: string) => {
    try {
      const metadata = readChangeMetadata(changeDir);
      if (!metadata) return;
      if (metadata.phase === phase) return;
      writeChangeMetadata(changeDir, { ...metadata, phase: phase as never });
    } catch (err) {
      log?.agent?.warn?.("transition: sync .sakti.yaml phase failed (continuing)", {
        changeDir,
        phase,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
