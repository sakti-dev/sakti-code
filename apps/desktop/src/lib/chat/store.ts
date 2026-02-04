/**
 * Chat Store
 *
 * High-performance state management using Solid stores.
 * Uses normalized data structure (order + byId) for true O(1) streaming updates.
 *
 * Critical for handling 50-100 tokens/sec streaming without UI lag.
 *
 * Data Structure:
 * - messages.order: string[] - ordered list of message IDs for rendering
 * - messages.byId: Record<string, ChatUIMessage> - hash map for O(1) lookups
 *
 * This is the "Antigravity-level" optimization that eliminates the O(N) scan
 * that would occur with setStore("messages", m => m.id === id, ...) on a flat array.
 */
import { createStore, produce, unwrap } from "solid-js/store";
import type {
  AgentEvent,
  ChatEventsState,
  ChatMessagesState,
  ChatReasoningState,
  ChatState,
  ChatStatus,
  ChatUIMessage,
  ReasoningPart,
  RLMStateData,
} from "../../types/ui-message";
import { createLogger } from "../logger";

const logger = createLogger("desktop:store");

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
 * // Stream text delta (O(1) operation via byId lookup)
 * chatStore.appendTextDelta("msg_2", "token ");
 *
 * // Add event (O(1) operation)
 * chatStore.addEvent({ id: "evt_1", ts: Date.now(), kind: "analyzed", title: "Read file.ts" });
 * ```
 */
export function createChatStore(initialMessages: ChatUIMessage[] = []) {
  logger.debug("Creating chat store", { initialMessageCount: initialMessages.length });

  // Convert initial messages to normalized structure
  const initialMessagesState: ChatMessagesState = {
    order: initialMessages.map(m => m.id),
    byId: Object.fromEntries(initialMessages.map(m => [m.id, m])),
  };

  // Initialize empty events store
  const initialEventsState: ChatEventsState = {
    order: [],
    byId: {},
  };

  // Initialize empty reasoning store
  const initialReasoningState: ChatReasoningState = {
    byId: {},
  };

  const [store, setStore] = createStore<ChatState>({
    messages: initialMessagesState,
    events: initialEventsState,
    reasoning: initialReasoningState,
    status: "idle",
    error: null,
    rlmState: null,
    sessionId: null,
    currentMetadata: null,
  });

  return {
    /**
     * Get the current store state (reactive)
     */
    get: () => store,

    /**
     * Get messages as an ordered array (for rendering)
     * Use this for iteration: order.map(id => byId[id])
     */
    getMessagesArray(): ChatUIMessage[] {
      return store.messages.order.map(id => store.messages.byId[id]);
    },

    /**
     * Get a single message by ID (O(1) lookup)
     */
    getMessage(messageId: string): ChatUIMessage | undefined {
      return store.messages.byId[messageId];
    },

    /**
     * Add a new message to the store
     * Uses structuredClone to break reference to incoming data
     */
    addMessage(message: ChatUIMessage) {
      // Clone to avoid mutation issues with streaming updates
      const clonedMessage = structuredClone(message);
      logger.info("[STORE] Adding message", {
        messageId: clonedMessage.id,
        role: clonedMessage.role,
        partsCount: clonedMessage.parts?.length || 0,
        currentMessageCount: store.messages.order.length,
      });

      // Add to byId and append to order in a single batch
      setStore("messages", "byId", clonedMessage.id, clonedMessage);
      setStore("messages", "order", order => [...order, clonedMessage.id]);

      logger.info("[STORE] Message added successfully", {
        messageId: clonedMessage.id,
        newMessageCount: store.messages.order.length,
      });
    },

    /**
     * Update a specific message using produce for O(1) updates
     * True O(1) - direct byId lookup, no array scanning
     */
    updateMessage(messageId: string, updater: (message: ChatUIMessage) => void) {
      setStore("messages", "byId", messageId, produce(updater));
      logger.debug("Message updated", { messageId });
    },

    /**
     * Append text delta to a message's text part
     * TRUE O(1) operation - direct byId lookup + produce
     *
     * This is the most frequently called method during streaming.
     * At 50-100 tokens/sec, this must be extremely efficient.
     */
    appendTextDelta(messageId: string, delta: string) {
      setStore(
        "messages",
        "byId",
        messageId,
        produce(message => {
          // Find the text part (should be the first one for assistant messages)
          const textPart = message.parts.find(p => p.type === "text");
          if (textPart && textPart.type === "text") {
            textPart.text += delta;
          }
        })
      );
      // Skip debug logging for text deltas (too frequent)
      // logger.trace("Text delta appended", { messageId, deltaLength: delta.length });
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
        "byId",
        messageId,
        produce(message => {
          message.parts.push({
            type: "tool-call",
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            args: toolCall.args,
          } as unknown as (typeof message.parts)[number]);
        })
      );
      logger.debug("Tool call added", {
        messageId,
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
      });
    },

    /**
     * Update tool call args (for streaming tool input)
     */
    updateToolCall(messageId: string, toolCallId: string, args: unknown) {
      setStore(
        "messages",
        "byId",
        messageId,
        produce(message => {
          const part = message.parts.find(
            p => p.type === "tool-call" && (p as { toolCallId?: string }).toolCallId === toolCallId
          );
          if (part && part.type === "tool-call") {
            (part as { args?: unknown }).args = args;
          }
        })
      );
      logger.debug("Tool call updated", { messageId, toolCallId });
    },

    /**
     * Add tool result to a message
     */
    addToolResult(messageId: string, toolResult: { toolCallId: string; result: unknown }) {
      setStore(
        "messages",
        "byId",
        messageId,
        produce(message => {
          message.parts.push({
            type: "tool-result",
            toolCallId: toolResult.toolCallId,
            result: toolResult.result,
          } as unknown as (typeof message.parts)[number]);
        })
      );
      logger.debug("Tool result added", { messageId, toolCallId: toolResult.toolCallId });
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
        "byId",
        messageId,
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
      logger.debug("Data part updated", { messageId, partType, partId, transient });
    },

    /**
     * Replace all messages (for history load/regenerate)
     * Converts array to normalized structure
     */
    setMessages(messages: ChatUIMessage[]) {
      const normalizedMessages: ChatMessagesState = {
        order: messages.map(m => m.id),
        byId: Object.fromEntries(messages.map(m => [m.id, m])),
      };
      setStore("messages", normalizedMessages);
      logger.info("Messages replaced", { count: messages.length });
    },

    /**
     * Set connection status
     */
    setStatus(status: ChatStatus) {
      const previous = store.status;
      setStore("status", status);
      if (previous !== status) {
        logger.debug("Status changed", { from: previous, to: status });
      }
    },

    /**
     * Set error
     */
    setError(error: Error | null) {
      setStore("error", error);
      if (error) {
        logger.error("Chat error set", error);
      } else {
        logger.debug("Error cleared");
      }
    },

    /**
     * Update RLM state (extracted from data parts for easy access)
     */
    setRLMState(state: RLMStateData | null) {
      setStore("rlmState", state);
      if (state) {
        logger.debug("RLM state updated", { phase: state.phase, step: state.step });
      } else {
        logger.debug("RLM state cleared");
      }
    },

    /**
     * Set session ID
     */
    setSessionId(sessionId: string | null) {
      const previous = store.sessionId;
      setStore("sessionId", sessionId);
      if (previous !== sessionId) {
        logger.info("Session ID changed", { from: previous, to: sessionId });
      }
    },

    // =========================================================================
    // Event Store Methods (O(1) operations for activity feed)
    // =========================================================================

    /**
     * Add an event to the store (O(1))
     */
    addEvent(event: AgentEvent) {
      setStore("events", "byId", event.id, event);
      setStore("events", "order", order => [...order, event.id]);
      logger.debug("Event added", { eventId: event.id, kind: event.kind });
    },

    /**
     * Update an existing event (O(1))
     */
    updateEvent(eventId: string, updater: (event: AgentEvent) => void) {
      setStore("events", "byId", eventId, produce(updater));
    },

    /**
     * Get events as an ordered array (for rendering)
     */
    getEventsArray(): AgentEvent[] {
      return store.events.order.map(id => store.events.byId[id]);
    },

    /**
     * Get a single event by ID (O(1))
     */
    getEvent(eventId: string): AgentEvent | undefined {
      return store.events.byId[eventId];
    },

    /**
     * Clear all events (called at start of new message)
     */
    clearEvents() {
      setStore("events", { order: [], byId: {} });
      logger.debug("Events cleared");
    },

    // =========================================================================
    // Reasoning Store Methods (O(1) operations for thinking display)
    // =========================================================================

    /**
     * Start a reasoning part (O(1))
     */
    startReasoning(id: string) {
      const part: ReasoningPart = {
        id,
        text: "",
        time: { start: Date.now() },
      };
      setStore("reasoning", "byId", id, part);
      logger.debug("Reasoning started", { reasoningId: id });
    },

    /**
     * Append reasoning delta (O(1))
     */
    appendReasoningDelta(id: string, delta: string) {
      setStore(
        "reasoning",
        "byId",
        id,
        produce(part => {
          if (part) {
            part.text += delta;
          }
        })
      );
    },

    /**
     * End reasoning part (O(1))
     */
    endReasoning(id: string) {
      setStore(
        "reasoning",
        "byId",
        id,
        produce(part => {
          if (part) {
            part.time.end = Date.now();
          }
        })
      );
      logger.debug("Reasoning ended", {
        reasoningId: id,
        durationMs: store.reasoning.byId[id]?.time.end
          ? store.reasoning.byId[id].time.end! - store.reasoning.byId[id].time.start
          : 0,
      });
    },

    /**
     * Get a reasoning part by ID (O(1))
     */
    getReasoning(id: string): ReasoningPart | undefined {
      return store.reasoning.byId[id];
    },

    /**
     * Get all active reasoning parts
     */
    getActiveReasoningParts(): ReasoningPart[] {
      return Object.values(store.reasoning.byId).filter(p => !p.time.end);
    },

    /**
     * Clear all reasoning parts
     */
    clearReasoning() {
      setStore("reasoning", { byId: {} });
    },

    /**
     * Clear all messages and reset state
     */
    clear() {
      setStore({
        messages: { order: [], byId: {} },
        events: { order: [], byId: {} },
        reasoning: { byId: {} },
        status: "idle",
        error: null,
        rlmState: null,
        currentMetadata: null,
        // Keep sessionId for continuity
      });
      logger.info("Chat store cleared");
    },

    /**
     * Get messages ready for network transmission
     * Converts normalized structure back to array and removes Solid proxies
     *
     * Call this only when sending to server, not on every update.
     */
    getMessagesForNetwork(): ChatUIMessage[] {
      const { order, byId } = unwrap(store.messages);
      const messages = order.map(id => byId[id]);
      logger.debug("Preparing messages for network", { count: messages.length });
      return messages;
    },

    /**
     * Get the last message (for finish callbacks)
     */
    getLastMessage(): ChatUIMessage | undefined {
      const { order, byId } = store.messages;
      if (order.length === 0) return undefined;
      const lastId = order[order.length - 1];
      return byId[lastId];
    },

    /**
     * Get message count
     */
    getMessageCount(): number {
      return store.messages.order.length;
    },
  };
}

/**
 * Type for the chat store return value
 */
export type ChatStore = ReturnType<typeof createChatStore>;
