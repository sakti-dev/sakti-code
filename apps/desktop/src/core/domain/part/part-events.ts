/**
 * Part Event Handlers
 *
 * Handles part-related SSE events and updates stores.
 */

import type {
  MessagePartRemovedPayload,
  MessagePartUpdatedPayload,
} from "@ekacode/shared/event-types";
import type { MessageActions } from "../../stores/message-store";
import type { PartActions } from "../../stores/part-store";

export interface PartHandlerDependencies {
  partActions: PartActions;
  messageActions: MessageActions;
}

/**
 * Handle message.part.updated event
 * Adds or updates a part in the part store
 */
export function handlePartUpdated(
  event: {
    type: "message.part.updated";
    properties: MessagePartUpdatedPayload;
    directory?: string;
  },
  deps: PartHandlerDependencies
): void {
  const { part } = event.properties;

  if (!part.id || !part.messageID) {
    console.warn("[handlePartUpdated] Missing required fields", event);
    return;
  }

  deps.partActions.upsert(part);
}

/**
 * Handle message.part.removed event
 * Removes a part from the part store
 */
export function handlePartRemoved(
  event: {
    type: "message.part.removed";
    properties: MessagePartRemovedPayload;
    directory?: string;
  },
  deps: PartHandlerDependencies
): void {
  const { partID, messageID } = event.properties;

  deps.partActions.remove(partID, messageID);
}
