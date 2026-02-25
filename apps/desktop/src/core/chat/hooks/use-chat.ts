/**
 * useChat Hook
 *
 * Refactored chat hook using Phase 4 domain contexts.
 * Uses provider-scoped stores for retry/delete/copy operations.
 * Uses SaktiCodeApiClient for sendMessage.
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

import {
  CORRELATION_TIME_WINDOW_MS,
  createOptimisticMetadata,
  generateMessageCorrelationKey,
  generatePartCorrelationKey,
  type OptimisticMetadata,
} from "@/core/chat/domain/correlation";
import { findOrphanedOptimisticEntities } from "@/core/chat/domain/reconciliation";
import { recordChatPerfCounter } from "@/core/chat/services/chat-perf-telemetry";
import { parseChatStream } from "@/core/chat/services/chat-stream-parser";
import { createStreamUpdateCoalescer } from "@/core/chat/services/stream-update-coalescer";
import type { ChatUIMessage } from "@/core/chat/types/ui-message";
import type { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { createLogger } from "@/core/shared/logger";
import { useMessageStore, usePartStore, useSessionStore } from "@/state/providers";
import { batch, createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { v7 as uuidv7 } from "uuid";
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

function hasCanonicalEventMetadata(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const metadata = (part as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return false;
  return typeof (metadata as { __eventSequence?: unknown }).__eventSequence === "number";
}

function isOptimisticPartPayload(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const metadata = (part as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return false;
  return (metadata as { optimistic?: unknown }).optimistic === true;
}

function isUserMessageEntity(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  return (message as { role?: unknown }).role === "user";
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
  client?: SaktiCodeApiClient;
  /** Selected provider id accessor */
  providerId?: Accessor<string | null | undefined>;
  /** Selected model id accessor */
  modelId?: Accessor<string | null | undefined>;
  /** Optional runtime mode accessor for chat behavior */
  runtimeMode?: Accessor<"intake" | "plan" | "build" | undefined>;

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
 * - Uses SaktiCodeApiClient for sendMessage
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
  const [, sessionActions] = useSessionStore();
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

  // Adopt server-created sessions when header-based session propagation is unavailable.
  createEffect(() => {
    if (effectiveSessionId()) return;
    const ws = options.workspace();
    if (!ws) return;

    const sessions = sessionActions.getByDirectory(ws);
    const latest = sessions[sessions.length - 1];
    const discoveredSessionId = latest?.sessionID;
    if (!discoveredSessionId) return;

    setEffectiveSessionId(discoveredSessionId);
    onSessionIdReceived?.(discoveredSessionId);
  });

  const getText = (messageId: string): string => {
    return partActions
      .getByMessage(messageId)
      .map(part => extractTextFromPart(part as Record<string, unknown>))
      .filter(Boolean)
      .join("");
  };

  /**
   * Clean up orphaned optimistic entities for a session
   *
   * Removes messages and parts that have optimistic metadata but are
   * no longer being updated (e.g., after abort or error).
   */
  const cleanupOptimisticArtifacts = (
    sessionId: string | null,
    maxAgeMs: number = CORRELATION_TIME_WINDOW_MS
  ): void => {
    if (!sessionId) return;

    const messages = messageActions.getBySession(sessionId);
    const parts = messages.flatMap(message => partActions.getByMessage(message.id));

    const orphanedPartIds = findOrphanedOptimisticEntities(
      parts
        .filter(part => typeof part.id === "string")
        .map(part => ({
          id: part.id as string,
          metadata: (part as { metadata?: OptimisticMetadata }).metadata,
        })),
      maxAgeMs
    );
    for (const partId of orphanedPartIds) {
      const part = partActions.getById(partId);
      if (!part?.messageID) continue;
      const parentMessage = messageActions.getById(part.messageID);
      if (isUserMessageEntity(parentMessage)) {
        continue;
      }
      logger.info("Cleaning up optimistic part", {
        partId,
        messageId: part.messageID,
        sessionId,
      });
      partActions.remove(partId, part.messageID);
    }

    const orphanedIds = findOrphanedOptimisticEntities(
      messages.map(m => ({
        id: m.id,
        metadata: (m as { metadata?: OptimisticMetadata }).metadata,
      })),
      maxAgeMs
    );

    for (const messageId of orphanedIds) {
      const message = messageActions.getById(messageId);
      if (isUserMessageEntity(message)) {
        continue;
      }
      logger.info("Cleaning up optimistic message", { messageId, sessionId });

      // Remove parts first (cascade)
      const parts = partActions.getByMessage(messageId);
      for (const part of parts) {
        partActions.remove(part.id!, messageId);
      }

      // Remove message
      messageActions.remove(messageId);
    }
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
    return sendMessageInternal(text);
  };

  const sendMessageInternal = async (
    text: string,
    retryOptions?: {
      retryOfAssistantMessageId?: string;
      existingUserMessageId?: string;
      skipUserPersistence?: boolean;
    }
  ): Promise<void> => {
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

    const userMessageId = retryOptions?.existingUserMessageId ?? uuidv7();
    const now = Date.now();
    const abortController = new AbortController();
    activeRequest = { messageId: userMessageId, abortController };
    let userMessagePersisted = false;
    let assistantMessagePersisted = false;
    let droppedTextEvents = 0;
    let droppedDataEvents = 0;
    let messageUpserts = 0;
    let partUpserts = 0;
    const deferredPartUpdatesByMessage = new Map<string, Map<string, Record<string, unknown>>>();
    let deferredPartUpdateSerial = 0;
    const applyPartUpdate = (update: Record<string, unknown>) => {
      const updateId = typeof update.id === "string" ? update.id : undefined;
      if (updateId) {
        const existing = partActions.getById(updateId);
        if (hasCanonicalEventMetadata(existing) && isOptimisticPartPayload(update)) {
          recordChatPerfCounter("skippedOptimisticUpdates");
          return;
        }
      }
      partActions.upsert(update as never);
      partUpserts += 1;
      recordChatPerfCounter("partUpserts");
    };
    const deferPartUpdate = (messageId: string, update: Record<string, unknown>) => {
      let queue = deferredPartUpdatesByMessage.get(messageId);
      if (!queue) {
        queue = new Map<string, Record<string, unknown>>();
        deferredPartUpdatesByMessage.set(messageId, queue);
      }
      const updateId =
        typeof update.id === "string"
          ? update.id
          : `${messageId}-deferred-${(deferredPartUpdateSerial += 1)}`;
      queue.set(updateId, update);
    };
    const flushDeferredPartUpdatesForMessage = (messageId: string): void => {
      const queue = deferredPartUpdatesByMessage.get(messageId);
      if (!queue || queue.size === 0) return;
      if (!messageActions.getById(messageId)) return;
      deferredPartUpdatesByMessage.delete(messageId);
      for (const update of queue.values()) {
        applyPartUpdate(update);
      }
    };
    const flushAllDeferredPartUpdates = (): void => {
      for (const messageId of deferredPartUpdatesByMessage.keys()) {
        flushDeferredPartUpdatesForMessage(messageId);
      }
    };
    const partUpdateCoalescer = createStreamUpdateCoalescer<Record<string, unknown>>(
      updates => {
        recordChatPerfCounter("coalescedFlushes");
        recordChatPerfCounter("coalescedUpdates", updates.length);
        batch(() => {
          for (const update of updates) {
            const messageId = typeof update.messageID === "string" ? update.messageID : undefined;
            if (messageId && !messageActions.getById(messageId)) {
              deferPartUpdate(messageId, update);
              continue;
            }
            applyPartUpdate(update);
          }
        });
      },
      {
        frameMs: 16,
        getKey: update => {
          const id = update.id;
          return typeof id === "string" ? id : undefined;
        },
      }
    );
    const enqueuePartUpdate = (
      update: Record<string, unknown>,
      priority: "buffered" | "immediate" = "buffered"
    ) => {
      if (priority === "immediate") {
        partUpdateCoalescer.enqueueImmediate(update);
        return;
      }
      partUpdateCoalescer.enqueue(update);
    };

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
        retryOfAssistantMessageId: retryOptions?.retryOfAssistantMessageId,
        workspace: ws,
        providerId: options.providerId?.() ?? undefined,
        modelId: options.modelId?.() ?? undefined,
        runtimeMode: options.runtimeMode?.(),
        signal: abortController.signal,
      });

      if (!response.ok) {
        let details = "";
        const contentType = response.headers.get("content-type") ?? "";
        try {
          if (contentType.includes("application/json")) {
            const payload = (await response.json()) as
              | {
                  error?:
                    | string
                    | {
                        code?: string;
                        message?: string;
                      };
                  message?: string;
                }
              | undefined;
            const errorMessage =
              typeof payload?.error === "string"
                ? payload.error
                : payload?.error?.message || payload?.message;
            const errorCode =
              typeof payload?.error === "object" && payload?.error?.code
                ? payload.error.code
                : undefined;
            if (errorCode && errorMessage) {
              details = `${errorCode}: ${errorMessage}`;
            } else if (errorMessage) {
              details = errorMessage;
            }
          } else {
            const text = (await response.text()).trim();
            if (text) details = text;
          }
        } catch {
          // Best effort only; preserve base HTTP error below.
        }

        const suffix = details ? ` - ${details}` : "";
        throw new Error(`HTTP ${response.status}: ${response.statusText}${suffix}`);
      }

      // Resolve session ID for this request lifecycle.
      // Prefer server response header when present. If missing, keep current session
      // or defer to SSE/session store synchronization instead of failing hard.
      const serverSessionId = response.headers.get("X-Task-Session-ID");
      let resolvedSessionId = currentSessionId;

      if (serverSessionId) {
        if (!isValidSessionId(serverSessionId)) {
          throw new Error(`Invalid session ID format received from server: ${serverSessionId}`);
        }

        // Header session ID is authoritative when provided.
        sessionActions.upsert({
          sessionID: serverSessionId,
          directory: ws,
        });

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
        }

        setEffectiveSessionId(serverSessionId);
        onSessionIdReceived?.(serverSessionId);
        resolvedSessionId = serverSessionId;
      } else if (currentSessionId) {
        // Existing session can still be authoritative for this request.
        sessionActions.upsert({
          sessionID: currentSessionId,
          directory: ws,
        });
      } else {
        logger.warn(
          "Server did not return X-Task-Session-ID; continuing with SSE-authoritative session sync"
        );
      }

      const ensureResolvedSessionId = (candidateMessageId?: string): string | null => {
        if (resolvedSessionId) return resolvedSessionId;

        if (candidateMessageId) {
          const message = messageActions.getById(candidateMessageId) as
            | { sessionID?: string }
            | undefined;
          if (message?.sessionID) {
            resolvedSessionId = message.sessionID;
          }
        }

        if (!resolvedSessionId) {
          const sessions = sessionActions.getByDirectory(ws);
          const latest = sessions[sessions.length - 1];
          if (latest?.sessionID) {
            resolvedSessionId = latest.sessionID;
            logger.debug("Resolved session from directory lookup", {
              workspace: ws,
              sessionId: resolvedSessionId,
            });
          }
        }

        if (resolvedSessionId && resolvedSessionId !== effectiveSessionId()) {
          setEffectiveSessionId(resolvedSessionId);
          onSessionIdReceived?.(resolvedSessionId);
        }

        return resolvedSessionId;
      };

      // Create optimistic user message only when session is known.
      const optimisticSessionId = ensureResolvedSessionId();
      if (optimisticSessionId && !retryOptions?.skipUserPersistence) {
        const optimisticTextPartId = `${userMessageId}-text`;
        const existingUserMessage = messageActions.getById(userMessageId);
        const existingUserTextPart = partActions.getById(optimisticTextPartId);

        if (!existingUserMessage) {
          messageActions.upsert({
            id: userMessageId,
            role: "user",
            sessionID: optimisticSessionId,
            time: { created: now },
            metadata: createOptimisticMetadata(
              "userAction",
              generateMessageCorrelationKey({
                role: "user",
                createdAt: now,
              })
            ),
          });
          messageUpserts += 1;
        }

        if (!existingUserTextPart) {
          partActions.upsert({
            id: optimisticTextPartId,
            type: "text",
            messageID: userMessageId,
            sessionID: optimisticSessionId,
            text: trimmed,
            time: { start: now, end: now },
            metadata: existingUserMessage
              ? undefined
              : createOptimisticMetadata(
                  "useChat",
                  generatePartCorrelationKey({
                    messageID: userMessageId,
                    partType: "text",
                  })
                ),
          });
          partUpserts += 1;
        }

        userMessagePersisted = true;
      } else {
        logger.warn("Unable to resolve session before stream start; waiting for SSE/session sync", {
          workspace: ws,
          userMessageId,
        });
      }

      const persistUserMessageIfNeeded = (activeSessionId: string): void => {
        if (retryOptions?.skipUserPersistence) return;
        if (userMessagePersisted) {
          flushDeferredPartUpdatesForMessage(userMessageId);
          return;
        }
        const existing = messageActions.getById(userMessageId);
        if (existing) {
          userMessagePersisted = true;
          flushDeferredPartUpdatesForMessage(userMessageId);
          return;
        }

        const optimisticTextPartId = `${userMessageId}-text`;
        messageActions.upsert({
          id: userMessageId,
          role: "user",
          sessionID: activeSessionId,
          time: { created: now },
          metadata: createOptimisticMetadata(
            "userAction",
            generateMessageCorrelationKey({
              role: "user",
              createdAt: now,
            })
          ),
        });
        messageUpserts += 1;
        partActions.upsert({
          id: optimisticTextPartId,
          type: "text",
          messageID: userMessageId,
          sessionID: activeSessionId,
          text: trimmed,
          time: { start: now, end: now },
          metadata: createOptimisticMetadata(
            "useChat",
            generatePartCorrelationKey({
              messageID: userMessageId,
              partType: "text",
            })
          ),
        });
        partUpserts += 1;
        userMessagePersisted = true;
        flushDeferredPartUpdatesForMessage(userMessageId);
        logger.info("Persisted deferred user message after session resolution", {
          userMessageId,
          sessionId: activeSessionId,
        });
      };

      const persistAssistantMessageIfNeeded = (
        assistantId: string,
        activeSessionId: string
      ): void => {
        if (assistantMessagePersisted) {
          flushDeferredPartUpdatesForMessage(assistantId);
          return;
        }
        const existing = messageActions.getById(assistantId);
        const assistantCreated = Date.now();
        if (!existing) {
          messageActions.upsert({
            id: assistantId,
            role: "assistant",
            sessionID: activeSessionId,
            parentID: userMessageId,
            time: { created: assistantCreated },
            metadata: createOptimisticMetadata(
              "useChat",
              generateMessageCorrelationKey({
                role: "assistant",
                createdAt: assistantCreated,
                parentID: userMessageId,
              })
            ),
          });
          messageUpserts += 1;
        }
        assistantMessagePersisted = true;
        flushDeferredPartUpdatesForMessage(assistantId);
      };

      // Consume stream if available
      const reader = response.body?.getReader();
      if (reader) {
        streaming.setStatus("streaming");

        let assistantMessageId: string | null = null;
        const textPartBuffers = new Map<string, string>();

        try {
          await parseChatStream(
            reader,
            {
              onTextDelta: (messageId, delta) => {
                recordChatPerfCounter("streamTextDeltas");
                const activeSessionId = ensureResolvedSessionId(messageId);
                if (!activeSessionId) {
                  droppedTextEvents += 1;
                  if (droppedTextEvents <= 3) {
                    logger.warn("Dropping text delta due to unresolved session", {
                      messageId,
                      deltaLength: delta.length,
                      droppedTextEvents,
                    });
                  }
                  return;
                }
                persistUserMessageIfNeeded(activeSessionId);

                // Track assistant message ID (first stream event owns the assistant turn).
                if (!assistantMessageId) {
                  assistantMessageId = messageId || uuidv7();
                }

                persistAssistantMessageIfNeeded(assistantMessageId, activeSessionId);

                // Buffer text deltas on the canonical assistant message id.
                const existing = textPartBuffers.get(assistantMessageId) || "";
                textPartBuffers.set(assistantMessageId, existing + delta);

                // Update text part.
                const partId = `${assistantMessageId}-text`;
                enqueuePartUpdate({
                  id: partId,
                  type: "text",
                  messageID: assistantMessageId,
                  sessionID: activeSessionId,
                  text: textPartBuffers.get(assistantMessageId),
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                  metadata: createOptimisticMetadata(
                    "useChat",
                    generatePartCorrelationKey({
                      messageID: assistantMessageId,
                      partType: "text",
                    })
                  ),
                });
              },
              onToolCallStart: toolCall => {
                const activeSessionId = ensureResolvedSessionId(assistantMessageId ?? undefined);
                if (!activeSessionId) return;
                persistUserMessageIfNeeded(activeSessionId);

                if (!assistantMessageId) {
                  assistantMessageId = uuidv7();
                }
                persistAssistantMessageIfNeeded(assistantMessageId, activeSessionId);

                const partId = `${toolCall.toolCallId}-tool`;
                enqueuePartUpdate(
                  {
                    id: partId,
                    type: "tool",
                    messageID: assistantMessageId,
                    sessionID: activeSessionId,
                    tool: toolCall.toolName,
                    callID: toolCall.toolCallId,
                    state: {
                      status: "running",
                      input:
                        toolCall.args && typeof toolCall.args === "object" ? toolCall.args : {},
                    },
                    metadata: createOptimisticMetadata(
                      "useChat",
                      generatePartCorrelationKey({
                        messageID: assistantMessageId,
                        partType: "tool",
                        callID: toolCall.toolCallId,
                      })
                    ),
                  },
                  "immediate"
                );
              },
              onToolResult: result => {
                const activeSessionId = ensureResolvedSessionId(assistantMessageId ?? undefined);
                if (!activeSessionId) return;
                persistUserMessageIfNeeded(activeSessionId);

                if (!assistantMessageId) {
                  assistantMessageId = uuidv7();
                }
                persistAssistantMessageIfNeeded(assistantMessageId, activeSessionId);

                const partId = `${result.toolCallId}-tool`;
                enqueuePartUpdate(
                  {
                    id: partId,
                    type: "tool",
                    messageID: assistantMessageId,
                    sessionID: activeSessionId,
                    tool: "tool",
                    callID: result.toolCallId,
                    state: {
                      status: "completed",
                      output:
                        typeof result.result === "string"
                          ? result.result
                          : JSON.stringify(result.result),
                    },
                    metadata: createOptimisticMetadata(
                      "useChat",
                      generatePartCorrelationKey({
                        messageID: assistantMessageId,
                        partType: "tool",
                        callID: result.toolCallId,
                      })
                    ),
                  },
                  "immediate"
                );
              },
              onDataPart: (type, id, data) => {
                recordChatPerfCounter("streamDataParts");
                const activeSessionId = ensureResolvedSessionId(assistantMessageId ?? undefined);
                if (!activeSessionId) {
                  droppedDataEvents += 1;
                  if (droppedDataEvents <= 3) {
                    logger.warn("Dropping data part due to unresolved session", {
                      type,
                      id,
                      droppedDataEvents,
                    });
                  }
                  return;
                }
                persistUserMessageIfNeeded(activeSessionId);

                if (!assistantMessageId) {
                  assistantMessageId = uuidv7();
                }
                persistAssistantMessageIfNeeded(assistantMessageId, activeSessionId);

                // Handle data-thought, data-action, etc.
                if (type === "data-thought") {
                  const thought = data as { text?: unknown; status?: unknown };
                  const thoughtText =
                    typeof thought?.text === "string"
                      ? thought.text
                      : typeof data === "string"
                        ? data
                        : "";
                  // Create reasoning part
                  const partId = `${id}-thought`;
                  enqueuePartUpdate({
                    id: partId,
                    type: "reasoning",
                    messageID: assistantMessageId,
                    sessionID: activeSessionId,
                    text: thoughtText,
                    reasoningId: id,
                    time: {
                      start: Date.now(),
                      end: Date.now(),
                    },
                    metadata: createOptimisticMetadata(
                      "useChat",
                      generatePartCorrelationKey({
                        messageID: assistantMessageId,
                        partType: "reasoning",
                        reasoningId: id,
                      })
                    ),
                  });
                } else if (type === "data-tool-call") {
                  const payload = data as {
                    toolCallId?: unknown;
                    toolName?: unknown;
                    args?: unknown;
                  };
                  const toolCallId =
                    typeof payload?.toolCallId === "string" ? payload.toolCallId : id;
                  const toolName =
                    typeof payload?.toolName === "string" ? payload.toolName : "tool";
                  enqueuePartUpdate(
                    {
                      id: `${toolCallId}-tool`,
                      type: "tool",
                      messageID: assistantMessageId,
                      sessionID: activeSessionId,
                      tool: toolName,
                      callID: toolCallId,
                      state: {
                        status: "running",
                        input:
                          payload?.args && typeof payload.args === "object" ? payload.args : {},
                      },
                      metadata: createOptimisticMetadata(
                        "useChat",
                        generatePartCorrelationKey({
                          messageID: assistantMessageId,
                          partType: "tool",
                          callID: toolCallId,
                        })
                      ),
                    },
                    "immediate"
                  );
                } else if (type === "data-tool-result") {
                  const payload = data as {
                    toolCallId?: unknown;
                    result?: unknown;
                  };
                  const toolCallId =
                    typeof payload?.toolCallId === "string" ? payload.toolCallId : id;
                  enqueuePartUpdate(
                    {
                      id: `${toolCallId}-tool`,
                      type: "tool",
                      messageID: assistantMessageId,
                      sessionID: activeSessionId,
                      tool: "tool",
                      callID: toolCallId,
                      state: {
                        status: "completed",
                        output:
                          typeof payload?.result === "string"
                            ? payload.result
                            : JSON.stringify(payload?.result),
                      },
                      metadata: createOptimisticMetadata(
                        "useChat",
                        generatePartCorrelationKey({
                          messageID: assistantMessageId,
                          partType: "tool",
                          callID: toolCallId,
                        })
                      ),
                    },
                    "immediate"
                  );
                }
              },
              onComplete: finishReason => {
                partUpdateCoalescer.flush();
                const completedSessionId = ensureResolvedSessionId(assistantMessageId ?? undefined);
                if (completedSessionId) {
                  persistUserMessageIfNeeded(completedSessionId);
                  if (assistantMessageId) {
                    persistAssistantMessageIfNeeded(assistantMessageId, completedSessionId);
                  }
                }
                flushAllDeferredPartUpdates();
                logger.info("Stream completed", {
                  finishReason,
                  userMessageId,
                  assistantMessageId: assistantMessageId ?? undefined,
                  resolvedSessionId:
                    ensureResolvedSessionId(assistantMessageId ?? undefined) ?? undefined,
                  droppedTextEvents,
                  droppedDataEvents,
                  messageUpserts,
                  partUpserts,
                });
                streaming.complete(userMessageId);
                onFinish?.(userMessageId);
              },
              onError: error => {
                partUpdateCoalescer.flush();
                logger.error("Stream error", error);
                const errorSessionId = ensureResolvedSessionId(assistantMessageId ?? undefined);
                cleanupOptimisticArtifacts(errorSessionId, 0);
                streaming.setStatus("error");
                streaming.setError(error);
                onError?.(error);
              },
            },
            {
              signal: abortController.signal,
              timeoutMs: 300000, // 5 minute timeout
            }
          );
        } catch (error) {
          partUpdateCoalescer.flush();
          logger.error("Failed to parse stream", error as Error);
          cleanupOptimisticArtifacts(ensureResolvedSessionId(assistantMessageId ?? undefined), 0);
          streaming.setStatus("error");
          streaming.setError(error as Error);
          onError?.(error as Error);
        }
      } else {
        // No stream, just complete
        streaming.complete(userMessageId);
        onFinish?.(userMessageId);
      }
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
      partUpdateCoalescer.flush();
      flushAllDeferredPartUpdates();
      partUpdateCoalescer.cancel();
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

    // Clean up optimistic artifacts
    cleanupOptimisticArtifacts(effectiveSessionId(), 0);

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

    const sourceRole =
      source && typeof source === "object" && "role" in source
        ? String((source as { role?: unknown }).role)
        : "";
    const assistantMessageId = sourceRole === "assistant" ? messageId : undefined;
    const existingUserMessageId =
      sourceRole === "assistant"
        ? ((source as { parentID?: string }).parentID ?? undefined)
        : messageId;

    await sendMessageInternal(text, {
      retryOfAssistantMessageId: assistantMessageId,
      existingUserMessageId,
      skipUserPersistence: Boolean(assistantMessageId && existingUserMessageId),
    });
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
