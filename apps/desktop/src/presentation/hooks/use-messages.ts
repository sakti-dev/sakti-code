/**
 * useMessages Hook
 *
 * Message projection hook using provider-scoped stores.
 * Provides reactive access to messages with their parts for a given session.
 *
 * Part of Phase 5: Hooks Refactor
 *
 * @example
 * ```tsx
 * function MessageList() {
 *   const sessionId = () => 'session-123';
 *   const messages = useMessages(sessionId);
 *
 *   return (
 *     <For each={messages.list()}>
 *       {(message) => <MessageBubble message={message} />}
 *     </For>
 *   );
 * }
 * ```
 */

import type { MessageWithId } from "@ekacode/desktop/core/stores";
import type { Part } from "@ekacode/shared/event-types";
import { useMessageStore, usePartStore } from "@renderer/presentation/providers/store-provider";
import { createMemo, onCleanup, type Accessor } from "solid-js";
import { createLogger } from "../../lib/logger";

const logger = createLogger("desktop:hooks:use-messages");

/**
 * Chat message with parts for UI consumption
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parentId?: string;
  parts: Part[];
  createdAt: number;
  completedAt?: number;
  sessionId: string;
}

/**
 * Result returned by useMessages hook
 */
export interface UseMessagesResult {
  /** List of messages for the session */
  list: Accessor<ChatMessage[]>;

  /** Get message by ID */
  get: (id: string) => ChatMessage | undefined;

  /** Count of messages */
  count: Accessor<number>;

  /** Last assistant message */
  lastAssistant: Accessor<ChatMessage | undefined>;

  /** User messages only */
  userMessages: Accessor<ChatMessage[]>;

  /** Assistant messages only */
  assistantMessages: Accessor<ChatMessage[]>;
}

/**
 * Convert MessageWithId to ChatMessage with parts
 */
function toChatMessage(message: MessageWithId, parts: Part[]): ChatMessage {
  let createdAt = 0;
  let completedAt: number | undefined = undefined;
  let parentId: string | undefined;

  if ("time" in message && message.time && typeof message.time === "object") {
    if ("created" in message.time && typeof message.time.created === "number") {
      createdAt = message.time.created;
    }
    if ("completed" in message.time && typeof message.time.completed === "number") {
      completedAt = message.time.completed;
    }
  }

  // Extract sessionID if it exists
  const sessionId = "sessionID" in message ? (message.sessionID as string) : "";
  if ("parentID" in message && typeof message.parentID === "string") {
    parentId = message.parentID;
  }

  return {
    id: message.id,
    role: message.role as "user" | "assistant" | "system",
    parentId,
    parts,
    createdAt,
    completedAt,
    sessionId,
  };
}

/**
 * Hook for accessing messages with their parts
 *
 * Features:
 * - Reactive message list for a session
 * - Automatic part attachment
 * - Derived queries (user/assistant messages, last message)
 * - Proper cleanup with onCleanup
 *
 * @param sessionId - Accessor returning the current session ID
 */
export function useMessages(sessionId: Accessor<string | null>): UseMessagesResult {
  const [, messageActions] = useMessageStore();
  const [, partActions] = usePartStore();

  /**
   * Get all messages for the current session with their parts
   */
  const list = createMemo<ChatMessage[]>(() => {
    const sid = sessionId();
    if (!sid) {
      logger.debug("No session ID, returning empty message list");
      return [];
    }

    const messages = messageActions.getBySession(sid);
    logger.debug("Projecting messages", { sessionId: sid, count: messages.length });

    return messages.map(msg => {
      const parts = partActions.getByMessage(msg.id);
      return toChatMessage(msg, parts);
    });
  });

  /**
   * Get message by ID
   */
  const get = (id: string): ChatMessage | undefined => {
    const msg = messageActions.getById(id);
    if (!msg) return undefined;

    const parts = partActions.getByMessage(id);
    return toChatMessage(msg, parts);
  };

  /**
   * Count of messages
   */
  const count = createMemo(() => list().length);

  /**
   * Last assistant message
   */
  const lastAssistant = createMemo(() => {
    const messages = list();
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        return messages[i];
      }
    }
    return undefined;
  });

  /**
   * User messages only
   */
  const userMessages = createMemo(() => list().filter(m => m.role === "user"));

  /**
   * Assistant messages only
   */
  const assistantMessages = createMemo(() => list().filter(m => m.role === "assistant"));

  /**
   * Cleanup on unmount
   */
  onCleanup(() => {
    logger.debug("useMessages cleanup");
  });

  return {
    list,
    get,
    count,
    lastAssistant,
    userMessages,
    assistantMessages,
  };
}
