/**
 * Event Simulator
 *
 * Simulates SSE events and EventSource for integration testing.
 * Part of Batch 5: WS7 Testing Overhaul
 *
 * @package @sakti-code/desktop/tests
 */

import type { AllServerEvents } from "@sakti-code/shared/event-types";

/**
 * Mock EventSource for testing reconnect/catch-up scenarios
 */
export class MockEventSource extends EventTarget {
  public static CONNECTING = 0;
  public static OPEN = 1;
  public static CLOSED = 2;

  public readyState = MockEventSource.CONNECTING;
  public url: string;
  public withCredentials = false;

  private eventListeners: Map<string, EventListener[]> = new Map();
  private shouldFailNext = false;
  private reconnectDelay = 1000;
  private eventQueue: Array<{ type: string; data: string }> = [];

  constructor(url: string | URL, _eventSourceInitDict?: EventSourceInit) {
    super();
    this.url = url.toString();
  }

  /**
   * Simulate successful connection
   */
  connect(): void {
    this.readyState = MockEventSource.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  /**
   * Simulate an error
   */
  error(): void {
    this.readyState = MockEventSource.CLOSED;
    this.dispatchEvent(new Event("error"));
  }

  /**
   * Simulate receiving a server-sent event
   */
  emit(eventType: string, data: unknown): void {
    const messageEvent = new MessageEvent(eventType, {
      data: typeof data === "string" ? data : JSON.stringify(data),
      origin: this.url,
    });
    this.dispatchEvent(messageEvent);
  }

  /**
   * Queue events to be emitted sequentially
   */
  queueEvent(type: string, data: unknown): void {
    this.eventQueue.push({
      type,
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }

  /**
   * Emit all queued events with optional delay
   */
  async emitQueued(delayMs = 0): Promise<void> {
    for (const event of this.eventQueue) {
      this.emit(event.type, event.data);
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    this.eventQueue = [];
  }

  /**
   * Simulate disconnect/reconnect
   */
  disconnect(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  /**
   * Reconnect and emit catch-up events
   */
  async reconnect(catchUpEvents: Array<{ type: string; data: unknown }>): Promise<void> {
    this.readyState = MockEventSource.CONNECTING;
    await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
    this.connect();

    // Emit catch-up events
    for (const event of catchUpEvents) {
      this.emit(event.type, event.data);
    }
  }

  /**
   * Configure to fail on next connection attempt
   */
  setShouldFailNext(shouldFail: boolean): void {
    this.shouldFailNext = shouldFail;
  }

  /**
   * Set reconnect delay
   */
  setReconnectDelay(delayMs: number): void {
    this.reconnectDelay = delayMs;
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }
}

/**
 * Create a server event for testing
 */
export function createServerEvent(
  type: string,
  properties: Record<string, unknown>,
  sessionID: string,
  sequence: number
): AllServerEvents {
  return {
    type,
    properties,
    sessionID,
    eventId: `0194e2c0-5c7a-7b8c-9d0e-${sequence.toString(16).padStart(12, "0")}`,
    sequence,
    timestamp: Date.now(),
  } as AllServerEvents;
}

/**
 * Wait for a specific event to be emitted
 */
export function waitForEvent(
  eventSource: MockEventSource,
  eventType: string,
  timeoutMs = 5000
): Promise<MessageEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventType}`));
    }, timeoutMs);

    const handler = (event: Event) => {
      clearTimeout(timeout);
      eventSource.removeEventListener(eventType, handler);
      resolve(event as MessageEvent);
    };

    eventSource.addEventListener(eventType, handler);
  });
}

/**
 * Simulate stream events from a fixture
 */
export async function simulateStreamEvents(
  eventSource: MockEventSource,
  events: AllServerEvents[],
  delayBetweenMs = 0
): Promise<void> {
  for (const event of events) {
    eventSource.emit("message", event);
    if (delayBetweenMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenMs));
    }
  }
}
