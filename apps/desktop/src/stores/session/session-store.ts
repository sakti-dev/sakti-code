import { createStore, produce, reconcile } from "solid-js/store";
import {
  idleStreamState,
  type MessagePart,
  type StreamState,
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
}

export interface SessionActions {
  addMessage: (msg: UIMessage) => void;
  addToolCall: (
    msgId: string,
    toolCallId: string,
    toolName: string,
    input: unknown
  ) => void;
  appendToken: (msgId: string, delta: string) => void;
  clearCurrentMessage: () => void;
  clearCurrentTool: () => void;
  clearProposedSession: () => void;
  completeToolCall: (
    msgId: string,
    toolCallId: string,
    result: string,
    isError?: boolean
  ) => void;
  finalizeMessage: (msgId: string) => void;
  getCurrentMessageId: () => string | null;
  loadMessages: (msgs: UIMessage[]) => void;
  reset: () => void;
  setContent: (msgId: string, content: string) => void;
  setCurrentMessage: (msgId: string) => void;
  setCurrentTool: (toolName: string) => void;
  setError: (msgId: string, error: string) => void;
  setPhase: (phase: StreamState["phase"]) => void;
  setProposedSession: (proposal: ProposedSession) => void;
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
        if (last !== undefined && last.type === "text") {
          return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
        }
        return [...prev, { type: "text" as const, text: delta }];
      });
      setStore("streaming", "tokenCount", (n) => n + 1);
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
      };
      setStore("messages", msgId, "parts", (prev) => [...prev, part]);
      setStore("streaming", "currentToolName", toolName);
      setStore("streaming", "phase", "tool_running");
    },

    completeToolCall(msgId, toolCallId, result, isError = false) {
      setStore("messages", msgId, "parts", (prev) =>
        prev.map((p) =>
          p.type === "tool_call" && p.toolCallId === toolCallId
            ? {
                ...p,
                status: isError ? ("error" as const) : ("done" as const),
                result,
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
      setStore("messages", msgId, "isStreaming", false);
    },

    reset() {
      setStore(
        produce((s) => {
          s.messages = {};
          s.messageOrder = [];
          s.proposedSession = null;
          s.streaming = { ...idleStreamState };
        })
      );
    },
  };

  return { store, actions };
}
