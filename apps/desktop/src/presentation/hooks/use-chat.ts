/**
 * useChat Hook
 *
 * Refactored chat hook using Phase 4 domain contexts.
 * Uses provider-scoped stores for retry/delete/copy operations.
 * Uses EkacodeApiClient for sendMessage.
 *
 * Updated for Batch 2: Data Integrity - Server-authoritative session creation
 *
 * @example
 * ```tsx
 * function ChatComponent() {
 *   const sessionId = () => 'session-123';
 *   const chat = useChat({
 *     sessionId,
 *     workspace: () => '/path/to/project',
 *     client: apiClient,
 *   });
 *
 *   return (
 *     <div>
 *       <For each={chat.messages.list()}>
 *         {(message) => <MessageBubble message={message} />}
 *       </For>
 *       <input onKeyPress={(e) => e.key === 'Enter' && chat.sendMessage(e.currentTarget.value)} />
 *     </div>
 *   );
 * }
 * ```
 */

import { useMessageStore, usePartStore } from "@renderer/presentation/providers/store-provider";
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { v7 as uuidv7 } from "uuid";
import type { EkacodeApiClient } from "../../lib/api-client";
import { createLogger } from "../../lib/logger";
import type { ChatUIMessage } from "../../types/ui-message";
import { useMessages } from "./use-messages";
import { useStreaming } from "./use-streaming";

const logger = createLogger("desktop:hooks:use-chat");

function extractTextFromPart(part: Record<string, unknown>): string {
  if (part.type !== "text") return "";
  if (typeof part.text === "string") return part.text;

  const content = part.content;
  if (content && typeof content === "object") {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }

  return "";
}

/**
 * UUIDv7 regex pattern for validation
 */
const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates session ID format (UUIDv7)
 */
function isValidSessionId(sessionId: string): boolean {
  return UUIDV7_REGEX.test(sessionId);
}

/**
 * Options for useChat hook
 */
export interface UseChatOptions {
  /** Session ID accessor */
  sessionId: Accessor<string | null>;

  /** Workspace directory accessor */
  workspace: Accessor<string>;

  /** API client for making chat requests (optional for testing) */
  client?: EkacodeApiClient;

  /** Called when session ID is received/updated */
  onSessionIdReceived?: (sessionId: string) => void;

  /** Called on error */
  onError?: (error: Error) => void;

  /** Called when message finishes */
  onFinish?: (messageId: string) => void;
}

/**
 * Result returned by useChat hook
 */
export interface UseChatResult {
  /** Messages projection */
  messages: ReturnType<typeof useMessages>;

  /** Streaming state */
  streaming: ReturnType<typeof useStreaming>;

  /** Current session ID */
  sessionId: Accessor<string | null>;

  /** Current workspace */
  workspace: Accessor<string>;

  /** Whether a session is being created */
  isCreatingSession: Accessor<boolean>;

  /** Send a message */
  sendMessage: (text: string) => Promise<void>;

  /** Stop current streaming */
  stop: () => void;

  /** Retry a message */
  retry: (messageId: string) => Promise<void>;

  /** Delete a message */
  delete: (messageId: string) => void;

  /** Copy message text */
  copy: (messageId: string) => Promise<void>;
}

/**
 * Hook for chat operations using domain contexts and API client
 *
 * Features:
 * - Uses provider-scoped message/part stores for operations
 * - Uses EkacodeApiClient for sendMessage
 * - Uses useStreaming for state management
 * - Uses useMessages for message projection
 * - Server-authoritative session creation (Batch 2: Data Integrity)
 * - Proper cleanup with onCleanup
 *
 * @param options - Hook options
 */
export function useChat(options: UseChatOptions): UseChatResult {
  const { client, onSessionIdReceived, onError, onFinish } = options;

  const [, messageActions] = useMessageStore();
  const [, partActions] = usePartStore();
  const [effectiveSessionId, setEffectiveSessionId] = createSignal<string | null>(
    options.sessionId()
  );
  const [isCreatingSession, setIsCreatingSession] = createSignal<boolean>(false);
  let activeRequest: { messageId: string; abortController: AbortController } | null = null;

  // Streaming state management
  const streaming = useStreaming();

  // Messages projection
  const messages = useMessages(effectiveSessionId);

  createEffect(() => {
    const incoming = options.sessionId();
    if (incoming && incoming !== effectiveSessionId()) {
      setEffectiveSessionId(incoming);
    }
  });

  const getText = (messageId: string): string => {
    return partActions
      .getByMessage(messageId)
      .map(part => extractTextFromPart(part as Record<string, unknown>))
      .filter(Boolean)
      .join("");
  };

  /**
   * Send a message
   *
   * Batch 2: Data Integrity - Server-authoritative session creation
   * - Does NOT generate session ID optimistically
   * - Waits for server to provide session ID in response header
   * - Creates optimistic message only after receiving valid session ID
   */
  const sendMessage = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) {
      logger.debug("Empty message, skipping");
      return;
    }

    // Check if can send
    if (!streaming.canSend()) {
      logger.warn("Cannot send message, streaming in progress", {
        status: streaming.status(),
      });
      return;
    }

    // Get workspace
    const ws = options.workspace();
    if (!ws) {
      const error = new Error("Workspace is not set");
      logger.error("Cannot send message: no workspace");
      streaming.setStatus("error");
      streaming.setError(error);
      onError?.(error);
      return;
    }

    // Check for client
    if (!client) {
      const error = new Error("API client not available");
      logger.error("Cannot send message: no client");
      streaming.setStatus("error");
      streaming.setError(error);
      onError?.(error);
      return;
    }

    // Get current session ID (may be null if creating new session)
    let currentSessionId = effectiveSessionId();

    // If no session exists, we'll let the server create one
    // We don't generate an optimistic session ID anymore (Batch 2: Data Integrity)
    if (!currentSessionId) {
      logger.info("No session ID, requesting server to create new session");
      setIsCreatingSession(true);
    }

    logger.info("Sending message", {
      sessionId: currentSessionId ?? "new-session",
      textLength: trimmed.length,
    });

    const userMessageId = uuidv7();
    const now = Date.now();
    const abortController = new AbortController();
    activeRequest = { messageId: userMessageId, abortController };

    // Start streaming with active message id
    streaming.start(userMessageId);

    try {
      logger.debug("Sending user message", { messageId: userMessageId });

      // Prepare message in the format expected by the API
      const messages: ChatUIMessage[] = [
        {
          id: userMessageId,
          role: "user",
          parts: [{ type: "text", text: trimmed }],
        },
      ];

      // Make API call
      // If no session ID, we send without it and let server create one
      const response = await client.chat(messages, {
        sessionId: currentSessionId ?? undefined, // undefined if creating new session
        messageId: userMessageId,
        workspace: ws,
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check for session ID from response headers (server-authoritative)
      const serverSessionId = response.headers.get("X-Session-ID");

      if (!serverSessionId) {
        // Server must provide session ID
        throw new Error("Server did not return session ID in X-Session-ID header");
      }

      // Validate session ID format
      if (!isValidSessionId(serverSessionId)) {
        throw new Error(`Invalid session ID format received from server: ${serverSessionId}`);
      }

      // Handle session ID transition
      if (serverSessionId !== currentSessionId) {
        if (currentSessionId) {
          logger.info("Session ID changed by server", {
            oldSessionId: currentSessionId,
            newSessionId: serverSessionId,
          });
        } else {
          logger.info("Received new session ID from server", {
            sessionId: serverSessionId,
          });
        }

        setEffectiveSessionId(serverSessionId);
        onSessionIdReceived?.(serverSessionId);
        currentSessionId = serverSessionId;
      }

      // Now that we have a valid session ID, create the optimistic message
      // This ensures the message is always associated with the correct session
      const optimisticTextPartId = `${userMessageId}-text`;
      messageActions.upsert({
        id: userMessageId,
        role: "user",
        sessionID: currentSessionId,
        time: { created: now },
      });
      partActions.upsert({
        id: optimisticTextPartId,
        type: "text",
        messageID: userMessageId,
        sessionID: currentSessionId,
        text: trimmed,
        time: { start: now, end: now },
      });

      // Consume stream if available
      const reader = response.body?.getReader();
      if (reader) {
        streaming.setStatus("streaming");
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Decode stream chunks to ensure transport completes cleanly.
            decoder.decode(value, { stream: true });
          }
        } finally {
          reader.releaseLock();
        }
      }

      streaming.complete(userMessageId);
      onFinish?.(userMessageId);
    } catch (error) {
      const errorName =
        error && typeof error === "object" && "name" in error
          ? String((error as { name?: unknown }).name)
          : "";
      if (errorName === "AbortError") {
        logger.info("Chat request aborted", { messageId: userMessageId });
        streaming.stop();
        return;
      }

      logger.error("Failed to send message", error as Error);
      streaming.setStatus("error");
      streaming.setError(error as Error);
      onError?.(error as Error);
    } finally {
      if (activeRequest?.messageId === userMessageId) {
        activeRequest = null;
      }
      setIsCreatingSession(false);
    }
  };

  /**
   * Stop current streaming
   */
  const stop = (): void => {
    const activeId = activeRequest?.messageId ?? streaming.activeMessageId();
    if (activeRequest) {
      activeRequest.abortController.abort();
      activeRequest = null;
    }

    if (activeId || streaming.status() !== "idle") {
      logger.info("Stopping message", { messageId: activeId });
      streaming.stop();
    }
  };

  /**
   * Retry a message
   */
  const retry = async (messageId: string): Promise<void> => {
    logger.info("Retrying message", { messageId });

    if (!streaming.canSend()) {
      logger.warn("Cannot retry, streaming in progress");
      return;
    }

    const source = messageActions.getById(messageId);
    if (!source) {
      const error = new Error(`Message not found: ${messageId}`);
      logger.error("Failed to retry message", error);
      streaming.setStatus("error");
      streaming.setError(error);
      onError?.(error);
      return;
    }

    const sourceId =
      source.role === "assistant"
        ? ((source as { parentID?: string }).parentID ?? messageId)
        : messageId;
    const text = getText(sourceId).trim();

    if (!text) {
      const error = new Error(`Message has no retryable text: ${sourceId}`);
      logger.error("Failed to retry message", error);
      streaming.setStatus("error");
      streaming.setError(error);
      onError?.(error);
      return;
    }

    await sendMessage(text);
  };

  /**
   * Delete a message
   */
  const deleteMsg = (messageId: string): void => {
    logger.info("Deleting message", { messageId });
    messageActions.remove(messageId);
  };

  /**
   * Copy message text
   */
  const copy = async (messageId: string): Promise<void> => {
    logger.debug("Copying message", { messageId });
    const text = getText(messageId);
    if (!text || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(text);
  };

  /**
   * Cleanup on unmount
   */
  onCleanup(() => {
    logger.debug("useChat cleanup");
    stop();
  });

  return {
    messages,
    streaming,
    sessionId: effectiveSessionId,
    workspace: options.workspace,
    isCreatingSession,
    sendMessage,
    stop,
    retry,
    delete: deleteMsg,
    copy,
  };
}
