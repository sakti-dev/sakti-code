import {
  evaluate,
  merge,
  type PermissionAskRequest,
  type PermissionReply,
  type PermissionRule,
} from "@sakti-code/agent";

/** A pending permission request awaiting a user reply. */
export interface PermissionFrame extends PermissionAskRequest {
  id: string;
}

interface PendingEntry {
  frame: PermissionFrame;
  resolve: (verdict: "allow" | "deny") => void;
}

export interface PermissionChannel {
  /** Ask the user; returns a promise that resolves on reply. Re-checks grants first (race safety). */
  ask: (req: PermissionAskRequest) => Promise<"allow" | "deny">;
  /** Resolve the effective decision for `(permission, pattern)` against the live grants. */
  evaluate: (
    sessionId: string,
    permission: string,
    pattern: string,
    baseRuleset: PermissionRule[]
  ) => "allow" | "deny" | "ask";
  /** Snapshot of pending requests for a session. */
  listPending: (sessionId: string) => PermissionFrame[];
  /** Deny all pending requests for a session (run end/abort finalizer). */
  rejectPendingForSession: (sessionId: string) => void;
  /** Resolve a pending request; ignores unknown ids (stale). */
  reply: (sessionId: string, id: string, reply: PermissionReply) => void;
}

export interface PermissionChannelOptions {
  onAsked: (frame: PermissionFrame) => void;
}

/**
 * In-memory per-session permission approval channel. Ports opencode's
 * `permission/index.ts` Deferred/pending shape (`pending` map + `approved`
 * grants), minus the sibling-cascade (sakti prepares tool calls sequentially,
 * so there is never more than one pending ask at a time). Grants are held in
 * memory only — DB persistence is a follow-up.
 */
export function createPermissionChannel(
  options: PermissionChannelOptions
): PermissionChannel {
  const grants = new Map<string, PermissionRule[]>();
  const pending = new Map<string, PendingEntry>();
  let seq = 0;

  const nextId = () => `per_${++seq}`;

  const grantsFor = (sessionId: string): PermissionRule[] =>
    grants.get(sessionId) ?? [];

  const evaluateWithGrants = (
    sessionId: string,
    permission: string,
    pattern: string,
    baseRuleset: PermissionRule[]
  ): "allow" | "deny" | "ask" =>
    evaluate(permission, pattern, merge(baseRuleset, grantsFor(sessionId)))
      .action;

  const ask = (req: PermissionAskRequest): Promise<"allow" | "deny"> => {
    // Re-check grants (race safety vs the loop's sync eval): if a prior "always"
    // already covers every pattern, allow without prompting.
    const allGranted = req.patterns.every(
      (pattern) =>
        evaluate(req.permission, pattern, grantsFor(req.sessionId)).action ===
        "allow"
    );
    if (allGranted) {
      return Promise.resolve("allow");
    }
    const id = nextId();
    const frame: PermissionFrame = { id, ...req };
    let resolve!: (verdict: "allow" | "deny") => void;
    const promise = new Promise<"allow" | "deny">((res) => {
      resolve = res;
    });
    pending.set(id, { frame, resolve });
    options.onAsked(frame);
    return promise;
  };

  const reply = (
    sessionId: string,
    id: string,
    decision: PermissionReply
  ): void => {
    const entry = pending.get(id);
    if (!entry) {
      return; // stale
    }
    pending.delete(id);
    if (decision === "reject") {
      entry.resolve("deny");
      return;
    }
    entry.resolve("allow");
    if (decision === "once") {
      return;
    }
    // "always": persist a grant for each pattern in req.always.
    const current = grants.get(sessionId) ?? [];
    const added: PermissionRule[] = entry.frame.always.map((pattern) => ({
      permission: entry.frame.permission,
      pattern,
      action: "allow" as const,
    }));
    grants.set(sessionId, [...current, ...added]);
  };

  const rejectPendingForSession = (sessionId: string): void => {
    for (const [id, entry] of pending.entries()) {
      if (entry.frame.sessionId === sessionId) {
        pending.delete(id);
        entry.resolve("deny");
      }
    }
  };

  const listPending = (sessionId: string): PermissionFrame[] =>
    [...pending.values()]
      .filter((entry) => entry.frame.sessionId === sessionId)
      .map((entry) => entry.frame);

  return {
    evaluate: evaluateWithGrants,
    ask,
    listPending,
    reply,
    rejectPendingForSession,
  };
}

/**
 * Module-level channels keyed by session id, so a WS `permission.reply` can
 * reach the in-flight ask regardless of which request handler received it.
 */
const channels = new Map<string, PermissionChannel>();

export function getPermissionChannel(
  sessionId: string,
  options?: PermissionChannelOptions
): PermissionChannel {
  const existing = channels.get(sessionId);
  if (existing) {
    return existing;
  }
  if (!options) {
    throw new Error(
      `No permission channel for session ${sessionId} and none configured`
    );
  }
  const channel = createPermissionChannel(options);
  channels.set(sessionId, channel);
  return channel;
}

export function resetPermissionChannelsForTesting(): void {
  channels.clear();
}
