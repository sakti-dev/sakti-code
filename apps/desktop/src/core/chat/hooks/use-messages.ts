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

import { useMessageStore, usePartStore } from "@/state/providers";
import type { MessageWithId } from "@/state/stores/message-store";
import type { Part } from "@sakti-code/shared/event-types";
import { createMemo, type Accessor } from "solid-js";
import { toTimeline, type ChatTimelineItem } from "./timeline-projection";

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

  /** Chronological timeline items for rendering */
  timeline: Accessor<ChatTimelineItem[]>;

  /** Whether assistant content is already renderable */
  hasRenderableAssistantContent: Accessor<boolean>;
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
    if (!sid) return [];

    const messages = messageActions.getBySession(sid);

    const projected = messages.map(msg => {
      const parts = partActions.getByMessage(msg.id);
      return toChatMessage(msg, parts);
    });

    projected.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id.localeCompare(b.id);
    });

    return projected;
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

  const timeline = createMemo(() => toTimeline(list()));

  const hasRenderableAssistantContent = createMemo(() => {
    return assistantMessages().some(message =>
      message.parts.some(part => {
        if (part.type === "text") {
          return typeof part.text === "string" && part.text.trim().length > 0;
        }
        return part.type !== "step-start" && part.type !== "step-finish";
      })
    );
  });

  return {
    list,
    get,
    count,
    lastAssistant,
    userMessages,
    assistantMessages,
    timeline,
    hasRenderableAssistantContent,
  };
}
