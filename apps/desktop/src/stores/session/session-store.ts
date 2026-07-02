import { createStore, produce, reconcile } from "solid-js/store";
import {
  idleStreamState,
  type MessagePart,
  type OmWindowState,
  type RetryState,
  type StreamState,
  type TurnTiming,
  type UIMessage,
} from "../types.ts";

export interface ProposedSession {
  message: string;
  title: string;
}

/** A pending permission request awaiting the user's allow/always/deny. */
export interface PermissionPending {
  id: string;
  patterns: string[];
  permission: string;
  toolCallId: string;
  toolName: string;
}

export interface SessionStoreData {
  messageOrder: string[];
  messages: Record<string, UIMessage>;
  /** Active permission approval state; `null` when no approval is pending. */
  permission: PermissionPending | null;
  proposedSession: ProposedSession | null;
  /** Active retry banner state; `null` when no retry is in progress. */
  retry: RetryState | null;
  streaming: StreamState;
  turnTimings: TurnTiming[];
  /** OM window state for sidebar progress bars; `null` when no OM status received. */
  omStatus: OmWindowState | null;
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

export interface SessionActions {
  addMessage: (msg: UIMessage) => void;
  addCompactionMarker: (msgId: string) => void;
  addOmMarker: (msgId: string, marker: OmMarkerInput) => void;
  addToolCall: (msgId: string, toolCallId: string, toolName: string, input: unknown) => void;
  appendCompactionToken: (msgId: string, delta: string) => void;
  appendThinkingToken: (msgId: string, delta: string) => void;
  appendToken: (msgId: string, delta: string) => void;
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
  finalizeMessage: (msgId: string, usage?: UIMessage["usage"]) => void;
  finalizeTurn: (endedAt: number) => void;
  getCurrentMessageId: () => string | null;
  getLastAssistantMessageId: () => string | null;
  loadMessages: (msgs: UIMessage[]) => void;
  loadTurnTimings: (timings: TurnTiming[]) => void;
  reset: () => void;
  setContent: (msgId: string, content: string) => void;
  setCurrentMessage: (msgId: string) => void;
  setCurrentTool: (toolName: string) => void;
  setError: (msgId: string, error: string) => void;
  /** Set or clear the pending permission approval (null clears it). */
  setPermission: (permission: PermissionPending | null) => void;
  setPhase: (phase: StreamState["phase"]) => void;
  setProposedSession: (proposal: ProposedSession) => void;
  /** Set or clear the retry banner state (null clears it). */
  setRetry: (retry: RetryState | null) => void;
  startTurn: (startedAt: number) => void;
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
  store: SessionStoreData;
}

export function createSessionStore(): SessionStore {
  const [store, setStore] = createStore<SessionStoreData>({
    messages: {},
    messageOrder: [],
    proposedSession: null,
    permission: null,
    retry: null,
    streaming: { ...idleStreamState },
    turnTimings: [],
    omStatus: null,
  });

  const actions: SessionActions = {
    addMessage(msg) {
      setStore("messages", msg.id, msg);
      setStore("messageOrder", (prev) => [...prev, msg.id]);
    },

    addOmMarker(msgId, marker) {
      setStore("messages", msgId, "parts", (prev) => {
        if (prev.some((p) => p.type === "om_marker" && p.cycleId === marker.cycleId)) {
          return prev;
        }
        return [...prev, { type: "om_marker", ...marker } as MessagePart];
      });
    },

    addCompactionMarker(msgId) {
      setStore("messages", msgId, "parts", (prev) => {
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

    loadMessages(msgs) {
      const newMessages: Record<string, UIMessage> = {};
      for (const msg of msgs) {
        newMessages[msg.id] = msg;
      }
      setStore("messages", reconcile(newMessages));
      setStore(
        "messageOrder",
        msgs.map((m) => m.id),
      );
    },

    appendToken(msgId, delta) {
      setStore("messages", msgId, "content", (prev) => prev + delta);

      const parts = store.messages[msgId]?.parts;
      const last = parts?.at(-1);

      if (last !== undefined && last.type === "text") {
        setStore(
          "messages",
          msgId,
          produce((msg: UIMessage) => {
            const d = msg.parts[msg.parts.length - 1];
            if (d !== undefined && d.type === "text") {
              d.text += delta;
            }
          }),
        );
      } else if (last !== undefined && last.type === "thinking") {
        const finalized: MessagePart = {
          ...last,
          endedAt: Date.now(),
          isStreaming: false,
        };
        setStore("messages", msgId, "parts", (prev) => [
          ...prev.slice(0, -1),
          finalized,
          { type: "text" as const, text: delta, isStreaming: true },
        ]);
      } else if (last !== undefined) {
        setStore("messages", msgId, "parts", (prev) => [
          ...prev.slice(0, -1),
          { ...prev.at(-1)!, isStreaming: false },
          { type: "text" as const, text: delta, isStreaming: true },
        ]);
      } else {
        setStore("messages", msgId, "parts", [
          { type: "text" as const, text: delta, isStreaming: true },
        ]);
      }

      setStore("streaming", "tokenCount", (n) => n + 1);
    },

    appendCompactionToken(msgId, delta) {
      setStore("messages", msgId, "parts", (prev) => {
        const idx = prev.findIndex((p) => p.type === "compaction");
        if (idx < 0) return prev;
        const existing = prev[idx] as Extract<MessagePart, { type: "compaction" }>;
        return [
          ...prev.slice(0, idx),
          { ...existing, text: existing.text + delta } as MessagePart,
          ...prev.slice(idx + 1),
        ];
      });
    },

    appendThinkingToken(msgId, delta) {
      setStore("messages", msgId, "parts", (prev) => {
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

    setContent(msgId, content) {
      setStore("messages", msgId, "content", content);
    },

    setPhase(phase) {
      setStore("streaming", "phase", phase);
    },

    setProposedSession(proposal) {
      setStore("proposedSession", proposal);
    },

    setPermission(permission) {
      setStore("permission", permission);
    },

    clearProposedSession() {
      setStore("proposedSession", null);
    },

    setRetry(retry) {
      setStore("retry", retry);
    },

    setCurrentMessage(msgId) {
      setStore("streaming", "currentMessageId", msgId);
    },

    clearCurrentMessage() {
      setStore("streaming", "currentMessageId", null);
    },

    getCurrentMessageId() {
      return store.streaming.currentMessageId;
    },

    getLastAssistantMessageId() {
      for (let i = store.messageOrder.length - 1; i >= 0; i--) {
        const id = store.messageOrder[i]!;
        if (store.messages[id]?.role === "assistant") return id;
      }
      return null;
    },

    setCurrentTool(toolName) {
      setStore("streaming", "currentToolName", toolName);
    },

    clearCurrentTool() {
      setStore("streaming", "currentToolName", null);
    },

    addToolCall(msgId, toolCallId, toolName, input) {
      const part: MessagePart = {
        type: "tool_call",
        toolCallId,
        toolName,
        input,
        status: "running",
        isStreaming: true,
      };
      setStore("messages", msgId, "parts", (prev) => {
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
      const isErr = isError ?? false;
      setStore("messages", msgId, "parts", (prev) =>
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

    setError(msgId, error) {
      setStore("messages", msgId, "error", error);
      setStore("streaming", "phase", "error");
    },

    finalizeMessage(msgId, usage) {
      setStore("messages", msgId, "parts", (prev) => {
        const last = prev.at(-1);
        if (last === undefined) {
          return prev;
        }
        if (last.type === "thinking" && last.endedAt === undefined) {
          return [...prev.slice(0, -1), { ...last, endedAt: Date.now(), isStreaming: false }];
        }
        return [...prev.slice(0, -1), { ...last, isStreaming: false }];
      });
      setStore("messages", msgId, "isStreaming", false);
      // Persist provider usage (tokens/cost) so the session-stats aggregate is
      // available live, not only after a reload. The agent's message_end event
      // carries the final AssistantMessage with usage; the reducer extracts it.
      if (usage !== undefined) {
        setStore("messages", msgId, "usage", usage);
      }
    },

    startTurn(startedAt) {
      setStore("turnTimings", (prev) => [...prev, { startedAt, endedAt: null }]);
    },

    finalizeTurn(endedAt) {
      setStore("turnTimings", (prev) => {
        const last = prev.at(-1);
        if (last === undefined || last.endedAt !== null) {
          return prev;
        }
        return [...prev.slice(0, -1), { ...last, endedAt }];
      });
    },

    loadTurnTimings(timings) {
      setStore("turnTimings", timings);
    },

    reset() {
      setStore(
        produce((s) => {
          s.messages = {};
          s.messageOrder = [];
          s.proposedSession = null;
          s.permission = null;
          s.retry = null;
          s.streaming = { ...idleStreamState };
          s.omStatus = null;
        }),
      );
    },

    updateOmMarker(msgId, cycleId, updates) {
      setStore("messages", msgId, "parts", (prev) => {
        const idx = prev.findIndex((p) => p.type === "om_marker" && p.cycleId === cycleId);
        if (idx < 0) return prev;
        const existing = prev[idx]!;
        return [
          ...prev.slice(0, idx),
          { ...existing, ...updates, type: "om_marker" } as MessagePart,
          ...prev.slice(idx + 1),
        ];
      });
    },

    updateCompactionMarker(msgId, updates) {
      setStore("messages", msgId, "parts", (prev) => {
        const idx = prev.findIndex((p) => p.type === "compaction");
        if (idx < 0) return prev;
        const existing = prev[idx] as Extract<MessagePart, { type: "compaction" }>;
        return [
          ...prev.slice(0, idx),
          { ...existing, ...updates, type: "compaction" } as MessagePart,
          ...prev.slice(idx + 1),
        ];
      });
    },

    updateOmStatus(status) {
      setStore("omStatus", status);
    },

    wasLastUserMessage(text) {
      const lastId = store.messageOrder.at(-1);
      if (!lastId) {
        return false;
      }
      const lastMsg = store.messages[lastId];
      return lastMsg?.role === "user" && lastMsg.content === text;
    },
  };

  return { store, actions };
}
