/**
 * Enhanced EventSource Layer
 *
 * Manages SSE connection with error boundaries and enhanced reconnection.
 */

import type { EventMap, EventType, ServerEvent } from "@sakti-code/shared/event-types";

export interface EventSourceConfig {
  baseUrl: string;
  token?: string;
  onEvent?: (event: TypedSSEEvent) => void;
  onError?: (error: EventSourceError) => void;
  onOpen?: () => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onReconnect?: (lastEventId: string | null) => Promise<void>;
  reconnectDelay?: {
    base: number; // Default: 1000ms
    max: number; // Default: 30000ms
    jitter: number; // Default: 500ms
  };
  /** Enable catch-up refetch on reconnect (default: true) */
  enableCatchUp?: boolean;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "reconnecting";

export interface EventSourceError {
  type: "connection_failed" | "parse_error" | "network_error" | "unknown";
  message: string;
  originalEvent?: Event;
  retryable: boolean;
}

export type TypedSSEEvent = ServerEvent<EventType, EventMap[EventType]>;

export interface EventSourceConnection {
  connect: () => void;
  disconnect: () => void;
  isConnected: () => boolean;
  getStatus: () => ConnectionStatus;
  getMetrics: () => EventSourceMetrics;
}

export interface EventSourceMetrics {
  connectionAttempts: number;
  successfulConnections: number;
  totalEventsReceived: number;
  totalErrors: number;
  currentReconnectDelay: number;
}

export function createEventSource(config: EventSourceConfig): EventSourceConnection {
  const {
    baseUrl,
    token,
    onEvent,
    onError,
    onOpen,
    onStatusChange,
    onReconnect,
    reconnectDelay = { base: 1000, max: 30000, jitter: 500 },
    enableCatchUp = true,
  } = config;

  let eventSource: EventSource | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;
  let lastEventId: string | null = null;
  let lastSessionId: string | null = null;
  let disposed = false;
  let status: ConnectionStatus = "disconnected";

  const metrics: EventSourceMetrics = {
    connectionAttempts: 0,
    successfulConnections: 0,
    totalEventsReceived: 0,
    totalErrors: 0,
    currentReconnectDelay: 0,
  };

  const setStatus = (newStatus: ConnectionStatus) => {
    if (status !== newStatus) {
      status = newStatus;
      onStatusChange?.(status);
    }
  };

  const eventUrl = () => {
    const url = new URL(`${baseUrl}/event`);
    if (token) {
      url.searchParams.set("token", token);
    }
    if (lastEventId) {
      url.searchParams.set("lastEventId", lastEventId);
    }
    return url.toString();
  };

  const fetchCatchUpEvents = async (): Promise<void> => {
    if (!enableCatchUp || !lastEventId) return;
    if (!lastSessionId) {
      console.warn("[EventSource] Skipping catch-up: no known session ID");
      return;
    }

    try {
      const url = new URL(`${baseUrl}/api/events`);
      url.searchParams.set("sessionId", lastSessionId);
      url.searchParams.set("afterEventId", lastEventId);
      url.searchParams.set("limit", "1000");
      if (token) {
        url.searchParams.set("token", token);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Catch-up fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as { events?: TypedSSEEvent[] };
      const events = data.events ?? [];

      // Emit catch-up events
      for (const event of events) {
        if (typeof event.eventId === "string" && event.eventId.length > 0) {
          lastEventId = event.eventId;
        }
        if (typeof event.sessionID === "string" && event.sessionID.length > 0) {
          lastSessionId = event.sessionID;
        }
        onEvent?.(event);
      }

      console.info("[EventSource] Catch-up complete", { eventCount: events.length });
    } catch (error) {
      console.error("[EventSource] Catch-up fetch failed:", error);
      onError?.({
        type: "network_error",
        message: `Catch-up fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
    }
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;

    setStatus("reconnecting");

    const backoff = Math.min(
      reconnectDelay.base * Math.pow(2, reconnectAttempts),
      reconnectDelay.max
    );
    const jitter = Math.floor(Math.random() * reconnectDelay.jitter);
    const delay = backoff + jitter;

    metrics.currentReconnectDelay = delay;
    reconnectAttempts += 1;

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = undefined;

      // Trigger catch-up refetch before reconnecting
      if (enableCatchUp && lastEventId) {
        await onReconnect?.(lastEventId);
        await fetchCatchUpEvents();
      }

      connect();
    }, delay);
  };

  const handleError = (error: EventSourceError) => {
    metrics.totalErrors += 1;
    console.error("[EventSource]", error.message, error);
    onError?.(error);

    if (eventSource) {
      eventSource.close();
      eventSource = undefined;
    }

    if (error.retryable && !disposed) {
      scheduleReconnect();
    } else {
      setStatus("error");
    }
  };

  const handleMessage = (evt: MessageEvent) => {
    try {
      const parsed = JSON.parse(evt.data) as unknown;
      const typed = parsed as Partial<TypedSSEEvent>;

      if (evt.lastEventId) {
        lastEventId = evt.lastEventId;
      } else if (typeof typed.eventId === "string" && typed.eventId.length > 0) {
        // Fallback when SSE id field is unavailable but payload carries eventId.
        lastEventId = typed.eventId;
      }

      if (typeof typed.sessionID === "string" && typed.sessionID.length > 0) {
        lastSessionId = typed.sessionID;
      }

      metrics.totalEventsReceived += 1;
      onEvent?.(typed as TypedSSEEvent);
    } catch (error) {
      handleError({
        type: "parse_error",
        message: `Failed to parse event: ${error instanceof Error ? error.message : String(error)}`,
        originalEvent: evt as unknown as Event,
        retryable: false,
      });
    }
  };

  const connect = () => {
    if (disposed || eventSource) return;

    metrics.connectionAttempts += 1;
    setStatus("connecting");

    try {
      eventSource = new EventSource(eventUrl());
    } catch (error) {
      handleError({
        type: "connection_failed",
        message: `Failed to create EventSource: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
      return;
    }

    eventSource.addEventListener("open", () => {
      reconnectAttempts = 0;
      metrics.successfulConnections += 1;
      metrics.currentReconnectDelay = 0;
      setStatus("connected");
      onOpen?.();
    });

    eventSource.addEventListener("message", handleMessage);

    eventSource.onerror = error => {
      handleError({
        type: "network_error",
        message: "EventSource connection error",
        originalEvent: error as unknown as Event,
        retryable: true,
      });
    };
  };

  const disconnect = () => {
    disposed = true;
    setStatus("disconnected");

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }

    if (eventSource) {
      eventSource.close();
      eventSource = undefined;
    }
  };

  const isConnected = () => {
    return status === "connected" && eventSource?.readyState === EventSource.OPEN;
  };

  const getStatus = () => status;

  const getMetrics = () => ({ ...metrics });

  return {
    connect,
    disconnect,
    isConnected,
    getStatus,
    getMetrics,
  };
}
