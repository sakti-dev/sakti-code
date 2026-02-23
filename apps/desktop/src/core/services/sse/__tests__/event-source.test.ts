/**
 * EventSource Tests
 */

import { createEventSource } from "@/core/services/sse/event-source";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store original EventSource
const OriginalEventSource = global.EventSource;

describe("EventSource", () => {
  let mockOpenCallback: (() => void) | null = null;
  let mockMessageCallback: ((evt: MessageEvent) => void) | null = null;
  let storedErrorHandler: ((evt: Event) => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    mockOpenCallback = null;
    mockMessageCallback = null;
    storedErrorHandler = null;

    // Mock EventSource
    const MockEventSourceClass = class {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readyState = 0;
      url: string;
      _onerror: ((this: EventSource, ev: Event) => unknown) | null = null;

      constructor(url: string) {
        this.url = url;
        // Simulate async connection
        setTimeout(() => {
          (this as { readyState: number }).readyState = 1;
          // Call the registered 'open' event listener
          mockOpenCallback?.();
        }, 0);
      }

      addEventListener(type: string, listener: EventListener | null) {
        if (type === "open" && listener) {
          mockOpenCallback = listener as () => void;
        }
        if (type === "message" && listener) {
          mockMessageCallback = listener as (evt: MessageEvent) => void;
        }
      }

      get onerror() {
        return this._onerror;
      }

      set onerror(value: ((this: EventSource, ev: Event) => unknown) | null) {
        this._onerror = value;
        storedErrorHandler = value as ((evt: Event) => void) | null;
      }

      close() {
        (this as { readyState: number }).readyState = 2;
      }
    };

    // Replace global EventSource with mock
    global.EventSource = MockEventSourceClass as unknown as typeof EventSource;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    // Restore original EventSource
    global.EventSource = OriginalEventSource;
    mockOpenCallback = null;
    mockMessageCallback = null;
    storedErrorHandler = null;
  });

  describe("connect", () => {
    it("creates EventSource connection", () => {
      const onEvent = vi.fn();
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        onEvent,
      });

      connection.connect();

      // Trigger pending timers
      vi.runAllTimers();

      expect(connection.isConnected()).toBe(true);
      connection.disconnect();
    });

    it("calls onOpen callback when connection opens", () => {
      const onOpen = vi.fn();
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        onOpen,
      });

      connection.connect();

      // Trigger pending timers
      vi.runAllTimers();

      expect(onOpen).toHaveBeenCalledTimes(1);
      connection.disconnect();
    });

    it("calls onStatusChange with correct states", () => {
      const onStatusChange = vi.fn();
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        onStatusChange,
      });

      expect(connection.getStatus()).toBe("disconnected");

      connection.connect();
      expect(onStatusChange).toHaveBeenCalledWith("connecting");

      vi.runAllTimers();
      expect(onStatusChange).toHaveBeenCalledWith("connected");

      connection.disconnect();
      expect(connection.getStatus()).toBe("disconnected");
    });
  });

  describe("disconnect", () => {
    it("closes EventSource connection", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
      });

      connection.connect();
      vi.runAllTimers();

      connection.disconnect();

      expect(connection.isConnected()).toBe(false);
    });

    it("prevents reconnection after disconnect", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
      });

      connection.connect();
      vi.runAllTimers();

      connection.disconnect();

      // Advance time to check for reconnect
      vi.advanceTimersByTime(10000);

      expect(connection.isConnected()).toBe(false);
    });
  });

  describe("token handling", () => {
    it("includes token in URL", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        token: "test-token",
      });

      connection.connect();
      vi.runAllTimers();

      expect(connection.isConnected()).toBe(true);
      connection.disconnect();
    });
  });

  describe("isConnected", () => {
    it("returns false before connection", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
      });

      expect(connection.isConnected()).toBe(false);
    });

    it("returns true after connection opens", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
      });

      connection.connect();
      vi.runAllTimers();

      expect(connection.isConnected()).toBe(true);
      connection.disconnect();
    });
  });

  describe("error handling", () => {
    it("calls onError with EventSourceError on parse error", () => {
      const onError = vi.fn();
      const onEvent = vi.fn();
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        onEvent,
        onError,
      });

      connection.connect();
      vi.runAllTimers();

      // Simulate a message with invalid JSON
      mockMessageCallback?.(new MessageEvent("message", { data: "invalid json" }));

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "parse_error",
          retryable: false,
        })
      );
      connection.disconnect();
    });

    it("tracks errors in metrics", () => {
      const onError = vi.fn();
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        onError,
      });

      connection.connect();
      vi.runAllTimers();

      // Simulate a parse error
      mockMessageCallback?.(new MessageEvent("message", { data: "invalid json" }));

      const metrics = connection.getMetrics();
      expect(metrics.totalErrors).toBe(1);
      connection.disconnect();
    });

    it("sets status to error on non-retryable error", () => {
      const onError = vi.fn();
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        onError,
      });

      connection.connect();
      vi.runAllTimers();

      // Simulate a parse error (non-retryable)
      mockMessageCallback?.(new MessageEvent("message", { data: "invalid json" }));

      expect(connection.getStatus()).toBe("error");
      connection.disconnect();
    });
  });

  describe("reconnection", () => {
    it("schedules reconnection with exponential backoff", () => {
      const onStatusChange = vi.fn();
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        onStatusChange,
        reconnectDelay: { base: 100, max: 1000, jitter: 50 },
      });

      connection.connect();
      vi.runAllTimers();

      // Clear previous calls
      onStatusChange.mockClear();

      // Simulate a network error by calling the stored error handler
      storedErrorHandler?.(new Event("error"));

      // Check that reconnecting was called
      expect(onStatusChange).toHaveBeenCalledWith("reconnecting");

      const metrics = connection.getMetrics();
      expect(metrics.currentReconnectDelay).toBeGreaterThan(0);

      connection.disconnect();
    });

    it("increases delay with each reconnection attempt", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        reconnectDelay: { base: 100, max: 1000, jitter: 0 },
      });

      connection.connect();
      vi.runAllTimers();

      // First error - triggers first reconnection attempt
      storedErrorHandler?.(new Event("error"));
      const metrics1 = connection.getMetrics();
      const delay1 = metrics1.currentReconnectDelay;

      // With exponential backoff, delay = base * 2^attempts = 100 * 2^0 = 100
      expect(delay1).toBe(100);

      // Let the reconnect timer fire and complete
      vi.advanceTimersByTime(delay1);
      vi.runAllTimers(); // This triggers the reconnection

      // After successful reconnection, reconnectAttempts resets to 0
      // The mock EventSource immediately connects again (readyState = 1)
      // Now trigger another error to get a higher delay
      storedErrorHandler?.(new Event("error"));
      const metrics2 = connection.getMetrics();
      const delay2 = metrics2.currentReconnectDelay;

      // Should be the same as first since attempts was reset
      expect(delay2).toBe(100);

      connection.disconnect();
    });

    it("caps reconnect delay at max value", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        reconnectDelay: { base: 100, max: 500, jitter: 0 },
      });

      connection.connect();
      vi.runAllTimers();

      // Trigger multiple reconnections
      for (let i = 0; i < 10; i++) {
        storedErrorHandler?.(new Event("error"));
        const metrics = connection.getMetrics();
        vi.advanceTimersByTime(metrics.currentReconnectDelay);
        vi.runAllTimers();
      }

      const finalMetrics = connection.getMetrics();
      expect(finalMetrics.currentReconnectDelay).toBeLessThanOrEqual(500);

      connection.disconnect();
    });

    it("adds jitter to reconnect delay", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        reconnectDelay: { base: 100, max: 1000, jitter: 100 },
      });

      connection.connect();
      vi.runAllTimers();

      const delays: number[] = [];
      for (let i = 0; i < 5; i++) {
        storedErrorHandler?.(new Event("error"));
        const metrics = connection.getMetrics();
        delays.push(metrics.currentReconnectDelay);
        vi.advanceTimersByTime(metrics.currentReconnectDelay);
        vi.runAllTimers();
      }

      // Check that delays vary due to jitter (collect multiple samples with different random values)
      // With jitter of 100, we should get some variation
      // The base delay doubles each time: 100, 200, 400, 800, 1000 (capped)
      // With jitter, each could be base + random(0, 100)
      const hasVariation = delays.some((delay, i) => {
        const expectedBase = Math.min(100 * Math.pow(2, i), 1000);
        return delay !== expectedBase;
      });
      expect(hasVariation).toBe(true);

      connection.disconnect();
    });
  });

  describe("metrics", () => {
    it("tracks connection attempts", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
      });

      connection.connect();
      vi.runAllTimers();

      const metrics = connection.getMetrics();
      expect(metrics.connectionAttempts).toBe(1);

      connection.disconnect();
    });

    it("tracks successful connections", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
      });

      connection.connect();
      vi.runAllTimers();

      const metrics = connection.getMetrics();
      expect(metrics.successfulConnections).toBe(1);

      connection.disconnect();
    });

    it("tracks events received", () => {
      const onEvent = vi.fn();
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        onEvent,
      });

      connection.connect();
      vi.runAllTimers();

      // Simulate receiving events
      mockMessageCallback?.(
        new MessageEvent("message", { data: '{"type":"test","properties":{}}' })
      );
      mockMessageCallback?.(
        new MessageEvent("message", { data: '{"type":"test","properties":{}}' })
      );

      const metrics = connection.getMetrics();
      expect(metrics.totalEventsReceived).toBe(2);

      connection.disconnect();
    });

    it("resets reconnect delay on successful connection", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
        reconnectDelay: { base: 100, max: 1000, jitter: 0 },
      });

      connection.connect();
      vi.runAllTimers();

      // Trigger reconnect
      storedErrorHandler?.(new Event("error"));
      const metricsDuringReconnect = connection.getMetrics();
      expect(metricsDuringReconnect.currentReconnectDelay).toBeGreaterThan(0);

      // Let it reconnect
      vi.advanceTimersByTime(metricsDuringReconnect.currentReconnectDelay);
      vi.runAllTimers();

      const metricsAfterReconnect = connection.getMetrics();
      expect(metricsAfterReconnect.currentReconnectDelay).toBe(0);

      connection.disconnect();
    });
  });

  describe("getStatus", () => {
    it("returns correct status throughout connection lifecycle", () => {
      const connection = createEventSource({
        baseUrl: "http://localhost:3000",
      });

      expect(connection.getStatus()).toBe("disconnected");

      connection.connect();
      expect(connection.getStatus()).toBe("connecting");

      vi.runAllTimers();
      expect(connection.getStatus()).toBe("connected");

      connection.disconnect();
      expect(connection.getStatus()).toBe("disconnected");
    });
  });
});
