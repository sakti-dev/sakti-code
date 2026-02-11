/**
 * Message Event Handlers
 *
 * Handles message-related SSE events and updates stores.
 * Uses dependency injection for testability.
 */

import type { MessageUpdatedPayload } from "@ekacode/shared/event-types";
import type { MessageActions } from "../../stores/message-store";
import type { PartActions } from "../../stores/part-store";
import type { SessionActions } from "../../stores/session-store";

export interface MessageHandlerDependencies {
  messageActions: MessageActions;
  partActions: PartActions;
  sessionActions: SessionActions;
}

/**
 * Handle message.updated event
 * Updates message info in the message store
 */
export function handleMessageUpdated(
  event: { type: "message.updated"; properties: MessageUpdatedPayload; directory?: string },
  deps: MessageHandlerDependencies
): void {
  const { info } = event.properties;
  const messageId = (info as { id?: string }).id;

  if (!messageId) {
    console.warn("[handleMessageUpdated] Missing message id", event);
    return;
  }

  // Spread the entire info object and add the id
  // The info object already contains the role property required by MessageWithId
  deps.messageActions.upsert({
    ...info,
    id: messageId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}
