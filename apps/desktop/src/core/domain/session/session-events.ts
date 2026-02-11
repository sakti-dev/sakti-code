/**
 * Session Event Handlers
 *
 * Handles session-related SSE events and updates stores.
 */

import type {
  ServerInstanceDisposedPayload,
  SessionCreatedPayload,
  SessionStatusPayload,
  SessionUpdatedPayload,
} from "@ekacode/shared/event-types";
import type { MessageActions } from "../../stores/message-store";
import type { PartActions } from "../../stores/part-store";
import type { SessionActions } from "../../stores/session-store";

export interface SessionHandlerDependencies {
  sessionActions: SessionActions;
  messageActions: MessageActions;
  partActions: PartActions;
}

/**
 * Handle session.created event
 * Adds new session to the session store
 */
export function handleSessionCreated(
  event: { type: "session.created"; properties: SessionCreatedPayload; directory?: string },
  deps: SessionHandlerDependencies
): void {
  const { sessionID, directory } = event.properties;

  deps.sessionActions.upsert({ sessionID, directory });
}

/**
 * Handle session.updated event
 * Updates session metadata
 */
export function handleSessionUpdated(
  event: { type: "session.updated"; properties: SessionUpdatedPayload; directory?: string },
  deps: SessionHandlerDependencies
): void {
  const { sessionID, status } = event.properties;

  // Update session status if provided
  // Convert simple status string to status object
  if (status) {
    const statusObject =
      status === "running" ? { type: "busy" as const } : { type: "idle" as const };
    deps.sessionActions.setStatus(sessionID, statusObject);
  }
}

/**
 * Handle session.status event
 * Updates detailed session status with retry info
 */
export function handleSessionStatus(
  event: { type: "session.status"; properties: SessionStatusPayload; directory?: string },
  deps: SessionHandlerDependencies
): void {
  const { sessionID, status } = event.properties;

  deps.sessionActions.setStatus(sessionID, status);
}

/**
 * Handle server.instance.disposed event
 * Removes session for the disposed directory
 */
export function handleServerInstanceDisposed(
  event: {
    type: "server.instance.disposed";
    properties: ServerInstanceDisposedPayload;
    directory?: string;
  },
  deps: SessionHandlerDependencies
): void {
  const { directory } = event.properties;

  // Get all sessions for this directory
  const sessions = deps.sessionActions.getByDirectory(directory);

  // Remove each session's messages and parts
  for (const session of sessions) {
    const messages = deps.messageActions.getBySession(session.sessionID);
    for (const message of messages) {
      const parts = deps.partActions.getByMessage(message.id);
      for (const part of parts) {
        if (part.id) {
          deps.partActions.remove(part.id, message.id);
        }
      }
      deps.messageActions.remove(message.id);
    }
  }

  // Note: We'd need a delete action on session store to remove sessions
  // For now, sessions remain but their messages/parts are cleaned up
}
