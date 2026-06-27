import {
  evaluate,
  merge,
  type PermissionAskRequest,
  type PermissionReply,
  type PermissionRule,
} from "@sakti-code/agent-effect";

/** A pending permission request awaiting a user reply. */
export interface PermissionFrame extends PermissionAskRequest {
  id: string;
}

interface PendingEntry {
  frame: PermissionFrame;
  resolve: (verdict: "allow" | "deny") => void;
}

type AskedSink = (frame: PermissionFrame) => void;

/**
 * In-memory, single-session permission approval channel. Ports opencode's
 * `permission/index.ts` Deferred/pending shape (`pending` map + `approved`
 * grants), minus the sibling-cascade (sakti prepares tool calls sequentially,
 * so there is never more than one pending ask at a time).
 *
 * Grants persist across runs within the session (the "always" UX); the
 * delivery {@link setSink | sink} is mutable so a new WS connection can attach.
 */
export interface PermissionChannel {
  /** Ask the user; returns a promise that resolves on reply. Re-checks grants first (race safety). */
  ask: (req: PermissionAskRequest) => Promise<"allow" | "deny">;
  /** Resolve `(permission, pattern)` against the base ruleset + live grants. */
  evaluate: (
    permission: string,
    pattern: string,
    baseRuleset: PermissionRule[]
  ) => "allow" | "deny" | "ask";
  /** Snapshot of pending requests. */
  listPending: () => PermissionFrame[];
  /** Deny all pending requests (run end/abort finalizer). */
  rejectPending: () => void;
  /** Resolve a pending request; ignores unknown ids (stale). */
  reply: (id: string, reply: PermissionReply) => void;
  /** Attach the delivery target for `ask` frames (the active WS connection). */
  setSink: (sink: AskedSink) => void;
}

export function createPermissionChannel(): PermissionChannel {
  const grants: PermissionRule[] = [];
  const pending = new Map<string, PendingEntry>();
  let seq = 0;
  let sink: AskedSink = () => undefined;

  const nextId = () => `per_${++seq}`;

  const evaluateFn = (
    permission: string,
    pattern: string,
    baseRuleset: PermissionRule[]
  ): "allow" | "deny" | "ask" =>
    evaluate(permission, pattern, merge(baseRuleset, grants)).action;

  const ask = (req: PermissionAskRequest): Promise<"allow" | "deny"> => {
    // Re-check grants (race safety vs the loop's sync eval): if a prior "always"
    // already covers every pattern, allow without prompting.
    const allGranted = req.patterns.every(
      (pattern) => evaluate(req.permission, pattern, grants).action === "allow"
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
    sink(frame);
    return promise;
  };

  const reply = (id: string, decision: PermissionReply): void => {
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
    for (const pattern of entry.frame.always) {
      grants.push({
        permission: entry.frame.permission,
        pattern,
        action: "allow",
      });
    }
  };

  const rejectPending = (): void => {
    for (const [id, entry] of pending.entries()) {
      pending.delete(id);
      entry.resolve("deny");
    }
  };

  const listPending = (): PermissionFrame[] =>
    [...pending.values()].map((entry) => entry.frame);

  const setSink = (next: AskedSink): void => {
    sink = next;
  };

  return {
    evaluate: evaluateFn,
    ask,
    listPending,
    reply,
    rejectPending,
    setSink,
  };
}

// ── Session-scoped registry ────────────────────────────────────────────────
// One channel per session. Grants persist across runs; the sink is reattached
// by each active WS connection. Keyed by sessionId so a `permission.reply`
// arriving on the WS reaches the in-flight ask.

const channels = new Map<string, PermissionChannel>();

/** Get (or lazily create) the persistent channel for a session. */
export function getPermissionChannel(sessionId: string): PermissionChannel {
  const existing = channels.get(sessionId);
  if (existing) {
    return existing;
  }
  const channel = createPermissionChannel();
  channels.set(sessionId, channel);
  return channel;
}

export function resetPermissionChannelsForTesting(): void {
  channels.clear();
}
