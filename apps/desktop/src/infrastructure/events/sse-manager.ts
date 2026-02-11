/**
 * SSE Manager - Integrated SSE connection management
 *
 * Combines event-source, event-coalescer, and event-bus into a single
 * coherent manager for server-sent events.
 *
 * Part of Phase 6: Cleanup & Optimization
 */

import { isKnownEventType } from "@ekacode/shared/event-guards";
import type { ServerEvent } from "@ekacode/shared/event-types";
import { batch } from "solid-js";
import { createTypedEventBus, type TypedEventBus } from "./event-bus";
import { createEventCoalescer, type CoalescerConfig } from "./event-coalescer";
import { createEventSource, type ConnectionStatus, type EventSourceConfig } from "./event-source";

// ============================================================================
// Types
// ============================================================================

export interface SSEManagerConfig {
  /** Base URL for SSE connection */
  baseUrl: string;
  /** Optional auth token */
  token?: string;
  /** Event source configuration overrides */
  sourceConfig?: Partial<EventSourceConfig>;
  /** Coalescer configuration overrides */
  coalescerConfig?: Partial<CoalescerConfig>;
}

export interface SSEManager {
  /** Connect to SSE endpoint */
  connect: () => void;
  /** Disconnect from SSE endpoint */
  disconnect: () => void;
  /** Check if currently connected */
  isConnected: () => boolean;
  /** Get current connection status */
  getStatus: () => ConnectionStatus;
  /** Subscribe to events for a directory, returns unsubscribe function */
  onEvent: (callback: (directory: string, event: ServerEvent) => void) => () => void;
  /** Get connection metrics */
  getMetrics: () => {
    connection: ReturnType<Required<ReturnType<typeof createEventSource>>["getMetrics"]>;
    coalescer: ReturnType<Required<ReturnType<typeof createEventCoalescer>>["getMetrics"]>;
  };
  /** Get the event bus for direct access */
  eventBus: TypedEventBus;
}

// ============================================================================
// Constants
// ============================================================================

const COALESCE_WINDOW_MS = 16; // Match GlobalSDKProvider timing (~60fps)
const MAX_QUEUED_EVENTS = 1000;
const MAX_QUEUE_SIZE = 200;

// ============================================================================
// Event Processing
// ============================================================================

/**
 * Coalescing key function - deduplicate events by directory and content
 * Matches GlobalSDKProvider behavior
 */
function coalesceKey(directory: string, payload: ServerEvent): string | undefined {
  if (payload.type === "session.status") {
    return `session.status:${directory}:${(payload.properties as { sessionID?: string })?.sessionID || ""}`;
  }
  if (payload.type === "message.part.updated") {
    const part = payload.properties.part as { messageID?: string; id?: string } | undefined;
    return `message.part.updated:${directory}:${part?.messageID || ""}:${part?.id || ""}`;
  }
  return undefined;
}

// ============================================================================
// Coalescer with Deduplication
// ============================================================================

/**
 * Enhanced coalescer that supports deduplication by key
 */
function createDeduplicatingCoalescer(
  onEvents: (events: Array<{ directory: string; payload: ServerEvent }>) => void,
  config: CoalescerConfig = {}
) {
  const coalescer = createEventCoalescer(
    events => {
      onEvents(events as unknown as Array<{ directory: string; payload: ServerEvent }>);
    },
    {
      batchWindowMs: COALESCE_WINDOW_MS,
      maxQueueSize: MAX_QUEUE_SIZE,
      ...config,
    }
  );

  // Track deduplication by key
  const coalesced = new Map<string, number>();
  let queue: Array<{ directory: string; payload: ServerEvent } | undefined> = [];
  let buffer: Array<{ directory: string; payload: ServerEvent } | undefined> = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let last = 0;

  const flush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;

    if (queue.length === 0) return;

    const events = queue;
    queue = buffer;
    buffer = events;
    queue.length = 0;
    coalesced.clear();

    last = Date.now();
    batch(() => {
      for (const event of events) {
        if (!event) continue;
        onEvents([event]);
      }
    });

    buffer.length = 0;
  };

  const schedule = () => {
    if (flushTimer) return;
    const elapsed = Date.now() - last;
    flushTimer = setTimeout(flush, Math.max(0, COALESCE_WINDOW_MS - elapsed));
  };

  const addWithDeduplication = (directory: string, payload: ServerEvent) => {
    if (queue.length >= MAX_QUEUED_EVENTS) {
      flush();
    }

    const key = coalesceKey(directory, payload);
    if (key) {
      const i = coalesced.get(key);
      if (i !== undefined) {
        queue[i] = undefined;
      }
      coalesced.set(key, queue.length);
    }

    queue.push({ directory, payload });
    schedule();
  };

  return {
    add: addWithDeduplication,
    flush,
    drain: flush,
    getQueueSize: () => queue.length,
    getMetrics: coalescer.getMetrics,
  };
}

// ============================================================================
// SSE Manager Factory
// ============================================================================

/**
 * Create SSE manager for server-sent events
 *
 * @example
 * ```tsx
 * const sseManager = createSSEManager({
 *   baseUrl: 'http://localhost:3000',
 *   token: 'my-token',
 * });
 *
 * // Connect to SSE
 * sseManager.connect();
 *
 * // Listen to events
 * const unlisten = sseManager.onEvent((directory, event) => {
 *   console.log(`${directory}:`, event);
 * });
 *
 * // Cleanup
 * onCleanup(() => {
 *   unlisten();
 *   sseManager.disconnect();
 * });
 * ```
 */
export function createSSEManager(config: SSEManagerConfig): SSEManager {
  const { baseUrl, token, sourceConfig, coalescerConfig } = config;

  const eventBus = createTypedEventBus();
  let eventSource: ReturnType<typeof createEventSource> | undefined;

  // Create deduplicating coalescer
  const coalescer = createDeduplicatingCoalescer(events => {
    for (const event of events) {
      eventBus.emit(event.directory, {
        ...event.payload,
        directory: event.directory,
      });
    }
  }, coalescerConfig);

  // Event source configuration
  const sourceConfigFull: EventSourceConfig = {
    baseUrl,
    token,
    onEvent: typedEvent => {
      // Validate event type
      if (!isKnownEventType(typedEvent.type)) {
        console.warn("[SSE] Unknown event type:", typedEvent.type);
        return;
      }

      // Extract directory from event
      const propertiesDirectory =
        typedEvent.properties &&
        typeof typedEvent.properties === "object" &&
        typedEvent.properties !== null &&
        "directory" in typedEvent.properties &&
        typeof typedEvent.properties.directory === "string"
          ? typedEvent.properties.directory
          : undefined;
      const directory = typedEvent.directory || propertiesDirectory || "global";

      const payload: ServerEvent = {
        type: typedEvent.type,
        properties: typedEvent.properties as Record<string, unknown>,
        directory,
        eventId: typedEvent.eventId,
        sequence: typedEvent.sequence,
        timestamp: typedEvent.timestamp,
        sessionID: typedEvent.sessionID,
      };

      // Add to coalescer with deduplication
      coalescer.add(directory, payload);
    },
    onOpen: () => {
      console.info("[SSE] Connected");
    },
    onError: error => {
      console.error("[SSE] Error:", error.message);
    },
    reconnectDelay: {
      base: 1000,
      max: 30000,
      jitter: 500,
    },
    ...sourceConfig,
  };

  // Create event source connection
  eventSource = createEventSource(sourceConfigFull);

  return {
    connect: () => {
      eventSource?.connect();
    },
    disconnect: () => {
      coalescer.drain();
      eventSource?.disconnect();
    },
    isConnected: () => eventSource?.isConnected() ?? false,
    getStatus: () => eventSource?.getStatus() ?? "disconnected",
    onEvent: (callback: (directory: string, event: ServerEvent) => void) => {
      return eventBus.listenGlobal(event => {
        const directory = event.directory ?? "global";
        callback(directory, { ...event, directory });
      });
    },
    getMetrics: () => ({
      connection: eventSource?.getMetrics() ?? {
        connectionAttempts: 0,
        successfulConnections: 0,
        totalEventsReceived: 0,
        totalErrors: 0,
        currentReconnectDelay: 0,
      },
      coalescer: coalescer.getMetrics(),
    }),
    eventBus,
  };
}
