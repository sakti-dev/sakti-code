import { computeFileHash } from "../lib/hashline-utils/format";

interface NoopLoopEntry {
  count: number;
  hash: string;
}

export interface NoopLoopGuard {
  entries: Map<string, NoopLoopEntry>;
}

export const NOOP_HARD_LIMIT = 3;

export interface NoopLoopGuardOwner {
  noopLoopGuard?: NoopLoopGuard;
}

export function getNoopLoopGuard(session: NoopLoopGuardOwner): NoopLoopGuard {
  if (!session.noopLoopGuard) {
    session.noopLoopGuard = { entries: new Map() };
  }
  return session.noopLoopGuard;
}

export interface NoopRecordResult {
  count: number;
  escalate: boolean;
}

export function recordNoopEdit(
  session: NoopLoopGuardOwner,
  canonicalPath: string,
  inputHash: string
): NoopRecordResult {
  const guard = getNoopLoopGuard(session);
  const prev = guard.entries.get(canonicalPath);
  const count = prev && prev.hash === inputHash ? prev.count + 1 : 1;
  guard.entries.set(canonicalPath, { hash: inputHash, count });
  return { count, escalate: count >= NOOP_HARD_LIMIT };
}

export function resetNoopEdit(
  session: NoopLoopGuardOwner,
  canonicalPath: string
): void {
  const guard = session.noopLoopGuard;
  if (!guard) {
    return;
  }
  guard.entries.delete(canonicalPath);
}

export function hashPatchInput(input: string): string {
  return computeFileHash(input);
}
