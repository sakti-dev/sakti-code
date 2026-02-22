/**
 * Event SSE Endpoint - Opencode-style event streaming
 *
 * Replaces the old /api/events endpoint with a unified event system.
 * Single SSE endpoint for all real-time updates (messages, parts, sessions, etc.)
 *
 * Usage:
 * const eventSource = new EventSource('/event');
 * eventSource.addEventListener('message', (e) => {
 *   const event = JSON.parse(e.data);
 *   // Handle { type, properties } events
 * });
 */

import { createLogger } from "@sakti-code/shared/logger";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { v7 as uuidv7 } from "uuid";
import { ServerInstanceDisposed, subscribeAll } from "../bus";
import type { Env } from "../index";

const app = new Hono<Env>();
const logger = createLogger("server");

/**
 * SSE /event endpoint
 *
 * Unified event streaming following Opencode pattern:
 * - Sends server.connected on connection
 * - Streams all bus events as { type, properties }
 * - Sends server.heartbeat every 30s (prevents WebView timeout)
 * - Closes on server.instance.disposed event
 *
 * Event Format:
 * {
 *   type: "message.part.updated" | "session.created" | "server.heartbeat" | ...
 *   properties: { ...event-specific data }
 * }
 */
app.get("/event", async c => {
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");
  c.header("Content-Encoding", "none");

  const requestId = c.get("requestId");
  logger.info("event SSE client connected", {
    module: "event",
    requestId,
  });

  return streamSSE(c, async stream => {
    // Send connection confirmation
    const connectedEvent = {
      type: "server.connected",
      properties: {},
      eventId: uuidv7(),
      sequence: 0,
      timestamp: Date.now(),
    };
    await stream.writeSSE({
      id: connectedEvent.eventId,
      data: JSON.stringify(connectedEvent),
    });

    // Subscribe to all bus events
    const unsub = subscribeAll(async event => {
      await stream.writeSSE({
        id: event.eventId,
        data: JSON.stringify(event),
      });

      // Close connection on instance disposal
      if (event.type === ServerInstanceDisposed.type) {
        stream.close();
      }
    });

    // Send heartbeat every 30s to prevent WKWebView timeout (60s default)
    const heartbeat = setInterval(() => {
      const heartbeatEvent = heartbeatEventFactory();
      stream
        .writeSSE({
          id: heartbeatEvent.eventId,
          data: JSON.stringify(heartbeatEvent),
        })
        .catch(err => {
          logger.error("Failed to send heartbeat", err, {
            module: "event",
            requestId,
          });
        });
    }, 30000);

    // Wait for abort
    await new Promise<void>(resolve => {
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsub();
        logger.info("event SSE client disconnected", {
          module: "event",
          requestId,
        });
        resolve();
      });
    });
  });
});

function heartbeatEventFactory() {
  return {
    type: "server.heartbeat",
    properties: {},
    eventId: uuidv7(),
    sequence: 0,
    timestamp: Date.now(),
  };
}

/**
 * NOTE: `stream.writeSSE` supports `id`, which browsers store as `lastEventId`.
 * This enables reconnect catch-up with `afterEventId`.
 */
export default app;
