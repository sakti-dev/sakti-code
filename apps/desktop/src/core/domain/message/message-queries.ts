/**
 * Message Queries
 *
 * Query functions for message data projections.
 */

import type { MessageState, MessageWithId } from "../../stores/message-store";

export interface MessageQueries {
  getBySession: (sessionId: string) => MessageWithId[];
  getById: (messageId: string) => MessageWithId | undefined;
  getLatestBySession: (sessionId: string) => MessageWithId | undefined;
}

export function createMessageQueries(getMessageState: () => MessageState): MessageQueries {
  const getBySession = (sessionId: string) => {
    const state = getMessageState();
    const messageIds = state.bySession[sessionId] || [];
    return messageIds.map((id: string) => state.byId[id]).filter(Boolean);
  };

  const getById = (messageId: string) => {
    const state = getMessageState();
    return state.byId[messageId];
  };

  const getLatestBySession = (sessionId: string) => {
    const messages = getBySession(sessionId);
    return messages[messages.length - 1];
  };

  return {
    getBySession,
    getById,
    getLatestBySession,
  };
}
