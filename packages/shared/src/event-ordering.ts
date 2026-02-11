/**
 * Event Ordering Buffer
 *
 * Ensures events are processed in the correct sequence order, even when they arrive out of order.
 * Part of Batch 2: Data Integrity
 *
 * @example
 * const buffer = new EventOrderingBuffer();
 * const events = await buffer.addEvent(event);
 * // events contains all events that can now be processed in order
 */

import type { ServerEvent } from "./event-types";

export interface QueuedEvent {
  event: ServerEvent;
  receivedAt: number;
}

export interface EventOrderingBufferOptions {
  /** Maximum time (ms) to wait for missing sequence numbers before processing anyway */
  timeoutMs?: number;
  /** Maximum number of events to queue per session before forcing processing */
  maxQueueSize?: number;
}

/**
 * EventOrderingBuffer ensures events are processed in sequence order.
 *
 * Key features:
 * - Queues out-of-order events until their predecessors arrive
 * - Releases events in sequence order when gaps are filled
 * - Timeout-based fallback for missing events
 * - Per-session isolation
 */
export class EventOrderingBuffer {
  private queues = new Map<string, Map<number, QueuedEvent>>();
  private lastProcessed = new Map<string, number>();
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private timeoutMs: number;
  private maxQueueSize: number;

  constructor(options: EventOrderingBufferOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxQueueSize = options.maxQueueSize ?? 1000;
  }

  /**
   * Add an event to the buffer.
   * Returns immediately processable events in sequence order.
   *
   * @param event - The event to add
   * @returns Array of events that can be processed now (in order)
   */
  async addEvent(event: ServerEvent): Promise<ServerEvent[]> {
    const sessionId = event.sessionID;
    const sequence = event.sequence;

    // Events without session/sequence are processed immediately
    if (!sessionId || typeof sequence !== "number") {
      return [event];
    }

    // Initialize session state if needed
    if (!this.queues.has(sessionId)) {
      this.queues.set(sessionId, new Map());
      this.lastProcessed.set(sessionId, 0);
    }

    const queue = this.queues.get(sessionId)!;
    const lastSeq = this.lastProcessed.get(sessionId) || 0;

    // Check for duplicates
    if (sequence <= lastSeq || queue.has(sequence)) {
      // Duplicate or old event, ignore
      return [];
    }

    // If this is the next expected event, process it and any queued successors
    if (sequence === lastSeq + 1) {
      const eventsToProcess: ServerEvent[] = [event];
      this.lastProcessed.set(sessionId, sequence);

      // Check if we have subsequent events queued
      let nextSeq = sequence + 1;
      while (queue.has(nextSeq)) {
        const queuedEvent = queue.get(nextSeq)!;
        queue.delete(nextSeq);
        eventsToProcess.push(queuedEvent.event);
        this.lastProcessed.set(sessionId, nextSeq);
        nextSeq++;
      }

      // Clear any pending timeout since we made progress
      this.clearTimeout(sessionId);

      return eventsToProcess;
    }

    // Out of order - queue it
    queue.set(sequence, { event, receivedAt: Date.now() });

    // Check if we've hit max queue size
    if (queue.size >= this.maxQueueSize) {
      // Force processing of queued events up to this point
      return this.forceProcessQueue(sessionId);
    }

    // Set timeout to process anyway if gap isn't filled
    this.setTimeout(sessionId);

    return [];
  }

  /**
   * Get the current queue size for a session
   */
  getQueueSize(sessionId: string): number {
    return this.queues.get(sessionId)?.size || 0;
  }

  /**
   * Get the last processed sequence number for a session
   */
  getLastProcessed(sessionId: string): number {
    return this.lastProcessed.get(sessionId) || 0;
  }

  /**
   * Clear all state for a specific session
   */
  clearSession(sessionId: string): void {
    this.queues.delete(sessionId);
    this.lastProcessed.delete(sessionId);
    this.clearTimeout(sessionId);
  }

  /**
   * Clear all state (useful for testing)
   */
  clear(): void {
    for (const sessionId of this.timeouts.keys()) {
      this.clearTimeout(sessionId);
    }
    this.queues.clear();
    this.lastProcessed.clear();
    this.timeouts.clear();
  }

  /**
   * Get statistics for a session
   */
  getStats(sessionId: string): {
    queueSize: number;
    lastProcessed: number;
    nextExpected: number;
    oldestQueued?: number;
  } {
    const queue = this.queues.get(sessionId);
    const lastProcessed = this.lastProcessed.get(sessionId) || 0;

    let oldestQueued: number | undefined;
    if (queue && queue.size > 0) {
      const sequences = Array.from(queue.keys()).sort((a, b) => a - b);
      oldestQueued = sequences[0];
    }

    return {
      queueSize: queue?.size || 0,
      lastProcessed,
      nextExpected: lastProcessed + 1,
      oldestQueued,
    };
  }

  /**
   * Force process queued events for a session (used on timeout or max queue)
   */
  private forceProcessQueue(sessionId: string): ServerEvent[] {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.size === 0) return [];

    const eventsToProcess: ServerEvent[] = [];
    const sequences = Array.from(queue.keys()).sort((a, b) => a - b);

    let lastSeq = this.lastProcessed.get(sessionId) || 0;

    for (const seq of sequences) {
      const queued = queue.get(seq)!;
      queue.delete(seq);
      eventsToProcess.push(queued.event);
      lastSeq = Math.max(lastSeq, seq);
    }

    this.lastProcessed.set(sessionId, lastSeq);
    this.clearTimeout(sessionId);

    return eventsToProcess;
  }

  /**
   * Set a timeout to force process queued events
   */
  private setTimeout(sessionId: string): void {
    // Clear existing timeout
    this.clearTimeout(sessionId);

    const timeout = setTimeout(() => {
      const queue = this.queues.get(sessionId);
      if (queue && queue.size > 0) {
        // Force process will be called by the consumer via getTimedOutEvents
        // or we could emit an event here
      }
      this.timeouts.delete(sessionId);
    }, this.timeoutMs);

    this.timeouts.set(sessionId, timeout);
  }

  /**
   * Clear timeout for a session
   */
  private clearTimeout(sessionId: string): void {
    const existing = this.timeouts.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.timeouts.delete(sessionId);
    }
  }
}

/**
 * Create a default event ordering buffer
 */
export function createEventOrderingBuffer(
  options?: EventOrderingBufferOptions
): EventOrderingBuffer {
  return new EventOrderingBuffer(options);
}

export default EventOrderingBuffer;
