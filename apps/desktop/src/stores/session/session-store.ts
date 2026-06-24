import { createStore, produce, reconcile } from "solid-js/store";
import {
  idleStreamState,
  type MessagePart,
  type StreamState,
  type TurnTiming,
  type UIMessage,
} from "../types.ts";

export interface ProposedSession {
  message: string;
  title: string;
}

export interface SessionStoreData {
  messageOrder: string[];
  messages: Record<string, UIMessage>;
  proposedSession: ProposedSession | null;
  streaming: StreamState;
  turnTimings: TurnTiming[];
}

export interface SessionActions {
  addMessage: (msg: UIMessage) => void;
  addToolCall: (
    msgId: string,
    toolCallId: string,
    toolName: string,
    input: unknown
  ) => void;
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
    details?: unknown
  ) => void;
  finalizeMessage: (msgId: string) => void;
  finalizeTurn: (endedAt: number) => void;
  getCurrentMessageId: () => string | null;
  loadMessages: (msgs: UIMessage[]) => void;
  loadTurnTimings: (timings: TurnTiming[]) => void;
  reset: () => void;
  setContent: (msgId: string, content: string) => void;
  setCurrentMessage: (msgId: string) => void;
  setCurrentTool: (toolName: string) => void;
  setError: (msgId: string, error: string) => void;
  setPhase: (phase: StreamState["phase"]) => void;
  setProposedSession: (proposal: ProposedSession) => void;
  startTurn: (startedAt: number) => void;
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
    streaming: { ...idleStreamState },
    turnTimings: [],
  });

  const actions: SessionActions = {
    addMessage(msg) {
      setStore("messages", msg.id, msg);
      setStore("messageOrder", (prev) => [...prev, msg.id]);
    },

    loadMessages(msgs) {
      const newMessages: Record<string, UIMessage> = {};
      for (const msg of msgs) {
        newMessages[msg.id] = msg;
      }
      setStore("messages", reconcile(newMessages));
      setStore(
        "messageOrder",
        msgs.map((m) => m.id)
      );
    },

    appendToken(msgId, delta) {
      setStore("messages", msgId, "content", (prev) => prev + delta);
      setStore("messages", msgId, "parts", (prev) => {
        const last = prev.at(-1);
        if (last !== undefined && last.type === "thinking") {
          const finalized: MessagePart = {
            ...last,
            endedAt: Date.now(),
            isStreaming: false,
          };
          return [
            ...prev.slice(0, -1),
            finalized,
            { type: "text" as const, text: delta, isStreaming: true },
          ];
        }
        if (last !== undefined && last.type === "text") {
          return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
        }
        const newPart: MessagePart = {
          type: "text",
          text: delta,
          isStreaming: true,
        };
        if (last !== undefined) {
          return [
            ...prev.slice(0, -1),
            { ...last, isStreaming: false },
            newPart,
          ];
        }
        return [newPart];
      });
      setStore("streaming", "tokenCount", (n) => n + 1);
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
          return [
            ...prev.slice(0, -1),
            { ...last, isStreaming: false },
            newPart,
          ];
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

    clearProposedSession() {
      setStore("proposedSession", null);
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
          return [
            ...prev.slice(0, -1),
            { ...last, endedAt: Date.now(), isStreaming: false },
            part,
          ];
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
            : p
        )
      );
      setStore("streaming", "currentToolName", null);
    },

    setError(msgId, error) {
      setStore("messages", msgId, "error", error);
      setStore("streaming", "phase", "error");
    },

    finalizeMessage(msgId) {
      setStore("messages", msgId, "parts", (prev) => {
        const last = prev.at(-1);
        if (last === undefined) {
          return prev;
        }
        if (last.type === "thinking" && last.endedAt === undefined) {
          return [
            ...prev.slice(0, -1),
            { ...last, endedAt: Date.now(), isStreaming: false },
          ];
        }
        return [...prev.slice(0, -1), { ...last, isStreaming: false }];
      });
      setStore("messages", msgId, "isStreaming", false);
    },

    startTurn(startedAt) {
      setStore("turnTimings", (prev) => [
        ...prev,
        { startedAt, endedAt: null },
      ]);
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
          s.streaming = { ...idleStreamState };
          s.turnTimings = [];
        })
      );
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
