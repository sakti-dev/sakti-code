import { createStore, produce, reconcile } from "solid-js/store";
import type {
  MessagePart,
  OmWindowState,
  RetryState,
  StreamState,
  Turn,
  TurnTiming,
  UIMessage,
} from "../types.ts";
import { idleStreamState } from "../types.ts";

export interface PendingAsk {
  kind: "session" | "plan" | "completion";
  body: string;
}

export interface PermissionPending {
  id: string;
  patterns: string[];
  permission: string;
  toolCallId: string;
  toolName: string;
}

export interface OmMarkerInput {
  cycleId: string;
  operationType: "observation" | "reflection" | "buffering";
  status:
    | "loading"
    | "complete"
    | "failed"
    | "buffering"
    | "buffering-complete"
    | "buffering-failed"
    | "activated"
    | "disconnected";
  durationMs?: number;
  tokensProcessed?: number;
  tokensProduced?: number;
  observations?: string;
  currentTask?: string;
  suggestedResponse?: string;
  error?: string;
}

export interface SessionStoreData {
  omStatus: OmWindowState | null;
  pendingAsk: PendingAsk | null;
  permission: PermissionPending | null;
  retry: RetryState | null;
  streaming: StreamState;
  turns: Turn[];
}

export interface SessionActions {
  addAssistantMessage: (msg: UIMessage) => void;
  addOmMarker: (msgId: string, marker: OmMarkerInput) => void;
  addToolCall: (msgId: string, toolCallId: string, toolName: string, input: unknown) => void;
  appendTextToken: (msgId: string, delta: string) => void;
  appendThinkingToken: (msgId: string, delta: string) => void;
  clearCurrentMessage: () => void;
  clearCurrentTool: () => void;
  clearPendingAsk: () => void;
  completeToolCall: (
    msgId: string,
    toolCallId: string,
    result: string,
    isError?: boolean,
    details?: unknown,
  ) => void;
  evictIntermediates: (turnId: string) => void;
  finalizeMessage: (msgId: string, usage?: UIMessage["usage"]) => void;
  finalizeTurn: (endedAt: number) => void;
  getCurrentMessageId: () => string | null;
  getLastAssistantMessageId: () => string | null;
  loadIntermediates: (turnId: string, messages: UIMessage[]) => void;
  loadTurnTimings: (timings: TurnTiming[]) => void;
  loadTurns: (turns: Turn[]) => void;
  reset: () => void;
  setContent: (msgId: string, content: string) => void;
  setCurrentMessage: (msgId: string) => void;
  setCurrentTool: (toolName: string) => void;
  setError: (msgId: string, error: string) => void;
  setPermission: (permission: PermissionPending | null) => void;
  setPhase: (phase: StreamState["phase"]) => void;
  setPendingAsk: (ask: PendingAsk) => void;
  setRetry: (retry: RetryState | null) => void;
  startTurn: (userMessage: UIMessage | null, startedAt?: number) => void;
  updateOmMarker: (msgId: string, cycleId: string, updates: Partial<OmMarkerInput>) => void;
  updateOmStatus: (status: OmWindowState) => void;
  wasLastUserMessage: (text: string) => boolean;
}

export interface SessionStore {
  actions: SessionActions;
  setStore: ReturnType<typeof createStore<SessionStoreData>>[1];
  store: SessionStoreData;
}

/** O(1) lookup: msgId → location in the store. */
interface MsgLocation {
  turnIdx: number;
  /** true = message lives in turn.summary, false = in turn.intermediates[msgIdx] */
  inSummary: boolean;
  /** Index into intermediates[]. Ignored when inSummary is true. */
  msgIdx: number;
}

export function createSessionStore(): SessionStore {
  const [store, setStore] = createStore<SessionStoreData>({
    omStatus: null,
    pendingAsk: null,
    permission: null,
    retry: null,
    streaming: { ...idleStreamState },
    turns: [],
  });

  const msgLocation = new Map<string, MsgLocation>();

  function indexMessage(msgId: string, turnIdx: number, msgIdx: number, inSummary: boolean): void {
    msgLocation.set(msgId, { inSummary, msgIdx, turnIdx });
  }

  function reindexAll(): void {
    msgLocation.clear();
    for (let t = 0; t < store.turns.length; t++) {
      const turn = store.turns[t]!;
      for (let m = 0; m < turn.intermediates.length; m++) {
        indexMessage(turn.intermediates[m]!.id, t, m, false);
      }
      if (turn.summary) {
        indexMessage(turn.summary.id, t, 0, true);
      }
    }
  }

  function findMsg(msgId: string): MsgLocation | undefined {
    return msgLocation.get(msgId);
  }

  function getMsg(loc: MsgLocation): UIMessage | undefined {
    const turn = store.turns[loc.turnIdx];
    if (!turn) return undefined;
    return loc.inSummary ? (turn.summary ?? undefined) : turn.intermediates[loc.msgIdx];
  }

  /** Mutate a message in-place via produce(). */
  function mutateMsg(loc: MsgLocation, fn: (msg: UIMessage) => void): void {
    if (loc.inSummary) {
      // summary is UIMessage | null at the type level, but mutateMsg is only
      // reached after getMsg() confirmed the message exists.
      setStore(
        "turns",
        loc.turnIdx,
        "summary",
        produce((m: UIMessage | null) => {
          if (m) {
            fn(m);
          }
        }),
      );
    } else {
      setStore("turns", loc.turnIdx, "intermediates", loc.msgIdx, produce(fn));
    }
  }

  /** Replace the parts array on a message. */
  function setMsgParts(loc: MsgLocation, fn: (prev: MessagePart[]) => MessagePart[]): void {
    if (loc.inSummary) {
      setStore("turns", loc.turnIdx, "summary", "parts", fn);
    } else {
      setStore("turns", loc.turnIdx, "intermediates", loc.msgIdx, "parts", fn);
    }
  }

  /** Set a single field on a message. */
  function setMsgField<K extends keyof UIMessage>(
    loc: MsgLocation,
    field: K,
    value: UIMessage[K],
  ): void {
    if (loc.inSummary) {
      setStore("turns", loc.turnIdx, "summary", field, value);
    } else {
      setStore("turns", loc.turnIdx, "intermediates", loc.msgIdx, field, value);
    }
  }

  const actions: SessionActions = {
    startTurn(userMessage, startedAt) {
      const turn: Turn = {
        endedAt: null,
        error: null,
        id: crypto.randomUUID(),
        intermediateCount: 0,
        intermediates: [],
        intermediatesLoaded: false,
        loadedMessageIds: [],
        summary: null,
        startedAt: startedAt ?? Date.now(),
        turnId: null,
        userMessage,
        working: true,
      };
      setStore("turns", (prev) => [...prev, turn]);
    },

    addAssistantMessage(msg) {
      const turnIdx = store.turns.length - 1;
      if (turnIdx < 0) {
        return;
      }

      // Demote current summary into intermediates and set the new summary in a
      // single produce(). Doing this outside produce (capturing turn.summary
      // into a local) captures a live store proxy bound to the summary slot, so
      // reassigning summary afterwards crosses the values. produce lets us read
      // the current summary value and reassign atomically.
      setStore(
        "turns",
        turnIdx,
        produce((t: Turn) => {
          if (t.summary) {
            t.intermediates.push(t.summary);
          }
          t.summary = msg;
        }),
      );

      // Reindex this turn's messages (ids/positions may have shifted).
      const turn = store.turns[turnIdx]!;
      for (let m = 0; m < turn.intermediates.length; m++) {
        indexMessage(turn.intermediates[m]!.id, turnIdx, m, false);
      }
      if (turn.summary) {
        indexMessage(turn.summary.id, turnIdx, 0, true);
      }

      setStore("streaming", "currentMessageId", msg.id);
      setStore("streaming", "phase", "writing");
    },

    appendTextToken(msgId, delta) {
      const loc = findMsg(msgId);
      if (!loc || !getMsg(loc)) {
        return;
      }
      mutateMsg(loc, (m) => {
        m.content += delta;
        const parts = m.parts;
        const last = parts[parts.length - 1];
        if (last !== undefined && last.type === "text") {
          last.text += delta;
        } else if (last !== undefined) {
          if (last.type === "thinking" && last.endedAt === undefined) {
            last.endedAt = Date.now();
          }
          last.isStreaming = false;
          parts.push({ type: "text", text: delta, isStreaming: true });
        } else {
          parts.push({ type: "text", text: delta, isStreaming: true });
        }
      });
      setStore("streaming", "tokenCount", (n: number) => n + 1);
    },

    appendThinkingToken(msgId, delta) {
      const loc = findMsg(msgId);
      if (!loc || !getMsg(loc)) {
        return;
      }
      // Mutate in place so the thinking part reference stays stable across
      // streaming tokens — the timeline keys steps by part reference and would
      // remount (replaying Markdown animation) if a new object were created
      // on every token.
      mutateMsg(loc, (m) => {
        const parts = m.parts;
        const last = parts[parts.length - 1];
        if (last !== undefined && last.type === "thinking") {
          last.text += delta;
          return;
        }
        // last is not a thinking part (or undefined): finalize it and append a
        // fresh thinking part.
        if (last !== undefined) {
          last.isStreaming = false;
        }
        parts.push({
          type: "thinking",
          text: delta,
          startedAt: Date.now(),
          isStreaming: true,
        });
      });
    },

    addToolCall(msgId, toolCallId, toolName, input) {
      const loc = findMsg(msgId);
      if (!loc || !getMsg(loc)) {
        return;
      }
      const part: MessagePart = {
        type: "tool_call",
        input,
        isStreaming: true,
        status: "running",
        toolCallId,
        toolName,
      };
      // Mutate in place: finalize the previous part on its existing reference
      // and push the new tool_call, so earlier parts keep stable identity.
      mutateMsg(loc, (m) => {
        const parts = m.parts;
        const last = parts[parts.length - 1];
        if (last !== undefined) {
          if (last.type === "thinking" && last.endedAt === undefined) {
            last.endedAt = Date.now();
          }
          last.isStreaming = false;
        }
        parts.push(part);
      });
      setStore("streaming", "currentToolName", toolName);
      setStore("streaming", "phase", "tool_running");
    },

    completeToolCall(msgId, toolCallId, result, isError, details) {
      const loc = findMsg(msgId);
      if (!loc || !getMsg(loc)) {
        return;
      }
      const isErr = isError ?? false;
      // Mutate the matching tool_call part in place so its reference stays
      // stable — the timeline keys steps by part reference and would remount
      // (flickering the ToolSummaryRow) if completion produced a new object.
      mutateMsg(loc, (m) => {
        for (const part of m.parts) {
          if (part.type === "tool_call" && part.toolCallId === toolCallId) {
            part.status = isErr ? "error" : "done";
            part.result = result;
            part.isStreaming = false;
            if (details !== undefined) {
              part.details = details;
            }
          }
        }
      });
      setStore("streaming", "currentToolName", null);
    },

    addOmMarker(msgId, marker) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      setMsgParts(loc, (prev) => {
        if (prev.some((p) => p.type === "om_marker" && p.cycleId === marker.cycleId)) {
          return prev;
        }
        return [...prev, { type: "om_marker", ...marker } as MessagePart];
      });
    },

    updateOmMarker(msgId, cycleId, updates) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      setMsgParts(loc, (prev) => {
        const idx = prev.findIndex((p) => p.type === "om_marker" && p.cycleId === cycleId);
        if (idx < 0) {
          return prev;
        }
        const existing = prev[idx]!;
        return [
          ...prev.slice(0, idx),
          { ...existing, ...updates, type: "om_marker" } as MessagePart,
          ...prev.slice(idx + 1),
        ];
      });
    },

    finalizeMessage(msgId, usage) {
      const loc = findMsg(msgId);
      if (!loc || !getMsg(loc)) {
        return;
      }
      // Mutate the trailing part in place so its reference stays stable —
      // finalizing must not remount the last step (which would replay Markdown's
      // mount animation for a trailing text part). `isStreaming` lives on every
      // MessagePart variant via the `{ isStreaming?: boolean }` intersection.
      mutateMsg(loc, (m) => {
        const last = m.parts[m.parts.length - 1];
        if (last !== undefined) {
          if (last.type === "thinking" && last.endedAt === undefined) {
            last.endedAt = Date.now();
          }
          last.isStreaming = false;
        }
      });
      setMsgField(loc, "isStreaming", false);
      if (usage !== undefined) {
        setMsgField(loc, "usage", usage);
      }
    },

    finalizeTurn(endedAt) {
      const turnIdx = store.turns.length - 1;
      if (turnIdx < 0) {
        return;
      }
      const turn = store.turns[turnIdx]!;
      if (turn.endedAt !== null) {
        return;
      }
      setStore("turns", turnIdx, "endedAt", endedAt);
      setStore("turns", turnIdx, "working", false);
    },

    setError(msgId, error) {
      const loc = findMsg(msgId);
      if (loc) {
        setMsgField(loc, "error", error);
      }
      setStore("streaming", "phase", "error");
    },

    setPhase(phase) {
      setStore("streaming", "phase", phase);
    },

    setPendingAsk(ask) {
      setStore("pendingAsk", ask);
    },

    clearPendingAsk() {
      setStore("pendingAsk", null);
    },

    setPermission(permission) {
      setStore("permission", permission);
    },

    setRetry(retry) {
      setStore("retry", retry);
    },

    clearCurrentMessage() {
      setStore("streaming", "currentMessageId", null);
    },

    getCurrentMessageId() {
      return store.streaming.currentMessageId;
    },

    getLastAssistantMessageId() {
      for (let t = store.turns.length - 1; t >= 0; t--) {
        const turn = store.turns[t]!;
        if (turn.summary) {
          return turn.summary.id;
        }
        const lastIntermediate = turn.intermediates.at(-1);
        if (lastIntermediate) {
          return lastIntermediate.id;
        }
      }
      return null;
    },

    setContent(msgId, content) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      setMsgField(loc, "content", content);
    },

    setCurrentMessage(msgId) {
      setStore("streaming", "currentMessageId", msgId);
    },

    setCurrentTool(toolName: string) {
      setStore("streaming", "currentToolName", toolName);
    },

    clearCurrentTool() {
      setStore("streaming", "currentToolName", null);
    },

    updateOmStatus(status) {
      setStore("omStatus", status);
    },

    wasLastUserMessage(text) {
      const lastTurn = store.turns.at(-1);
      if (!lastTurn?.userMessage) {
        return false;
      }
      return lastTurn.userMessage.content === text;
    },

    loadTurns(turns) {
      setStore("turns", reconcile(turns));
      reindexAll();
    },

    loadIntermediates(turnId, messages) {
      const turnIdx = store.turns.findIndex((t) => t.turnId === turnId);
      if (turnIdx < 0) {
        return;
      }

      const ids = messages.map((m) => m.id);
      setStore("turns", turnIdx, "intermediates", messages);

      // Re-index this turn
      const turn = store.turns[turnIdx]!;
      for (let m = 0; m < turn.intermediates.length; m++) {
        indexMessage(turn.intermediates[m]!.id, turnIdx, m, false);
      }
      if (turn.summary) {
        indexMessage(turn.summary.id, turnIdx, 0, true);
      }

      setStore("turns", turnIdx, "intermediatesLoaded", true);
      setStore("turns", turnIdx, "loadedMessageIds", ids);
    },

    evictIntermediates(turnId) {
      const turnIdx = store.turns.findIndex((t) => t.turnId === turnId);
      if (turnIdx < 0) {
        return;
      }
      const turn = store.turns[turnIdx]!;
      if (turn.loadedMessageIds.length === 0) {
        return;
      }

      // Clean up evicted ids from location map
      for (const id of turn.loadedMessageIds) {
        msgLocation.delete(id);
      }

      setStore("turns", turnIdx, "intermediates", []);

      setStore("turns", turnIdx, "intermediatesLoaded", false);
      setStore("turns", turnIdx, "loadedMessageIds", []);
    },

    loadTurnTimings(timings) {
      // Backfill timings onto live turns (turnId === null) from oldest to newest.
      let timingIdx = 0;
      for (let i = 0; i < store.turns.length; i++) {
        if (store.turns[i]!.turnId !== null) {
          continue;
        }
        if (timingIdx >= timings.length) {
          break;
        }
        const timing = timings[timingIdx];
        if (timing) {
          setStore("turns", i, "startedAt", timing.startedAt);
          setStore("turns", i, "endedAt", timing.endedAt);
        }
        timingIdx++;
      }
    },

    reset() {
      setStore(
        produce((s) => {
          s.turns = [];
          s.pendingAsk = null;
          s.permission = null;
          s.retry = null;
          s.streaming = { ...idleStreamState };
          s.omStatus = null;
        }),
      );
      msgLocation.clear();
    },
  };

  return { store, actions, setStore };
}
