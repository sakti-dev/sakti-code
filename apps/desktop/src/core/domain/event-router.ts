/**
 * Event Router
 *
 * Central dispatcher that routes parsed SSE events to appropriate domain handlers.
 * Uses SolidJS batch() for efficient reactive updates when handling multiple events.
 */

import type { AllServerEvents, EventType } from "@ekacode/shared/event-types";
import { batch } from "solid-js";
import type { MessageActions } from "../stores/message-store";
import type { PartActions } from "../stores/part-store";
import type { SessionActions } from "../stores/session-store";

export interface EventRouterDependencies {
  messageActions: MessageActions;
  partActions: PartActions;
  sessionActions: SessionActions;
}

export interface EventRouter {
  handle: (event: AllServerEvents) => void;
  handleBatch: (events: AllServerEvents[]) => void;
}

// Individual handler types - each handles its specific event type
// type definitions kept for documentation purposes but prefixed with _ to avoid lint errors
type _MessageUpdatedHandler = (
  event: Extract<AllServerEvents, { type: "message.updated" }>,
  deps: EventRouterDependencies
) => void;
type _PartUpdatedHandler = (
  event: Extract<AllServerEvents, { type: "message.part.updated" }>,
  deps: EventRouterDependencies
) => void;
type _PartRemovedHandler = (
  event: Extract<AllServerEvents, { type: "message.part.removed" }>,
  deps: EventRouterDependencies
) => void;
type _SessionCreatedHandler = (
  event: Extract<AllServerEvents, { type: "session.created" }>,
  deps: EventRouterDependencies
) => void;
type _SessionUpdatedHandler = (
  event: Extract<AllServerEvents, { type: "session.updated" }>,
  deps: EventRouterDependencies
) => void;
type _SessionStatusHandler = (
  event: Extract<AllServerEvents, { type: "session.status" }>,
  deps: EventRouterDependencies
) => void;
type _ServerInstanceDisposedHandler = (
  event: Extract<AllServerEvents, { type: "server.instance.disposed" }>,
  deps: EventRouterDependencies
) => void;

// Unified handler type that accepts all events and does type narrowing
type EventHandler = (event: AllServerEvents, deps: EventRouterDependencies) => void;

// Import handlers
import { handleMessageUpdated as _handleMessageUpdated } from "./message/message-events";
import {
  handlePartRemoved as _handlePartRemoved,
  handlePartUpdated as _handlePartUpdated,
} from "./part/part-events";
import {
  handleServerInstanceDisposed as _handleServerInstanceDisposed,
  handleSessionCreated as _handleSessionCreated,
  handleSessionStatus as _handleSessionStatus,
  handleSessionUpdated as _handleSessionUpdated,
} from "./session/session-events";

/**
 * Wrap handlers to accept AllServerEvents and do type narrowing
 */
const handleMessageUpdated: EventHandler = (event, deps) => {
  if (event.type === "message.updated") {
    _handleMessageUpdated(event, deps);
  }
};

const handlePartUpdated: EventHandler = (event, deps) => {
  if (event.type === "message.part.updated") {
    _handlePartUpdated(event, deps);
  }
};

const handlePartRemoved: EventHandler = (event, deps) => {
  if (event.type === "message.part.removed") {
    _handlePartRemoved(event, deps);
  }
};

const handleSessionCreated: EventHandler = (event, deps) => {
  if (event.type === "session.created") {
    _handleSessionCreated(event, deps);
  }
};

const handleSessionUpdated: EventHandler = (event, deps) => {
  if (event.type === "session.updated") {
    _handleSessionUpdated(event, deps);
  }
};

const handleSessionStatus: EventHandler = (event, deps) => {
  if (event.type === "session.status") {
    _handleSessionStatus(event, deps);
  }
};

const handleServerInstanceDisposed: EventHandler = (event, deps) => {
  if (event.type === "server.instance.disposed") {
    _handleServerInstanceDisposed(event, deps);
  }
};

/**
 * Map event types to their handlers
 */
const HANDLERS: Partial<Record<EventType, EventHandler>> = {
  // Message events
  "message.updated": handleMessageUpdated,
  "message.part.updated": handlePartUpdated,
  "message.part.removed": handlePartRemoved,

  // Session events
  "session.created": handleSessionCreated,
  "session.updated": handleSessionUpdated,
  "session.status": handleSessionStatus,

  // Server events
  "server.instance.disposed": handleServerInstanceDisposed,
};

/**
 * Create event router with store dependencies
 */
export function createEventRouter(deps: EventRouterDependencies): EventRouter {
  /**
   * Handle a single event
   */
  const handle = (event: AllServerEvents): void => {
    const handler = HANDLERS[event.type];

    if (handler) {
      try {
        handler(event, deps);
      } catch (error) {
        console.error(`[EventRouter] Error handling ${event.type}:`, error);
      }
    }
  };

  /**
   * Handle multiple events with batching
   * All updates are batched for efficient reactive updates
   */
  const handleBatch = (events: AllServerEvents[]): void => {
    batch(() => {
      for (const event of events) {
        handle(event);
      }
    });
  };

  return { handle, handleBatch };
}
