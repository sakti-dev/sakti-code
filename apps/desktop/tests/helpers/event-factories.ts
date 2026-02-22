/**
 * Event Factories
 *
 * Type-safe event construction helpers for tests.
 * Part of Batch 6: Test Helpers Enhancement
 *
 * @package @sakti-code/desktop/tests
 */

import type { AllServerEvents, EventType, TypedServerEvent } from "@sakti-code/shared/event-types";

/**
 * Base event metadata
 */
export interface BaseEventMetadata {
  eventId: string;
  sequence: number;
  timestamp: number;
  sessionID?: string;
  directory?: string;
}

/**
 * Create a typed server event with required metadata
 */
type EventOfType<T extends EventType> = Extract<AllServerEvents, { type: T }>;

export function makeEvent<T extends EventType>(
  type: T,
  properties: EventOfType<T>["properties"],
  metadata: BaseEventMetadata
): TypedServerEvent<T> {
  return {
    type,
    properties,
    eventId: metadata.eventId,
    sequence: metadata.sequence,
    timestamp: metadata.timestamp,
    sessionID: metadata.sessionID ?? "test-session",
    directory: metadata.directory ?? "/test",
  } as TypedServerEvent<T>;
}

/**
 * Get next test event metadata
 */
export function nextEventMetadata(base: BaseEventMetadata): BaseEventMetadata {
  return {
    eventId: `evt-${Date.now()}`,
    sequence: base.sequence + 1,
    timestamp: Date.now(),
    sessionID: base.sessionID ?? "test-session",
    directory: base.directory ?? "/test",
  };
}
