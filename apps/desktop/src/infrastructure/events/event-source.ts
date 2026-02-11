/**
 * Enhanced EventSource Layer
 *
 * Manages SSE connection with error boundaries and enhanced reconnection.
 */

import type { EventMap, EventType, ServerEvent } from "@ekacode/shared/event-types";

export interface EventSourceConfig {
  baseUrl: string;
  token?: string;
  onEvent?: (event: TypedSSEEvent) => void;
  onError?: (error: EventSourceError) => void;
  onOpen?: () => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  reconnectDelay?: {
    base: number; // Default: 1000ms
    max: number; // Default: 30000ms
    jitter: number; // Default: 500ms
  };
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
    reconnectDelay = { base: 1000, max: 30000, jitter: 500 },
  } = config;

  let eventSource: EventSource | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;
  let lastEventId: string | null = null;
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

    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
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
      if (evt.lastEventId) {
        lastEventId = evt.lastEventId;
      }

      metrics.totalEventsReceived += 1;

      const parsed = JSON.parse(evt.data) as unknown;
      onEvent?.(parsed as TypedSSEEvent);
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
