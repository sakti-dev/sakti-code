/**
 * Fixture Loader
 *
 * Loads and applies event ordering fixtures to real stores for integration testing.
 * Part of Batch 5: WS7 Testing Overhaul
 *
 * @package @sakti-code/desktop/tests
 */

import { applyEventToStores } from "@/core/chat/domain/event-router-adapter";
import type { MessageActions, MessageWithId } from "@/core/state/stores/message-store";
import type { PartActions } from "@/core/state/stores/part-store";
import type { SessionActions } from "@/core/state/stores/session-store";
import type { EventOrderingFixture } from "@sakti-code/shared";
import type {
  AllServerEvents,
  ServerEvent,
  TypedServerEvent,
} from "@sakti-code/shared/event-types";

/**
 * Store actions interface for fixture application
 */
export interface StoreActions {
  message: MessageActions;
  part: PartActions;
  session: SessionActions;
}

/**
 * Type guard for message.updated events
 */
function isMessageUpdatedEvent(
  event: AllServerEvents
): event is TypedServerEvent<"message.updated"> {
  return event.type === "message.updated";
}

/**
 * Type guard for message.part.updated events
 */
function isMessagePartUpdatedEvent(
  event: AllServerEvents
): event is TypedServerEvent<"message.part.updated"> {
  return event.type === "message.part.updated";
}

/**
 * Type guard for session.status events
 */
function isSessionStatusEvent(event: AllServerEvents): event is TypedServerEvent<"session.status"> {
  return event.type === "session.status";
}

/**
 * Type guard for session.created events
 */
function isSessionCreatedEvent(
  event: AllServerEvents
): event is TypedServerEvent<"session.created"> {
  return event.type === "session.created";
}

/**
 * Apply a single event to stores
 */
export async function applyEvent(event: AllServerEvents, actions: StoreActions): Promise<void> {
  const normalized: ServerEvent<string, Record<string, unknown>> = {
    ...event,
    properties: event.properties as Record<string, unknown>,
  };
  await applyEventToStores(normalized, actions.message, actions.part, actions.session);
}

/**
 * Legacy direct-apply helper for tests that intentionally bypass router behavior.
 */
export function applyEventDirect(event: AllServerEvents, actions: StoreActions): void {
  if (isMessageUpdatedEvent(event)) {
    const info = event.properties.info as {
      id: string;
      role: "user" | "assistant" | "system";
      sessionID: string;
      parentId?: string;
      content?: string;
    };
    const message: MessageWithId = {
      id: info.id,
      role: info.role,
      sessionID: info.sessionID,
      parentID: info.parentId,
      content: info.content,
      time: {
        created: event.timestamp,
      },
    };
    actions.message.upsert(message);
  } else if (isMessagePartUpdatedEvent(event)) {
    actions.part.upsert(event.properties.part);
  } else if (isSessionStatusEvent(event)) {
    actions.session.setStatus(event.properties.sessionID, event.properties.status);
  } else if (isSessionCreatedEvent(event)) {
    actions.session.upsert({
      sessionID: event.properties.sessionID,
      directory: event.properties.directory,
    });
  }
  // Other event types are ignored for now
}

/**
 * Apply all events from a fixture to stores
 * Automatically creates session if not present in fixture events
 * Reorders events to ensure referential integrity (sessions → messages → parts)
 */
export async function applyFixture(
  fixture: EventOrderingFixture,
  actions: StoreActions
): Promise<void> {
  // Check if session.created event exists
  const hasSessionCreated = fixture.events.some(e => e.type === "session.created");

  // Auto-create session if not present
  if (!hasSessionCreated) {
    actions.session.upsert({
      sessionID: fixture.sessionId,
      directory: "/test",
    });
  }

  // Preserve fixture ordering to test real out-of-order behavior.
  for (const event of fixture.events) {
    await applyEvent(event, actions);
  }
}

/**
 * Apply events sequentially with optional delay between each
 */
export async function applyFixtureAsync(
  fixture: EventOrderingFixture,
  actions: StoreActions,
  delayMs = 0
): Promise<void> {
  for (const event of fixture.events) {
    await applyEvent(event, actions);
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Get expected behavior from fixture for assertions
 */
export function getExpectedBehavior(fixture: EventOrderingFixture) {
  return fixture.expectedBehavior;
}

/**
 * Create store actions from StoreProvider context value
 */
export function extractStoreActions(storeContext: {
  message: [unknown, MessageActions];
  part: [unknown, PartActions];
  session: [unknown, SessionActions];
}): StoreActions {
  return {
    message: storeContext.message[1],
    part: storeContext.part[1],
    session: storeContext.session[1],
  };
}
