/**
 * useChat Hook
 *
 * Main chat hook for integrating with the Hono server.
 * Uses correct Solid.js primitives - no React-style dependency arrays.
 *
 * Features:
 * - Streaming chat with AbortController
 * - O(1) message updates via createStore + produce
 * - Session ID management
 * - RLM state tracking
 * - Cleanup on unmount
 */
import { createMemo, onCleanup, type Accessor } from "solid-js";
import { EkacodeApiClient } from "../lib/api-client";
import { createChatStore } from "../lib/chat/store";
import { parseUIMessageStream } from "../lib/chat/stream-parser";
import type { ChatState, ChatStatus, ChatUIMessage, RLMStateData } from "../types/ui-message";

/**
 * Options for useChat hook
 */
export interface UseChatOptions {
  /** API client instance */
  client: EkacodeApiClient;

  /** Workspace directory (reactive accessor) */
  workspace: Accessor<string>;

  /** Initial messages for the conversation */
  initialMessages?: ChatUIMessage[];

  /** Initial session ID (for resuming conversations) */
  initialSessionId?: string;

  /** Called when an error occurs */
  onError?: (error: Error) => void;

  /** Called when a response is complete */
  onFinish?: (message: ChatUIMessage) => void;

  /** Called when RLM state changes during streaming */
  onRLMStateChange?: (state: RLMStateData) => void;

  /** Called when session ID is received from server */
  onSessionIdReceived?: (sessionId: string) => void;
}

/**
 * Result returned by useChat hook
 */
export interface UseChatResult {
  /** The full store state (reactive) */
  store: ChatState;

  /** Messages accessor (reactive) */
  messages: ChatUIMessage[];

  /** Current status accessor */
  status: Accessor<ChatStatus>;

  /** Current error accessor */
  error: Accessor<Error | null>;

  /** Whether currently loading/streaming */
  isLoading: Accessor<boolean>;

  /** Whether user can send a message */
  canSend: Accessor<boolean>;

  /** Current RLM state accessor */
  rlmState: Accessor<RLMStateData | null>;

  /** Current session ID accessor */
  sessionId: Accessor<string | null>;

  /**
   * Send a message to the agent
   * @param text - Message text content
   */
  sendMessage: (text: string) => Promise<void>;

  /** Stop the current generation */
  stop: () => void;

  /** Clear all messages */
  clearMessages: () => void;

  /** Set session ID manually */
  setSessionId: (id: string | null) => void;
}

/**
 * Main chat hook for desktop-agent integration
 *
 * @example
 * ```tsx
 * function Chat() {
 *   const workspace = () => "/path/to/project";
 *   const chat = useChat({ client, workspace });
 *
 *   return (
 *     <div>
 *       <For each={chat.messages}>
 *         {(msg) => <Message message={msg} />}
 *       </For>
 *       <input
 *         onKeyDown={(e) => {
 *           if (e.key === "Enter" && chat.canSend()) {
 *             chat.sendMessage(e.currentTarget.value);
 *           }
 *         }}
 *         disabled={!chat.canSend()}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export function useChat(options: UseChatOptions): UseChatResult {
  const {
    client,
    workspace,
    initialMessages = [],
    initialSessionId,
    onError,
    onFinish,
    onRLMStateChange,
  } = options;

  // Create the chat store
  const chatStore = createChatStore(initialMessages);

  // Set initial session ID if provided
  if (initialSessionId) {
    chatStore.setSessionId(initialSessionId);
  }

  // Abort controller for cancellation
  let abortController: AbortController | null = null;

  // Track current streaming message ID
  let currentMessageId: string | null = null;

  // Cleanup on unmount
  onCleanup(() => {
    abortController?.abort();
  });

  /**
   * Send a message to the agent
   */
  const sendMessage = async (text: string): Promise<void> => {
    // Can't send while already streaming
    if (!canSend()) {
      return;
    }

    // Abort any existing request
    abortController?.abort();
    abortController = new AbortController();

    // Add user message
    const userMessage: ChatUIMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      parts: [{ type: "text", text }],
    };
    chatStore.addMessage(userMessage);

    // Create assistant message placeholder for streaming
    currentMessageId = `msg_${Date.now() + 1}`;
    const assistantMessage: ChatUIMessage = {
      id: currentMessageId,
      role: "assistant",
      parts: [{ type: "text", text: "" }],
    };
    chatStore.addMessage(assistantMessage);
    chatStore.setStatus("connecting");
    chatStore.setError(null);

    try {
      // Make the request
      const response = await client.chat(chatStore.getMessagesForNetwork(), {
        sessionId: chatStore.get().sessionId ?? undefined,
        workspace: workspace(),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check for session ID in response header
      const newSessionId = response.headers.get("X-Session-ID");
      if (newSessionId && newSessionId !== chatStore.get().sessionId) {
        chatStore.setSessionId(newSessionId);
        options.onSessionIdReceived?.(newSessionId);
      }

      chatStore.setStatus("streaming");

      // Parse the stream
      const messageId = currentMessageId;
      await parseUIMessageStream(response, {
        onTextDelta: (_id, delta) => {
          chatStore.appendTextDelta(messageId, delta);
        },

        onToolCallStart: toolCall => {
          chatStore.addToolCall(messageId, {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            args: {},
          });
        },

        onToolCallEnd: (toolCallId, args) => {
          chatStore.updateToolCall(messageId, toolCallId, args);
        },

        onToolResult: result => {
          chatStore.addToolResult(messageId, result);
        },

        onDataPart: (type, id, data, transient) => {
          // Update data part in message
          chatStore.updateDataPart(messageId, type, id, data, transient);

          // Extract RLM state for easy access
          if (type === "data-rlm-state") {
            const rlmState = data as RLMStateData;
            chatStore.setRLMState(rlmState);
            onRLMStateChange?.(rlmState);
          } else if (type === "data-session") {
            const sessionData = data as { sessionId: string };
            chatStore.setSessionId(sessionData.sessionId);
          }
        },

        onError: error => {
          chatStore.setStatus("error");
          chatStore.setError(error);
          onError?.(error);
        },

        onComplete: () => {
          chatStore.setStatus("done");
          chatStore.setRLMState(null);

          const lastMessage = chatStore.getLastMessage();
          if (lastMessage) {
            onFinish?.(lastMessage);
          }
        },
      });
    } catch (error) {
      // Don't report abort as error
      if ((error as Error).name !== "AbortError") {
        chatStore.setStatus("error");
        chatStore.setError(error as Error);
        onError?.(error as Error);
      }
    } finally {
      abortController = null;
      currentMessageId = null;
    }
  };

  /**
   * Stop current generation
   */
  const stop = () => {
    abortController?.abort();
    abortController = null;
    chatStore.setStatus("idle");
  };

  /**
   * Clear all messages
   */
  const clearMessages = () => {
    chatStore.clear();
  };

  /**
   * Set session ID
   */
  const setSessionId = (id: string | null) => {
    chatStore.setSessionId(id);
  };

  // Computed accessors
  const status = () => chatStore.get().status;
  const error = () => chatStore.get().error;

  const isLoading = createMemo(() => {
    const s = status();
    return s === "connecting" || s === "streaming" || s === "processing";
  });

  const canSend = createMemo(() => {
    const s = status();
    return s === "idle" || s === "done" || s === "error";
  });

  const rlmState = () => chatStore.get().rlmState;
  const sessionId = () => chatStore.get().sessionId;

  return {
    store: chatStore.get(),
    messages: chatStore.get().messages,
    status,
    error,
    isLoading,
    canSend,
    rlmState,
    sessionId,
    sendMessage,
    stop,
    clearMessages,
    setSessionId,
  };
}
