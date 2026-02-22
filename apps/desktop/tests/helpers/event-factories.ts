/**
 * Event Factories
 *
 * Type-safe event construction helpers for tests.
 * Part of Batch 6: Test Helpers Enhancement
 *
 * @package @sakti-code/desktop/tests
 */

import type { AllServerEvents, ServerEvent } from "@sakti-code/shared/event-types";

/**
 * Base event metadata
 */
export interface BaseEventMetadata {
  eventId: string;
  sequence: number;
  timestamp: number;
}

/**
 * Create a typed server event with required metadata
 */
export function makeEvent<T extends AllServerEvents["type"]>(
  type: T,
  properties: Omit<AllServerEvents, "type">,
  metadata: BaseEventMetadata
): ServerEvent<T, Omit<AllServerEvents, "type">> {
  return {
    type,
    properties: properties as AllServerEvents[T]["properties"],
    eventId: metadata.eventId,
    sequence: metadata.sequence,
    timestamp: metadata.timestamp,
    sessionId: metadata.sessionId ?? "test-session",
    directory: metadata.directory ?? "/test",
  } as ServerEvent<T, Omit<AllServerEvents, "type">>;
}

/**
 * Get next test event metadata
 */
export function nextEventMetadata(base: BaseEventMetadata): BaseEventMetadata {
  return {
    eventId: `evt-${Date.now()}`,
    sequence: base.sequence + 1,
    timestamp: Date.now(),
    session: base.sessionId ?? "test-session",
    directory: base.directory ?? "/test",
  };
}
