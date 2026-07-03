import { createStore, produce, reconcile } from "solid-js/store";
import { createLogger } from "~/lib/utils";
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

const log = createLogger({ module: "session-store" });

export interface ProposedSession {
  message: string;
  title: string;
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
  permission: PermissionPending | null;
  proposedSession: ProposedSession | null;
  retry: RetryState | null;
  streaming: StreamState;
  turns: Turn[];
}

export interface SessionActions {
  addAssistantMessage: (msg: UIMessage) => void;
  addCompactionMarker: (msgId: string) => void;
  addOmMarker: (msgId: string, marker: OmMarkerInput) => void;
  addToolCall: (msgId: string, toolCallId: string, toolName: string, input: unknown) => void;
  appendCompactionToken: (msgId: string, delta: string) => void;
  appendTextToken: (msgId: string, delta: string) => void;
  appendThinkingToken: (msgId: string, delta: string) => void;
  clearCurrentMessage: () => void;
  clearCurrentTool: () => void;
  clearProposedSession: () => void;
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
  setProposedSession: (proposal: ProposedSession) => void;
  setRetry: (retry: RetryState | null) => void;
  startTurn: (userMessage: UIMessage | null, startedAt?: number) => void;
  updateCompactionMarker: (
    msgId: string,
    updates: Partial<Extract<MessagePart, { type: "compaction" }>>,
  ) => void;
  updateOmMarker: (msgId: string, cycleId: string, updates: Partial<OmMarkerInput>) => void;
  updateOmStatus: (status: OmWindowState) => void;
  wasLastUserMessage: (text: string) => boolean;
}

export interface SessionStore {
  actions: SessionActions;
  setStore: ReturnType<typeof createStore<SessionStoreData>>[1];
  store: SessionStoreData;
}

/** O(1) lookup: msgId → location in the turns array. */
interface MsgLocation {
  msgIdx: number;
  turnIdx: number;
}

export function createSessionStore(): SessionStore {
  const [store, setStore] = createStore<SessionStoreData>({
    omStatus: null,
    permission: null,
    proposedSession: null,
    retry: null,
    streaming: { ...idleStreamState },
    turns: [],
  });

  const msgLocation = new Map<string, MsgLocation>();

  function indexMessage(msgId: string, turnIdx: number, msgIdx: number): void {
    msgLocation.set(msgId, { turnIdx, msgIdx });
  }

  function reindexAll(): void {
    msgLocation.clear();
    for (let t = 0; t < store.turns.length; t++) {
      const turn = store.turns[t]!;
      for (let m = 0; m < turn.messages.length; m++) {
        indexMessage(turn.messages[m]!.id, t, m);
      }
    }
  }

  function findMsg(msgId: string): MsgLocation | undefined {
    return msgLocation.get(msgId);
  }

  const actions: SessionActions = {
    startTurn(userMessage, startedAt) {
      const turn: Turn = {
        endedAt: null,
        error: null,
        id: crypto.randomUUID(),
        intermediateCount: 0,
        intermediatesLoaded: false,
        loadedMessageIds: [],
        messages: [],
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
      const msgIdx = store.turns[turnIdx]!.messages.length;
      setStore("turns", turnIdx, "messages", (prev) => [...prev, msg]);
      indexMessage(msg.id, turnIdx, msgIdx);
      setStore("streaming", "currentMessageId", msg.id);
      setStore("streaming", "phase", "writing");
    },

    appendTextToken(msgId, delta) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      const msg = store.turns[loc.turnIdx]?.messages[loc.msgIdx];
      if (!msg) {
        return;
      }
      setStore(
        "turns",
        loc.turnIdx,
        "messages",
        loc.msgIdx,
        produce((m: UIMessage) => {
          m.content += delta;
          const parts = m.parts;
          const last = parts[parts.length - 1];
          if (last !== undefined && last.type === "text") {
            last.text += delta;
          } else if (last !== undefined) {
            last.isStreaming = false;
            parts.push({ type: "text", text: delta, isStreaming: true });
          } else {
            parts.push({ type: "text", text: delta, isStreaming: true });
          }
        }),
      );
      setStore("streaming", "tokenCount", (n: number) => n + 1);
    },

    appendThinkingToken(msgId, delta) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      const msg = store.turns[loc.turnIdx]?.messages[loc.msgIdx];
      if (!msg) {
        return;
      }
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) => {
        const last = prev.at(-1);
        if (last !== undefined && last.type === "thinking") {
          return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
        }
        const newPart: MessagePart = {
          type: "thinking",
          text: delta,
          startedAt: Date.now(),
          isStreaming: true,
        };
        if (last !== undefined) {
          return [...prev.slice(0, -1), { ...last, isStreaming: false }, newPart];
        }
        return [newPart];
      });
    },

    addToolCall(msgId, toolCallId, toolName, input) {
      const loc = findMsg(msgId);
      if (!loc) {
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
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) => {
        const last = prev.at(-1);
        if (last === undefined) {
          return [part];
        }
        if (last.type === "thinking" && last.endedAt === undefined) {
          return [...prev.slice(0, -1), { ...last, endedAt: Date.now(), isStreaming: false }, part];
        }
        return [...prev.slice(0, -1), { ...last, isStreaming: false }, part];
      });
      setStore("streaming", "currentToolName", toolName);
      setStore("streaming", "phase", "tool_running");
    },

    completeToolCall(msgId, toolCallId, result, isError, details) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      const isErr = isError ?? false;
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) =>
        prev.map((p) =>
          p.type === "tool_call" && p.toolCallId === toolCallId
            ? {
                ...p,
                status: isErr ? ("error" as const) : ("done" as const),
                result,
                isStreaming: false,
                ...(details === undefined ? {} : { details }),
              }
            : p,
        ),
      );
      setStore("streaming", "currentToolName", null);
    },

    addCompactionMarker(msgId) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) => {
        if (prev.some((p) => p.type === "compaction")) {
          return prev;
        }
        return [
          ...prev,
          {
            type: "compaction",
            status: "loading",
            text: "",
            startedAt: Date.now(),
          } as MessagePart,
        ];
      });
    },

    appendCompactionToken(msgId, delta) {
      const loc = findMsg(msgId);
      if (!loc) {
        log.debug("appendCompactionToken — msgId not in location index", { msgId });
        return;
      }
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) => {
        const idx = prev.findIndex((p) => p.type === "compaction");
        if (idx < 0) {
          log.debug("appendCompactionToken — no compaction part in message", {
            msgId,
            partCount: prev.length,
            partTypes: prev.map((p) => p.type),
          });
          return prev;
        }
        const existing = prev[idx] as Extract<MessagePart, { type: "compaction" }>;
        return [
          ...prev.slice(0, idx),
          { ...existing, text: existing.text + delta } as MessagePart,
          ...prev.slice(idx + 1),
        ];
      });
    },

    updateCompactionMarker(msgId, updates) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) => {
        const idx = prev.findIndex((p) => p.type === "compaction");
        if (idx < 0) {
          return prev;
        }
        const existing = prev[idx] as Extract<MessagePart, { type: "compaction" }>;
        return [
          ...prev.slice(0, idx),
          { ...existing, ...updates, type: "compaction" } as MessagePart,
          ...prev.slice(idx + 1),
        ];
      });
    },

    addOmMarker(msgId, marker) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) => {
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
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) => {
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
      if (!loc) {
        return;
      }
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "parts", (prev) => {
        const last = prev.at(-1);
        if (last === undefined) {
          return prev;
        }
        if (last.type === "thinking" && last.endedAt === undefined) {
          return [...prev.slice(0, -1), { ...last, endedAt: Date.now(), isStreaming: false }];
        }
        return [...prev.slice(0, -1), { ...last, isStreaming: false }];
      });
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "isStreaming", false);
      if (usage !== undefined) {
        setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "usage", usage);
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
        setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "error", error);
      }
      setStore("streaming", "phase", "error");
    },

    setPhase(phase) {
      setStore("streaming", "phase", phase);
    },

    setProposedSession(proposal) {
      setStore("proposedSession", proposal);
    },

    clearProposedSession() {
      setStore("proposedSession", null);
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
        for (let m = turn.messages.length - 1; m >= 0; m--) {
          if (turn.messages[m]!.role === "assistant") {
            return turn.messages[m]!.id;
          }
        }
      }
      return null;
    },

    setContent(msgId, content) {
      const loc = findMsg(msgId);
      if (!loc) {
        return;
      }
      setStore("turns", loc.turnIdx, "messages", loc.msgIdx, "content", content);
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
      const turn = store.turns[turnIdx]!;
      const ids = messages.map((m) => m.id);

      // Insert before the summary (last message)
      const summaryIdx = turn.messages.length > 0 ? turn.messages.length - 1 : 0;
      setStore("turns", turnIdx, "messages", (prev) => [
        ...prev.slice(0, summaryIdx),
        ...messages,
        ...prev.slice(summaryIdx),
      ]);

      // Re-index this turn's messages
      for (let m = 0; m < store.turns[turnIdx]!.messages.length; m++) {
        indexMessage(store.turns[turnIdx]!.messages[m]!.id, turnIdx, m);
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
      const idsToRemove = new Set(turn.loadedMessageIds);
      setStore("turns", turnIdx, "messages", (prev) => prev.filter((m) => !idsToRemove.has(m.id)));

      // Re-index this turn's messages
      for (let m = 0; m < store.turns[turnIdx]!.messages.length; m++) {
        indexMessage(store.turns[turnIdx]!.messages[m]!.id, turnIdx, m);
      }
      // Clean up evicted ids from location map
      for (const id of idsToRemove) {
        msgLocation.delete(id);
      }

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
          s.proposedSession = null;
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
