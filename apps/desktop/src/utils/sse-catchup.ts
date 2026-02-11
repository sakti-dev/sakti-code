/**
 * SSE Catch-up Utility
 *
 * Handles catch-up synchronization when SSE reconnection with lastEventId fails.
 * Falls back to API-based event fetching to fill gaps.
 *
 * Updated for Batch 2: Data Integrity - Completed implementation with event processing
 */

import { EventDeduplicator } from "@ekacode/shared/event-deduplication";
import { validateEventComprehensive } from "@ekacode/shared/event-guards";
import { EventOrderingBuffer } from "@ekacode/shared/event-ordering";
import type { ServerEvent } from "@ekacode/shared/event-types";

export interface CatchupConfig {
  /** Maximum number of events to fetch in catch-up */
  maxEvents?: number;
  /** Timeout for catch-up request (ms) */
  timeout?: number;
  /** Optional abort signal for cancelling */
  signal?: AbortSignal;
  /** Last processed sequence number for this session */
  lastSequence?: number;
}

export interface CatchupResult {
  success: boolean;
  eventsCaughtUp: number;
  eventsProcessed: number;
  error?: string;
}

/**
 * SDK client interface for catchup operations
 */
export interface SDKClientForCatchup {
  session: {
    messages(options: {
      sessionID: string;
      limit?: number;
      offset?: number;
      signal?: AbortSignal;
    }): Promise<SessionMessagesResponse>;
  };
  events?: {
    getBySession(options: {
      sessionID: string;
      afterSequence?: number;
      limit?: number;
      signal?: AbortSignal;
    }): Promise<EventsResponse>;
  };
}

export interface SessionMessagesResponse {
  sessionID: string;
  messages: unknown[];
  hasMore: boolean;
  total?: number;
}

export interface EventsResponse {
  sessionID: string;
  events: ServerEvent[];
  hasMore: boolean;
  total?: number;
}

/**
 * Event processor function type
 */
export type EventProcessor = (events: ServerEvent[]) => Promise<void> | void;

/**
 * Determine if catch-up is needed
 *
 * @param disconnectDuration - Time disconnected in ms
 * @param lastEventId - Last event ID before disconnect
 * @returns true if catch-up should be attempted
 */
export function shouldCatchup(disconnectDuration: number, lastEventId: string | null): boolean {
  // Always attempt catch-up if we have a lastEventId
  // and were disconnected for more than 1 second
  return lastEventId !== null && disconnectDuration > 1000;
}

/**
 * Process caught-up events through ordering buffer and deduplicator
 *
 * Batch 2: Data Integrity - Processes events in correct order with deduplication
 */
async function processCaughtUpEvents(
  events: ServerEvent[],
  processor: EventProcessor,
  orderingBuffer: EventOrderingBuffer,
  deduplicator: EventDeduplicator
): Promise<number> {
  let processedCount = 0;

  for (const event of events) {
    // Validate event
    const validation = validateEventComprehensive(event);
    if (!validation.valid) {
      console.warn("[sse-catchup] Invalid event during catch-up:", validation.error);
      continue;
    }

    // Deduplication check
    if (deduplicator.isDuplicate(event.eventId)) {
      console.debug("[sse-catchup] Duplicate event detected, skipping:", event.eventId);
      continue;
    }

    // Ordering - add to buffer and get processable events
    const eventsToProcess = await orderingBuffer.addEvent(event);

    // Process all events that are now ready
    if (eventsToProcess.length > 0) {
      try {
        await processor(eventsToProcess);
        processedCount += eventsToProcess.length;
      } catch (error) {
        console.error("[sse-catchup] Error processing events:", error);
      }
    }
  }

  return processedCount;
}

/**
 * Perform catch-up sync for a session
 *
 * Batch 2: Data Integrity - Now processes events through stores with ordering
 *
 * @param client - SDK client for API calls
 * @param sessionId - Session to catch up
 * @param config - Catchup configuration
 * @param processor - Function to process caught-up events
 * @returns Catchup result with event count
 */
export async function catchupSession(
  client: SDKClientForCatchup,
  sessionId: string,
  config: CatchupConfig = {},
  processor?: EventProcessor
): Promise<CatchupResult> {
  const { maxEvents = 100, timeout = 5000, signal: externalSignal, lastSequence = 0 } = config;

  // Initialize ordering and deduplication for catch-up
  const orderingBuffer = new EventOrderingBuffer({
    timeoutMs: timeout,
    maxQueueSize: maxEvents,
  });
  const deduplicator = new EventDeduplicator({ maxSize: maxEvents * 2 });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine external signal with timeout signal
    function onExternalAbort() {
      controller.abort();
    }
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeoutId);
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    let events: ServerEvent[] = [];

    // Try to fetch events from events endpoint first (preferred)
    if (client.events) {
      try {
        const response = await client.events.getBySession({
          sessionID: sessionId,
          afterSequence: lastSequence > 0 ? lastSequence : undefined,
          limit: maxEvents,
          signal: controller.signal,
        });
        events = response.events || [];
      } catch (error) {
        console.warn("[sse-catchup] Events endpoint failed, falling back to messages:", error);
      }
    }

    // Fallback to messages endpoint if events not available or failed
    if (events.length === 0) {
      const response = await client.session.messages({
        sessionID: sessionId,
        limit: maxEvents,
        offset: 0,
        signal: controller.signal,
      });

      // Convert messages to events format
      events = (response.messages || []).map((msg: unknown) => ({
        type: "message.updated",
        properties: { info: msg },
        eventId: (msg as { id?: string })?.id || "",
        sequence: 0, // Messages don't have sequence numbers
        timestamp: Date.now(),
        sessionID: sessionId,
      })) as ServerEvent[];
    }

    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }

    if (!events || events.length === 0) {
      return { success: true, eventsCaughtUp: 0, eventsProcessed: 0 };
    }

    // Batch 2: Data Integrity - Process events through stores
    let processedCount = 0;
    if (processor) {
      processedCount = await processCaughtUpEvents(events, processor, orderingBuffer, deduplicator);
    }

    return {
      success: true,
      eventsCaughtUp: events.length,
      eventsProcessed: processedCount,
    };
  } catch (error) {
    return {
      success: false,
      eventsCaughtUp: 0,
      eventsProcessed: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Calculate catch-up backoff delay
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in ms (default 1000)
 * @param maxDelay - Maximum delay in ms (default 10000)
 * @returns Delay in ms
 */
export function getCatchupBackoff(
  attempt: number,
  baseDelay: number = 1000,
  maxDelay: number = 10000
): number {
  return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
}

/**
 * Create a catch-up controller for managing multiple session catch-ups
 */
export class CatchupController {
  private active = new Map<string, AbortController>();
  private results = new Map<string, CatchupResult>();
  private orderingBuffers = new Map<string, EventOrderingBuffer>();
  private deduplicators = new Map<string, EventDeduplicator>();

  /**
   * Start catch-up for a session
   */
  async startCatchup(
    sessionId: string,
    client: SDKClientForCatchup,
    config: CatchupConfig = {},
    processor?: EventProcessor
  ): Promise<CatchupResult> {
    // Cancel existing catch-up for this session
    this.cancelCatchup(sessionId);

    const controller = new AbortController();
    this.active.set(sessionId, controller);

    // Initialize ordering and deduplication for this session
    this.orderingBuffers.set(
      sessionId,
      new EventOrderingBuffer({
        timeoutMs: config.timeout || 30000,
        maxQueueSize: config.maxEvents || 1000,
      })
    );
    this.deduplicators.set(
      sessionId,
      new EventDeduplicator({
        maxSize: (config.maxEvents || 1000) * 2,
      })
    );

    try {
      const result = await catchupSession(
        client,
        sessionId,
        {
          ...config,
          signal: controller.signal,
        },
        processor
      );
      this.results.set(sessionId, result);
      return result;
    } finally {
      this.active.delete(sessionId);
    }
  }

  /**
   * Cancel catch-up for a session
   */
  cancelCatchup(sessionId: string): void {
    const controller = this.active.get(sessionId);
    if (controller) {
      controller.abort();
      this.active.delete(sessionId);
    }
    this.orderingBuffers.delete(sessionId);
    this.deduplicators.delete(sessionId);
  }

  /**
   * Get result of a catch-up
   */
  getResult(sessionId: string): CatchupResult | undefined {
    return this.results.get(sessionId);
  }

  /**
   * Clear all results
   */
  clearResults(): void {
    this.results.clear();
  }

  /**
   * Cancel all active catch-ups
   */
  cancelAll(): void {
    for (const controller of this.active.values()) {
      controller.abort();
    }
    this.active.clear();
    this.orderingBuffers.clear();
    this.deduplicators.clear();
  }

  /**
   * Get ordering buffer for a session (for testing/debugging)
   */
  getOrderingBuffer(sessionId: string): EventOrderingBuffer | undefined {
    return this.orderingBuffers.get(sessionId);
  }

  /**
   * Get deduplicator for a session (for testing/debugging)
   */
  getDeduplicator(sessionId: string): EventDeduplicator | undefined {
    return this.deduplicators.get(sessionId);
  }
}
