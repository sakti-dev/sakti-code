/**
 * SSE Catch-up Refetch Flow Tests
 *
 * Validates reconnect catch-up behavior against the real EventSource implementation.
 */

import { createEventSource, type EventSourceError } from "@/core/services/sse/event-source";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: MockEventSource[] = [];

  readyState = MockEventSource.CONNECTING;
  url: string;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  emitOpen() {
    this.readyState = MockEventSource.OPEN;
    const listeners = this.listeners.get("open") ?? [];
    for (const listener of listeners) listener(new Event("open"));
  }

  emitMessage(data: unknown, lastEventId?: string) {
    const listeners = this.listeners.get("message") ?? [];
    const event = new MessageEvent("message", {
      data: typeof data === "string" ? data : JSON.stringify(data),
      lastEventId,
    });
    for (const listener of listeners) listener(event);
  }

  emitError() {
    this.readyState = MockEventSource.CLOSED;
    this.onerror?.(new Event("error"));
  }
}

describe("SSE Catch-up Refetch Flow", () => {
  let originalFetch: typeof global.fetch;
  let originalEventSource: typeof global.EventSource;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    originalFetch = global.fetch;
    originalEventSource = global.EventSource;
    fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
    Object.defineProperty(globalThis, "EventSource", {
      value: MockEventSource,
      configurable: true,
      writable: true,
    });
    MockEventSource.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    Object.defineProperty(globalThis, "EventSource", {
      value: originalEventSource,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("triggers catch-up on reconnect with /api/events + sessionId + afterEventId", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    });

    const onReconnect = vi.fn().mockResolvedValue(undefined);
    const connection = createEventSource({
      baseUrl: "http://localhost:3000",
      onReconnect,
      reconnectDelay: { base: 10, max: 10, jitter: 0 },
    });

    connection.connect();
    const first = MockEventSource.instances[0]!;
    first.emitOpen();
    first.emitMessage(
      {
        type: "message.updated",
        properties: { info: { id: "msg-1", role: "user", sessionID: "session-1" } },
        eventId: "019c4e41-d107-736e-95d2-ea70c3175a8c",
        sequence: 1,
        timestamp: Date.now(),
        sessionID: "session-1",
      },
      "019c4e41-d107-736e-95d2-ea70c3175a8c"
    );

    first.emitError();
    await vi.advanceTimersByTimeAsync(10);

    expect(onReconnect).toHaveBeenCalledWith("019c4e41-d107-736e-95d2-ea70c3175a8c");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/events");
    expect(url.searchParams.get("sessionId")).toBe("session-1");
    expect(url.searchParams.get("afterEventId")).toBe("019c4e41-d107-736e-95d2-ea70c3175a8c");

    connection.disconnect();
  });

  it("emits replayed events from catch-up fetch via onEvent", async () => {
    const replayEvent = {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          type: "text",
          messageID: "msg-2",
          sessionID: "session-1",
          text: "Recovered content",
        },
      },
      eventId: "019c4e41-d108-736e-95d2-ea70c3175a8c",
      sequence: 2,
      timestamp: Date.now(),
      sessionID: "session-1",
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [replayEvent] }),
    });

    const onEvent = vi.fn();
    const connection = createEventSource({
      baseUrl: "http://localhost:3000",
      onEvent,
      reconnectDelay: { base: 10, max: 10, jitter: 0 },
    });

    connection.connect();
    const first = MockEventSource.instances[0]!;
    first.emitOpen();
    first.emitMessage(
      {
        type: "message.updated",
        properties: { info: { id: "msg-2", role: "assistant", sessionID: "session-1" } },
        eventId: "019c4e41-d107-736e-95d2-ea70c3175a8c",
        sequence: 1,
        timestamp: Date.now(),
        sessionID: "session-1",
      },
      "019c4e41-d107-736e-95d2-ea70c3175a8c"
    );

    first.emitError();
    await vi.advanceTimersByTimeAsync(10);

    expect(onEvent).toHaveBeenCalledWith(replayEvent);

    connection.disconnect();
  });

  it("uses payload eventId fallback when SSE lastEventId is unavailable", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    });

    const connection = createEventSource({
      baseUrl: "http://localhost:3000",
      reconnectDelay: { base: 10, max: 10, jitter: 0 },
    });

    connection.connect();
    const first = MockEventSource.instances[0]!;
    first.emitOpen();
    first.emitMessage({
      type: "message.updated",
      properties: { info: { id: "msg-1", role: "user", sessionID: "session-1" } },
      eventId: "019c4e41-d107-736e-95d2-ea70c3175a8c",
      sequence: 1,
      timestamp: Date.now(),
      sessionID: "session-1",
    });

    first.emitError();
    await vi.advanceTimersByTimeAsync(10);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("afterEventId")).toBe("019c4e41-d107-736e-95d2-ea70c3175a8c");

    connection.disconnect();
  });

  it("does not attempt catch-up when session ID is unknown", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    });

    const connection = createEventSource({
      baseUrl: "http://localhost:3000",
      reconnectDelay: { base: 10, max: 10, jitter: 0 },
    });

    connection.connect();
    const first = MockEventSource.instances[0]!;
    first.emitOpen();
    first.emitMessage(
      {
        type: "server.heartbeat",
        properties: {},
        eventId: "019c4e41-d107-736e-95d2-ea70c3175a8c",
        sequence: 1,
        timestamp: Date.now(),
      },
      "019c4e41-d107-736e-95d2-ea70c3175a8c"
    );

    first.emitError();
    await vi.advanceTimersByTimeAsync(10);

    expect(fetchMock).not.toHaveBeenCalled();
    connection.disconnect();
  });

  it("surfaces catch-up fetch failures via onError", async () => {
    fetchMock.mockRejectedValue(new Error("Network down"));
    const onError = vi.fn<(error: EventSourceError) => void>();

    const connection = createEventSource({
      baseUrl: "http://localhost:3000",
      onError,
      reconnectDelay: { base: 10, max: 10, jitter: 0 },
    });

    connection.connect();
    const first = MockEventSource.instances[0]!;
    first.emitOpen();
    first.emitMessage(
      {
        type: "message.updated",
        properties: { info: { id: "msg-1", role: "user", sessionID: "session-1" } },
        eventId: "019c4e41-d107-736e-95d2-ea70c3175a8c",
        sequence: 1,
        timestamp: Date.now(),
        sessionID: "session-1",
      },
      "019c4e41-d107-736e-95d2-ea70c3175a8c"
    );

    first.emitError();
    await vi.advanceTimersByTimeAsync(10);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "network_error",
        retryable: true,
      })
    );
    connection.disconnect();
  });
});
