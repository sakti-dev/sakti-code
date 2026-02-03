/**
 * Chat Store
 *
 * High-performance state management using Solid stores.
 * Uses createStore + produce for O(1) streaming updates instead of O(N) array reconciliation.
 *
 * Critical for handling 50-100 tokens/sec streaming without UI lag.
 */
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import type { ChatState, ChatStatus, ChatUIMessage, RLMStateData } from "../../types/ui-message";

/**
 * Create a chat store with optimized update patterns
 *
 * @param initialMessages - Optional initial messages for the conversation
 * @returns Object with store accessors and update methods
 *
 * @example
 * ```ts
 * const chatStore = createChatStore();
 *
 * // Add user message
 * chatStore.addMessage({ id: "1", role: "user", parts: [{ type: "text", text: "Hello" }] });
 *
 * // Stream text delta (O(1) operation)
 * chatStore.appendTextDelta("msg_2", "token ");
 * ```
 */
export function createChatStore(initialMessages: ChatUIMessage[] = []) {
  const [store, setStore] = createStore<ChatState>({
    messages: initialMessages,
    status: "idle",
    error: null,
    rlmState: null,
    sessionId: null,
  });

  return {
    /**
     * Get the current store state (reactive)
     */
    get: () => store,

    /**
     * Add a new message to the store
     * Uses structuredClone to break reference to incoming data
     */
    addMessage(message: ChatUIMessage) {
      // Clone to avoid mutation issues with streaming updates
      setStore("messages", messages => [...messages, structuredClone(message)]);
    },

    /**
     * Update a specific message using produce for O(1) updates
     * Critical for streaming - doesn't trigger list reconciliation
     */
    updateMessage(messageId: string, updater: (message: ChatUIMessage) => void) {
      setStore("messages", m => m.id === messageId, produce(updater));
    },

    /**
     * Append text delta to a message's text part
     * O(1) operation - only updates the specific text part
     *
     * This is the most frequently called method during streaming.
     * At 50-100 tokens/sec, this must be extremely efficient.
     */
    appendTextDelta(messageId: string, delta: string) {
      setStore(
        "messages",
        m => m.id === messageId,
        produce(message => {
          // Find the text part (should be the first one for assistant messages)
          const textPart = message.parts.find(p => p.type === "text");
          if (textPart && textPart.type === "text") {
            textPart.text += delta;
          }
        })
      );
    },

    /**
     * Add a tool call part to a message
     */
    addToolCall(
      messageId: string,
      toolCall: { toolCallId: string; toolName: string; args: unknown }
    ) {
      setStore(
        "messages",
        m => m.id === messageId,
        produce(message => {
          message.parts.push({
            type: "tool-call",
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            args: toolCall.args,
          } as unknown as (typeof message.parts)[number]);
        })
      );
    },

    /**
     * Update tool call args (for streaming tool input)
     */
    updateToolCall(messageId: string, toolCallId: string, args: unknown) {
      setStore(
        "messages",
        m => m.id === messageId,
        produce(message => {
          const part = message.parts.find(
            p => p.type === "tool-call" && (p as { toolCallId?: string }).toolCallId === toolCallId
          );
          if (part && part.type === "tool-call") {
            (part as { args?: unknown }).args = args;
          }
        })
      );
    },

    /**
     * Add tool result to a message
     */
    addToolResult(messageId: string, toolResult: { toolCallId: string; result: unknown }) {
      setStore(
        "messages",
        m => m.id === messageId,
        produce(message => {
          message.parts.push({
            type: "tool-result",
            toolCallId: toolResult.toolCallId,
            result: toolResult.result,
          } as unknown as (typeof message.parts)[number]);
        })
      );
    },

    /**
     * Update or add a data part with stable ID
     *
     * Data parts with the same ID get updated instead of added.
     * This is used for RLM state, progress updates, etc.
     */
    updateDataPart<T>(
      messageId: string,
      partType: string,
      partId: string,
      data: T,
      transient = false
    ) {
      setStore(
        "messages",
        m => m.id === messageId,
        produce(message => {
          // Find existing part with same type and ID
          const existingIndex = message.parts.findIndex(
            p => p.type === partType && (p as { id?: string }).id === partId
          );

          const newPart = {
            type: partType,
            id: partId,
            data,
            transient,
          } as unknown as (typeof message.parts)[number];

          if (existingIndex >= 0) {
            // Update existing
            message.parts[existingIndex] = newPart;
          } else {
            // Add new
            message.parts.push(newPart);
          }
        })
      );
    },

    /**
     * Replace all messages (for history load/regenerate)
     * Uses reconcile for efficient diff-based update by ID
     */
    setMessages(messages: ChatUIMessage[]) {
      setStore("messages", reconcile(messages, { key: "id" }));
    },

    /**
     * Set connection status
     */
    setStatus(status: ChatStatus) {
      setStore("status", status);
    },

    /**
     * Set error
     */
    setError(error: Error | null) {
      setStore("error", error);
    },

    /**
     * Update RLM state (extracted from data parts for easy access)
     */
    setRLMState(state: RLMStateData | null) {
      setStore("rlmState", state);
    },

    /**
     * Set session ID
     */
    setSessionId(sessionId: string | null) {
      setStore("sessionId", sessionId);
    },

    /**
     * Clear all messages and reset state
     */
    clear() {
      setStore({
        messages: [],
        status: "idle",
        error: null,
        rlmState: null,
        // Keep sessionId for continuity
      });
    },

    /**
     * Get messages ready for network transmission
     * Removes Solid proxies using unwrap
     *
     * Call this only when sending to server, not on every update.
     */
    getMessagesForNetwork(): ChatUIMessage[] {
      return unwrap(store.messages);
    },

    /**
     * Get the last message (for finish callbacks)
     */
    getLastMessage(): ChatUIMessage | undefined {
      const messages = store.messages;
      return messages[messages.length - 1];
    },
  };
}

/**
 * Type for the chat store return value
 */
export type ChatStore = ReturnType<typeof createChatStore>;
